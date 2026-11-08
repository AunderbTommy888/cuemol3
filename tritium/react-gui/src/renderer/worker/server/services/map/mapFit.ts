/**
 * @file worker/server/services/map/mapFit.ts
 * @description Fitting the view to a density map as it is drawn: the extent
 * of its shown contours (the grid points at or above each shown renderer's
 * level), as ChimeraX fits to the displayed surface, rather than the whole
 * data block, which for a cryo-EM map is a box several times the particle.
 *
 * Used by the scene pane's Focus (`sceneTree/sceneOps.ts`) and when a map is
 * opened (`streamLoad.ts`, `emDefaults.ts`). Runs in the Web Worker thread
 * (sync C++ wrappers). The box itself is `mapFitBox.ts`; other scalar objects
 * fall back to their own `fitView`.
 */
import type { Scene } from '@cuemol/core/src/wrappers/Scene';
import type { View } from '@cuemol/core/src/wrappers/View';
import type { WorkerContext } from '@renderer/worker/server/types/WorkerContext';
import { displayedMapFitBox, type MapFitBox } from '@renderer/worker/server/services/map/mapFitBox';

export { displayedMapFitBox, type MapFitBox };

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
