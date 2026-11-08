/**
 * @file worker/server/services/map/mapFit.ts
 * @description Fitting the view to a density map as it is drawn: the extent
 * of its shown contours (the grid points at or above each shown renderer's
 * level), as ChimeraX fits to the displayed surface, rather than the whole
 * data block, which for a cryo-EM map is a box several times the particle.
 *
 * Used by the scene pane's Focus (`sceneTree/sceneOps.ts`) and when a map is
 * opened (`streamLoad.ts`, `emDefaults.ts`). Runs in the Web Worker thread
 * (sync C++ wrappers). Members are probed, so other scalar objects fall back
 * to their own `fitView`.
 */
import type { Scene } from '@cuemol/core/src/wrappers/Scene';
import type { View } from '@cuemol/core/src/wrappers/View';
import type { WorkerContext } from '@renderer/worker/server/types/WorkerContext';
import { enumerateObjectRenderers } from '@renderer/worker/server/services/helpers/groupChildren';
import { safeRead } from '@renderer/worker/server/services/helpers/safeRead';

/** A box in the view's rotated frame, as `getFitBoxJSON` returns it. */
export interface MapFitBox {
    min: [number, number, number];
    max: [number, number, number];
}

/** The margin added on each side, as a fraction of the box (the molecule fit's, `MolCoord::getFitBox`). */
const FIT_MARGIN = 0.2;

type LevelBoxSource = { getLevelFitBoxJSON?: (view: unknown, level: number) => string };
type MapRend = { visible?: boolean; level?: number; siglevel?: number };

/**
 * The box of what a map draws: the union, over its shown contour renderers,
 * of the grid points at or above each one's level, grown by the molecule
 * fit's margin. Null when the object is not such a map, no contour is shown,
 * or no grid point reaches the level -- the caller then fits the data block.
 */
export function displayedMapFitBox(scene: Scene, obj: unknown, view: unknown): MapFitBox | null {
    const src = obj as LevelBoxSource;
    if (typeof src.getLevelFitBoxJSON !== 'function') return null;
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    const rends = enumerateObjectRenderers(obj as Parameters<typeof enumerateObjectRenderers>[0], scene);
    for (const r of rends) {
        const rend = r as unknown as MapRend;
        // A contour renderer: one with a level (in absolute density) and a sigma level.
        if (!('level' in rend) || !('siglevel' in rend)) continue;
        if (!(safeRead(() => rend.visible) ?? false)) continue;
        const level = safeRead(() => Number(rend.level));
        if (level === undefined || !Number.isFinite(level)) continue;
        const json = safeRead(() => src.getLevelFitBoxJSON!(view, level)) ?? '';
        if (!json) continue;
        const box = JSON.parse(json) as MapFitBox;
        for (let i = 0; i < 3; i++) {
            lo[i] = Math.min(lo[i], box.min[i]);
            hi[i] = Math.max(hi[i], box.max[i]);
        }
    }
    if (!Number.isFinite(lo[0])) return null;
    const grow = (i: number) => (hi[i] - lo[i]) * FIT_MARGIN;
    return {
        min: [lo[0] - grow(0), lo[1] - grow(1), lo[2] - grow(2)],
        max: [hi[0] + grow(0), hi[1] + grow(1), hi[2] + grow(2)],
    };
}

/** Fit `view` to a box in its rotated frame (`View::fitToBox`). */
export function fitViewToBox(ctx: WorkerContext, view: unknown, box: MapFitBox): void {
    const toVec = (v: readonly number[]) => {
        const vec = ctx.svc.createObj('Vector') as unknown as { x: number; y: number; z: number };
        vec.x = v[0];
        vec.y = v[1];
        vec.z = v[2];
        return vec;
    };
    (view as { fitToBox: (vmin: unknown, vmax: unknown) => void }).fitToBox(toVec(box.min), toVec(box.max));
}

/**
 * Fit `view` to a map as it is drawn (`displayedMapFitBox`), else to its
 * data block (`fitView`). Returns false when the object has neither.
 */
export function fitViewToMap(ctx: WorkerContext, scene: Scene, obj: unknown, view: View): boolean {
    const box = displayedMapFitBox(scene, obj, view);
    if (box) {
        fitViewToBox(ctx, view, box);
        return true;
    }
    const o = obj as { fitView?: (view: View, dummy: boolean) => void };
    if (typeof o.fitView !== 'function') return false;
    o.fitView(view, false);
    return true;
}
