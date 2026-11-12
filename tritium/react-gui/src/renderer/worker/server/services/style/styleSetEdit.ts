// Runs in Web Worker thread. Wrappers are sync (no await on C++ wrappers).
//
// style-set editor (UXP `style/style_editor.xul`). Style-set-scoped
// CRUD for the three editor tabs: named colors, named selections (MolSel defs,
// the "sel" str-data category), and style entries. Edits are live-applied like
// the ColorPane decks; the dialog refetches after each. An edit of a scene's
// set is one undo step; a system or user set has no scene, so it is none.
import type { WorkerContext } from '@renderer/worker/server/types/WorkerContext';
import { withUndoTxn } from '../withUndoTxn';
import { getSceneOrNull } from '@renderer/worker/server/services/helpers/sceneResolver';
import { recordOp } from '@renderer/worker/server/actions/serviceOps';

/** "sel" str-data category = named MolSel definitions (UXP Selection tab). */
const SEL_CAT = 'sel';

interface AbstractColorLike {
    r(): number;
    g(): number;
    b(): number;
}

interface StyleSetLike {
    name: string;
    readonly: boolean;
    getColorDefsJSON(): string;
    getColor(name: string): AbstractColorLike | null;
    getStrDataNamesJSON(cat: string): string;
    getStrData(cat: string, key: string): string;
    getStyleNamesJSON(): string;
    removeStyle(name: string): boolean;
}

/**
 * Writes go through the manager, not the set: `StyleSet.setColor` and friends
 * change the set but queue no style event, so `firePendingEvents` would fire
 * nothing -- the named-colour cache would keep the old value and no renderer
 * would redraw. The manager's versions write the same way (undo record
 * included) and queue the event.
 */
interface StyleMgrLike {
    getStyleSet(id: number): StyleSetLike | null;
    compileColor(str: string, scopeId: number): AbstractColorLike | null;
    setColor(key: string, col: AbstractColorLike, scopeId: number, styleSetId: number): boolean;
    removeColor(key: string, scopeId: number, styleSetId: number): boolean;
    setStrData(cat: string, key: string, value: string, scopeId: number, styleSetId: number): boolean;
    removeStrData(cat: string, key: string, scopeId: number, styleSetId: number): boolean;
    firePendingEvents?(): void;
}

function getMgr(ctx: WorkerContext): StyleMgrLike | null {
    const mgr = ctx.svc.getService('StyleManager') as unknown as StyleMgrLike | null;
    return mgr ?? null;
}

function packHex(r: number, g: number, b: number): string {
    const h = (v: number): string => (v < 16 ? '0' : '') + (v & 0xff).toString(16);
    return `#${h(r)}${h(g)}${h(b)}`;
}

// --- read ---

export interface StyleColorEntry {
    name: string;
    hex: string;
}
export interface StyleSelEntry {
    name: string;
    value: string;
}
export interface StyleEntry {
    name: string;
    type: string;
}

export interface GetStyleSetContentsArgs {
    styleSetId: number;
}

export interface GetStyleSetContentsResult {
    ok: boolean;
    name: string;
    readonly: boolean;
    colors: StyleColorEntry[];
    selections: StyleSelEntry[];
    styles: StyleEntry[];
}

const EMPTY_CONTENTS: GetStyleSetContentsResult = {
    ok: false,
    name: '',
    readonly: false,
    colors: [],
    selections: [],
    styles: [],
};

function parseStringArray(json: string): string[] {
    try {
        const v = JSON.parse(json);
        return Array.isArray(v) ? (v.filter((s) => typeof s === 'string') as string[]) : [];
    } catch {
        return [];
    }
}

export function getStyleSetContents(
    ctx: WorkerContext,
    args: GetStyleSetContentsArgs,
): GetStyleSetContentsResult {
    const mgr = getMgr(ctx);
    if (!mgr) return EMPTY_CONTENTS;
    const set = mgr.getStyleSet(args.styleSetId);
    if (!set) return EMPTY_CONTENTS;

    const colors: StyleColorEntry[] = [];
    for (const name of parseStringArray(set.getColorDefsJSON())) {
        try {
            const c = set.getColor(name);
            if (c) colors.push({ name, hex: packHex(c.r(), c.g(), c.b()) });
        } catch {
            // skip un-resolvable colour entries (UXP swallows these too)
        }
    }

    const selections: StyleSelEntry[] = [];
    for (const name of parseStringArray(set.getStrDataNamesJSON(SEL_CAT))) {
        try {
            selections.push({ name, value: set.getStrData(SEL_CAT, name) ?? '' });
        } catch {
            // skip
        }
    }

    const styles: StyleEntry[] = [];
    try {
        const parsed = JSON.parse(set.getStyleNamesJSON()) as { name?: string; type?: string }[];
        if (Array.isArray(parsed)) {
            for (const s of parsed) if (s.name) styles.push({ name: s.name, type: s.type ?? '' });
        }
    } catch {
        // leave empty
    }

    return { ok: true, name: set.name, readonly: set.readonly, colors, selections, styles };
}

// --- writes (live-applied, one undo step each) ---

/**
 * Resolve set + scene, run `fn` in an undo txn, fire pending events.
 * `fn` receives the set's scope (0 global, else the scene uid), which the
 * manager's write methods key on.
 */
function mutate(
    ctx: WorkerContext,
    sceneId: number,
    styleSetId: number,
    label: string,
    fn: (set: StyleSetLike, mgr: StyleMgrLike, scopeId: number) => void,
): boolean {
    const scene = getSceneOrNull(ctx, sceneId);
    if (!scene) return false;
    const mgr = getMgr(ctx);
    if (!mgr) return false;
    const set = mgr.getStyleSet(styleSetId);
    if (!set) return false;
    // `getStyleSetsJSON` lists one scope, so a global set is found under 0.
    const scopeId = [...styleSetsOf(ctx, sceneId), ...styleSetsOf(ctx, 0)]
        .find((e) => e.uid === styleSetId)?.scene_id;
    if (typeof scopeId !== 'number') return false;
    // Editability is the set's read-only flag alone: the bundled global sets
    // and the dot-directory styles are read-only, the "user" set (saved on
    // exit) and the scene's own sets are not.
    if (set.readonly) return false;

    let ok = false;
    if (scopeId === 0) {
        // A global set has no scene, so C++ records no undo for it; a scene
        // txn around the edit would commit empty and clear the Redo stack.
        fn(set, mgr, scopeId);
        ok = true;
    } else {
        withUndoTxn(scene, label, () => {
            fn(set, mgr, scopeId);
            ok = true;
        });
    }
    mgr.firePendingEvents?.();
    return ok;
}

export interface SetStyleSetColorArgs {
    sceneId: number;
    styleSetId: number;
    scopeId: number;
    name: string;
    colorStr: string;
}
export interface StyleSetEditResult {
    ok: boolean;
}

export function setStyleSetColor(ctx: WorkerContext, args: SetStyleSetColorArgs): StyleSetEditResult {
    const name = args.name.trim();
    if (name.length === 0) return { ok: false };
    const styleSet = styleSetNameOf(ctx, args.sceneId, args.styleSetId);
    const ok = mutate(ctx, args.sceneId, args.styleSetId, `Set style color ${name}`, (_set, mgr, scopeId) => {
        const col = mgr.compileColor(args.colorStr, args.scopeId);
        if (!col) return;
        if (styleSet !== null) recordOp(ctx, args.sceneId, 'define_color', { name, color: args.colorStr.trim(), styleSet });
        mgr.setColor(name, col, scopeId, args.styleSetId);
    });
    return { ok };
}

export interface RemoveStyleSetKeyArgs {
    sceneId: number;
    styleSetId: number;
    name: string;
}

export function removeStyleSetColor(ctx: WorkerContext, args: RemoveStyleSetKeyArgs): StyleSetEditResult {
    const styleSet = styleSetNameOf(ctx, args.sceneId, args.styleSetId);
    const ok = mutate(ctx, args.sceneId, args.styleSetId, `Remove style color ${args.name}`, (_set, mgr, scopeId) => {
        if (styleSet !== null) recordOp(ctx, args.sceneId, 'remove_color', { styleSet, name: args.name });
        mgr.removeColor(args.name, scopeId, args.styleSetId);
    });
    return { ok };
}

export interface SetStyleSetSelectionArgs {
    sceneId: number;
    styleSetId: number;
    name: string;
    value: string;
}

interface StyleSetInfo {
    name?: string;
    scene_id?: number;
    uid?: number;
    readonly?: boolean;
}

function styleSetsOf(ctx: WorkerContext, sceneId: number): StyleSetInfo[] {
    try {
        const parsed: unknown = JSON.parse(ctx.styleMgr.getStyleSetsJSON(sceneId));
        return Array.isArray(parsed) ? (parsed as StyleSetInfo[]) : [];
    } catch {
        return [];
    }
}

/**
 * The uid of the style set a scene reaches by `name`: its own set of that
 * name before a global one. Null when there is none, or two in one scope.
 */
export function styleSetByName(ctx: WorkerContext, sceneId: number, name: string): number | null {
    const named = styleSetsOf(ctx, sceneId).filter((e) => e.name === name && typeof e.uid === 'number');
    const own = named.filter((e) => e.scene_id === sceneId);
    const pick = own.length > 0 ? own : named;
    return pick.length === 1 ? (pick[0].uid as number) : null;
}

/** The uid and scope (0 global, else the scene's uid) of the set `styleSetByName` finds. */
export function styleSetScopeByName(ctx: WorkerContext, sceneId: number, name: string): { styleSetId: number; scopeId: number } | null {
    const styleSetId = styleSetByName(ctx, sceneId, name);
    if (styleSetId === null) return null;
    const scopeId = styleSetsOf(ctx, sceneId).find((e) => e.uid === styleSetId)?.scene_id;
    return typeof scopeId === 'number' ? { styleSetId, scopeId } : null;
}

/**
 * The name a recorded op names this set by: null when it is not the scene's
 * own set (a system or user set is not scene state, so its edits are not
 * recorded) or the name does not lead back to it.
 */
export function styleSetNameOf(ctx: WorkerContext, sceneId: number, styleSetId: number): string | null {
    const entry = styleSetsOf(ctx, sceneId).find((e) => e.uid === styleSetId);
    const name = entry !== undefined && entry.scene_id === sceneId ? entry.name : undefined;
    return name !== undefined && styleSetByName(ctx, sceneId, name) === styleSetId ? name : null;
}

/**
 * The set `name` names for the scene (`styleSetScopeByName`), or a new set
 * of the scene by that name when there is none. Call inside an undo txn:
 * making one is an edit.
 *
 * @returns the set, or null when the name is shared or no set could be made.
 */
export function findOrCreateSceneSet(
    ctx: WorkerContext,
    sceneId: number,
    name: string,
): { styleSetId: number; scopeId: number } | null {
    const found = styleSetScopeByName(ctx, sceneId, name);
    if (found !== null) return found;
    if (styleSetsOf(ctx, sceneId).some((e) => e.name === name)) return null;
    const styleSetId = ctx.styleMgr.createStyleSet(name, sceneId);
    return styleSetId > 0 ? { styleSetId, scopeId: sceneId } : null;
}

export function setStyleSetSelection(
    ctx: WorkerContext,
    args: SetStyleSetSelectionArgs,
): StyleSetEditResult {
    const name = args.name.trim();
    if (name.length === 0) return { ok: false };
    // define_selection trims the expression it stores.
    const styleSet = styleSetNameOf(ctx, args.sceneId, args.styleSetId);
    const opEquivalent = args.value.trim() === args.value && args.value !== '' && styleSet !== null;
    const ok = mutate(ctx, args.sceneId, args.styleSetId, `Set style selection ${name}`, (_set, mgr, scopeId) => {
        if (opEquivalent) {
            recordOp(ctx, args.sceneId, 'define_selection', { name, selection: args.value, styleSet });
        }
        mgr.setStrData(SEL_CAT, name, args.value, scopeId, args.styleSetId);
    });
    return { ok };
}

export function removeStyleSetSelection(
    ctx: WorkerContext,
    args: RemoveStyleSetKeyArgs,
): StyleSetEditResult {
    const styleSet = styleSetNameOf(ctx, args.sceneId, args.styleSetId);
    const ok = mutate(ctx, args.sceneId, args.styleSetId, `Remove style selection ${args.name}`, (_set, mgr, scopeId) => {
        if (styleSet !== null) recordOp(ctx, args.sceneId, 'remove_selection', { styleSet, name: args.name });
        mgr.removeStrData(SEL_CAT, args.name, scopeId, args.styleSetId);
    });
    return { ok };
}

export function removeStyleSetStyle(ctx: WorkerContext, args: RemoveStyleSetKeyArgs): StyleSetEditResult {
    const styleSet = styleSetNameOf(ctx, args.sceneId, args.styleSetId);
    const ok = mutate(ctx, args.sceneId, args.styleSetId, `Remove style entry ${args.name}`, (set) => {
        if (styleSet !== null) recordOp(ctx, args.sceneId, 'remove_style', { styleSet, name: args.name });
        set.removeStyle(args.name);
    });
    return { ok };
}
