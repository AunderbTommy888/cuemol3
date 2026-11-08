/**
 * @file plugins/chimerax-console/worker/camera.test.ts
 * @description `view` framing a density map.
 *
 * What the scene would get quietly wrong: a map left out of the framing
 * (`view #1` on a map was "nothing to show"), or its box given the margin
 * twice (the map box's own and the framing's), which frames it too loosely.
 */

import { describe, expect, it, vi } from 'vitest'
import type { WorkerContext } from '@renderer/worker/server/types/WorkerContext'

const { margins } = vi.hoisted(() => ({ margins: [] as number[] }))

vi.mock('@renderer/worker/server/services/helpers/sceneResolver', () => ({
  getSceneOrNull: () => ({ getObject: () => ({}) }),
}))
// The map draws a box 10 x 20 x 4 A (in the view's rotated frame) with no margin asked for.
vi.mock('@renderer/worker/server/services/map/mapFitBox', () => ({
  displayedMapFitBox: (_scene: unknown, _obj: unknown, _view: unknown, margin: number) => {
    margins.push(margin)
    return { min: [0, 0, 0], max: [10, 20, 4] }
  },
}))

import { framingOf } from './camera'

const view = { right_vec: { x: 1, y: 0, z: 0 }, up_vec: { x: 0, y: 1, z: 0 }, forward_vec: { x: 0, y: 0, z: 1 }, width: 800, height: 400 }
const ctx = { sceMgr: { getView: () => view } } as unknown as WorkerContext

describe('framingOf', () => {
  it('frames a map by the box it draws, with the margin added once', () => {
    const f = framingOf(ctx, 1, 2, [], [20])
    expect(margins).toEqual([0])
    expect(f).not.toBeNull()
    expect(f!.center).toEqual([5, 10, 2])
    // 20% on each side of the 20 A height (the taller side for a 2:1 view): 28 A.
    expect(f!.zoom).toBeCloseTo(28, 9)
  })
})
