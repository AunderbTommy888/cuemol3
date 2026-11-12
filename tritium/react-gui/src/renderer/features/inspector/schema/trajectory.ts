/**
 * @file features/inspector/schema/trajectory.ts
 * @description The Trajectory OBJECT's page (C++ `mdtools::Trajectory`).
 *
 * `frame_aver_size` smooths playback: the shown coordinates are the average
 * over the current frame and up to N frames on either side (a window of
 * 2N+1 frames, clipped at the ends). It is a property of the object, not of a
 * renderer, and was otherwise only reachable through the Generic tab. The
 * row's range stops at 10 (a 21-frame window), past which the average blurs
 * the motion more than it removes noise; the property itself takes any count.
 */

import type { SchemaSectionDef } from './types'

export const TRAJECTORY_SECTIONS: SchemaSectionDef[] = [
  {
    key: 'trajectory-main',
    title: 'Trajectory',
    defaultExpanded: true,
    hideWhenEmpty: true,
    rows: [
      {
        kind: 'num',
        key: 'frame_aver_size',
        label: 'Frame averaging (\u00b1)',
        min: 0,
        max: 10,
        step: 1,
        decimals: 0,
        unit: 'frames',
      },
    ],
  },
]
