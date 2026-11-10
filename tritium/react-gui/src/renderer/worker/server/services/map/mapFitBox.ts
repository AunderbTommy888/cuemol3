/**
 * @file worker/server/services/map/mapFitBox.ts
 * @description The box of a density map as it is drawn: the extent of its
 * shown contours (the grid points at or above each shown renderer's level),
 * as ChimeraX fits to the displayed surface. Read-only (it changes no
 * object), so the ChX console may use it to frame maps; fitting the view to
 * the box is `mapFit.ts`. Runs in the Web Worker thread (sync C++ wrappers).
 */
import type { Scene } from '@cuemol/core/src/wrappers/Scene';
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
 * fit's margin (`margin`, a fraction of the box on each side; 0 for the bare
 * box, when the caller adds its own). Null when the object is not such a
 * map, no contour is shown, or no grid point reaches the level -- the caller
 * then fits the data block.
 */
export function displayedMapFitBox(scene: Scene, obj: unknown, view: unknown, margin: number = FIT_MARGIN): MapFitBox | null {
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
    const grow = (i: number) => (hi[i] - lo[i]) * margin;
    return {
        min: [lo[0] - grow(0), lo[1] - grow(1), lo[2] - grow(2)],
        max: [hi[0] + grow(0), hi[1] + grow(1), hi[2] + grow(2)],
    };
}
