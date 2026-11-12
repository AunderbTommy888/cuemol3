// Runs in Web Worker thread. Wrappers are sync (no await on C++ wrappers).
//
// The style sets a scene can see, for the Style Sets pane, in lookup order:
// a name (colour, style, selection) resolves to the first set that defines it,
// searching the scene's own sets before the global ones, and within a scope
// from the front of its list (a newly loaded set goes to the front; see
// `StyleMgr::getColor`). UXP `createStyleNodeData` listed the global sets
// first, which put the highest-priority sets at the bottom.
import type { WorkerContext } from '@renderer/worker/server/types/WorkerContext';
import type { StyleSetEntry } from '@renderer/worker/shared/styleSetTypes';

interface StyleSetJSONEntry {
    name?: string;
    uid?: number;
    scene_id?: number;
    src?: string;
    readonly?: boolean;
    modified?: boolean;
}

interface StyleSetsSource {
    getStyleSetsJSON: (id: number) => string;
}

function parseStyleSetsJSON(mgr: StyleSetsSource, scopeId: number): StyleSetEntry[] {
    try {
        const json = mgr.getStyleSetsJSON(scopeId);
        if (!json) return [];
        const parsed = JSON.parse(json) as StyleSetJSONEntry[];
        if (!Array.isArray(parsed)) return [];
        const out: StyleSetEntry[] = [];
        for (const e of parsed) {
            if (typeof e.uid !== 'number') continue;
            out.push({
                uid: e.uid,
                name: e.name ?? '',
                scopeId: e.scene_id ?? scopeId,
                src: e.src ?? '',
                readonly: e.readonly === true,
                modified: e.modified === true,
            });
        }
        return out;
    } catch {
        return [];
    }
}

export interface ListStyleSetsArgs {
    sceneId: number;
}

export interface ListStyleSetsResult {
    ok: boolean;
    styleSets: StyleSetEntry[];
}

/** The scene-local style sets of `sceneId`, then the global ones (lookup order). */
export function listStyleSets(ctx: WorkerContext, args: ListStyleSetsArgs): ListStyleSetsResult {
    const mgr = ctx.svc.getService('StyleManager') as unknown as Partial<StyleSetsSource> | null;
    if (!mgr?.getStyleSetsJSON) return { ok: false, styleSets: [] };
    const src = mgr as StyleSetsSource;
    return {
        ok: true,
        styleSets: [...parseStyleSetsJSON(src, args.sceneId), ...parseStyleSetsJSON(src, 0)],
    };
}
