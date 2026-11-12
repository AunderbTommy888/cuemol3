import type { CueMol } from '@cuemol/core/src/cuemol';
import type { ScrEventManager } from '@cuemol/core/src/wrappers/ScrEventManager';
import type { StyleManager } from '@cuemol/core/src/wrappers/StyleManager';
import type { ViewInputConfig } from '@cuemol/core/src/wrappers/ViewInputConfig';
import * as event from '@renderer/worker/shared/eventConst';
import { renderText } from './textRender';
import { isValidUid } from '@renderer/worker/shared/uid';
import * as fs from 'fs';
import type { StyleSet } from '@cuemol/core/src/wrappers/StyleSet';

/**
 * Worker bootstrap / configuration helpers extracted from `WorkerService`.
 * These are the operations performed while bringing the worker online:
 * user-style loading, input-config selection, and event-manager wiring.
 */

const log = console;

/** The name of the global style set the GUI settings are kept in (saved to user_styles.xml). */
export const USER_STYLE_SET = 'user';

/**
 * Make the empty "user" style set, first in the global list. A set loaded
 * from a file goes first (`StyleFile::loadStyle` pushes it to the front),
 * but `createStyleSet` appends one, where every other set -- system,
 * cuemol3, the dot-directory styles -- would hide what the GUI writes to it.
 */
function createUserStyleSet(cm: CueMol, stylem: StyleManager): void {
    const set = cm.createObj('StyleSet') as StyleSet | null;
    if (set) {
        set.name = USER_STYLE_SET;
        if (stylem.registerStyleSet(set, 0, 0)) return;
    }
    stylem.createStyleSet(USER_STYLE_SET, 0);
}

/**
 * Load the user style set. With a path, loads that file; without one,
 * creates an empty "user" style set. Falls back to an empty set when the
 * file load throws. Backs the `loadUserStyle` worker entry point.
 */
export function loadUserStyle(cm: CueMol, userStylePath?: string): boolean {
    const stylem = cm.getService('StyleManager') as StyleManager;
    if (stylem === null) {
        log.error('Worker> StyleManager unavailable; skip user style');
        return false;
    }
    try {
        if (userStylePath) {
            log.info(`Worker> loading user style file: ${userStylePath}`);
            stylem.loadStyleSetFromFile(0, userStylePath, false);
        } else {
            log.info('Worker> user style absent; an empty "user" set');
            createUserStyleSet(cm, stylem);
        }
        return true;
    } catch (e) {
        log.warn('Worker> user style load failed, fallback to createStyleSet:', e);
        try {
            createUserStyleSet(cm, stylem);
            return true;
        } catch (e2) {
            log.error('Worker> createStyleSet fallback also failed:', e2);
            return false;
        }
    }
}

/**
 * Mark the style sets the library loaded at init (the bundled files the
 * sysconfig names: system, cuemol3, ...) read-only. Nothing saves them --
 * only the "user" set is written back on exit -- so an edit would be lost
 * on restart, and Save would write into the app bundle. Call right after
 * `initCueMol`, before the dot styles and the user style are loaded.
 *
 * @returns how many sets were marked
 */
export function markBundledStylesReadOnly(cm: CueMol): number {
    const stylem = cm.getService('StyleManager') as StyleManager;
    if (stylem === null) return 0;
    let n = 0;
    try {
        for (const uid of globalSetUids(stylem)) {
            const set = stylem.getStyleSet(uid) as StyleSet | null;
            if (!set) continue;
            set.readonly = true;
            n++;
        }
    } catch (e) {
        // Startup must go on; the sets just stay editable for this session.
        log.warn('Worker> cannot mark the bundled style sets read-only:', e);
    }
    return n;
}

/** The id of a style file's root `<styles id="...">`; '' when it has none. */
export function styleFileId(text: string): string {
    const root = /<styles\b([^>]*)>/.exec(text);
    const id = root ? /\bid\s*=\s*(["'])(.*?)\1/.exec(root[1]) : null;
    return id ? id[2].trim() : '';
}

/** The uids of the global style sets, from `getStyleSetsJSON(0)`. */
function globalSetUids(stylem: StyleManager): Set<number> {
    const json = stylem.getStyleSetsJSON(0);
    // Read the uids alone: the names and sources are not escaped for JSON (a Windows path).
    return new Set([...json.matchAll(/"uid":\s*(\d+)/g)].map((m) => Number(m[1])));
}

/**
 * Load the dot directory's style files (`~/.cuemol/styles/*.xml`) as
 * read-only global sets, in order; call before `loadUserStyle`, so the
 * user set (the GUI settings) lands above them. A file is skipped with a
 * warning, leaving nothing of it behind, when:
 *
 * - its root has no id, or the id `user`: that name is the GUI settings'
 *   set, which `saveUserStyle` finds by name -- a dot file holding it would
 *   make user_styles.xml fail to load and be overwritten with the dot file's
 *   content on exit;
 * - it fails to load: `StyleFile::loadNodes` registers the set before
 *   reading its styles, so the sets the load added are destroyed, or the
 *   styles read before the error would stay in the lookup.
 *
 * @returns how many files were loaded
 */
export function loadDotStyles(cm: CueMol, paths: readonly string[]): number {
    const stylem = cm.getService('StyleManager') as StyleManager;
    if (stylem === null) {
        log.error('Worker> StyleManager unavailable; skip dot styles');
        return 0;
    }
    let loaded = 0;
    for (const p of paths) {
        let id = '';
        try {
            id = styleFileId(fs.readFileSync(p, 'utf8'));
        } catch (e) {
            log.warn(`Worker> cannot read style file ${p}; skipped:`, e);
            continue;
        }
        if (id === '' || id === USER_STYLE_SET) {
            log.warn(`Worker> style file ${p}: ${id === '' ? 'no <styles id="...">' : 'the id "user" is reserved for the GUI settings'}; skipped`);
            continue;
        }
        const before = globalSetUids(stylem);
        try {
            stylem.loadStyleSetFromFile(0, p, true);
            log.info(`Worker> loaded style file: ${p}`);
            loaded++;
        } catch (e) {
            for (const uid of globalSetUids(stylem)) if (!before.has(uid)) stylem.destroyStyleSet(0, uid);
            log.warn(`Worker> style file ${p} failed to load; skipped:`, e);
        }
    }
    return loaded;
}

/**
 * Save the "user" style set to `userStylePath`. Mirrors UXP
 * `Qm2Main.onUnLoad` (cuemol2.js:297-304): resolve the user style set uid via
 * `hasStyleSet("user", 0)` and write it out with `saveStyleSetToFile`. Backs
 * the `saveUserStyle` worker entry point; called on window close so
 * user-defined defaults (DefaultLabel.*, UserViewConf.*) persist across
 * sessions. Returns false when no user set exists or the write fails.
 */
export function saveUserStyle(cm: CueMol, userStylePath: string): boolean {
    const stylem = cm.getService('StyleManager') as StyleManager;
    if (stylem === null) {
        log.error('Worker> StyleManager unavailable; skip user style save');
        return false;
    }
    try {
        const uid = stylem.hasStyleSet('user', 0);
        if (!isValidUid(uid)) {
            log.info('Worker> no "user" style set; nothing to save');
            return false;
        }
        log.info(`Worker> saving user style file: ${userStylePath}`);
        return stylem.saveStyleSetToFile(0, uid, userStylePath);
    } catch (e) {
        log.error('Worker> user style save failed:', e);
        return false;
    }
}

/** Set the active ViewInputConfig style (mouse / gesture binding preset). */
export function setViewInputConfigStyle(cm: CueMol, styleName: string): boolean {
    const vic = cm.getService('ViewInputConfig') as ViewInputConfig;
    if (vic === null) {
        log.error('Worker> ViewInputConfig unavailable; skip style set');
        return false;
    }
    try {
        vic.style = styleName;
        log.info(`Worker> ViewInputConfig.style = ${styleName}`);
        return true;
    } catch (e) {
        log.error('Worker> ViewInputConfig.style set failed:', e);
        return false;
    }
}

/**
 * Subscribe to the CueMol event manager. `renderText` events are handled
 * synchronously in-thread (the native TextRender object cannot cross
 * postMessage); every other event is forwarded to the renderer via
 * `postMessage(['event-notify', ...])`.
 *
 * @returns The listener id, so a teardown can hand it back to
 *   `evtMgr.removeListener`. The id used to be dropped on the floor, which
 *   left the C++ side holding a callback into a worker that was shutting
 *   down -- harmless while the worker lives as long as the app, and not
 *   harmless the moment one is re-initialised.
 */
export function registerWorkerEventListener(
    evtMgr: ScrEventManager,
    cm: CueMol,
    postMessage: (data: any[]) => void,
): number {
    evtMgr.append('renderText', event.SEM_EXTND, event.SEM_OTHER, event.SEM_ANY);
    return evtMgr.addListener((...args: any[]) => {
        const category = args[1];
        if (category === 'renderText') {
            // Handle synchronously in the Worker thread using OffscreenCanvas 2D.
            // The native TextRender object cannot be transferred via postMessage.
            const trObj = args[5];
            renderText(cm, trObj);
            return;
        }
        try {
            postMessage(['event-notify', ...args]);
        } catch (e) {
            log.error('Worker> event manager notify failed:', e);
        }
    });
}
