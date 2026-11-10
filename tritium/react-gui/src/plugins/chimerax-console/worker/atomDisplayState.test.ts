/**
 * @file plugins/chimerax-console/worker/atomDisplayState.test.ts
 * @description The kept form of the atom display state: it reads back the
 * same, keeps the ids of deleted atoms, and takes in new atoms as told.
 */

import { describe, expect, it } from 'vitest'
import { codeOf, decode, encode, hide, rangesOf, shownIds, stateOf, withAtoms } from './atomDisplayState'

describe('atom display state', () => {
  it('reads back what it keeps, keeping deleted atoms and taking in new ones', () => {
    expect(rangesOf([1, 2, 3, 5])).toBe('1:3,5')
    const s = hide(stateOf(Int32Array.from([1, 2, 3, 5]), (id) => codeOf(id === 5 ? 'sphere' : 'stick', true)), Int32Array.from([2]))
    const back = decode(encode(s))
    expect(back && Array.from(back.ids)).toEqual([1, 2, 3, 5])
    expect(back && Array.from(back.code)).toEqual(Array.from(s.code))

    // Atom 3 deleted, atom 7 added: 3 is kept but not drawn, 7 coded as told.
    const now = withAtoms(back!, Int32Array.from([1, 2, 5, 7]), () => codeOf('ball', true))
    const shown = shownIds(now, Int32Array.from([1, 2, 5, 7]))
    expect(Array.from(now.ids)).toEqual([1, 2, 3, 5, 7])
    expect({ stick: Array.from(shown.stick), ball: Array.from(shown.ball), sphere: Array.from(shown.sphere) })
      .toEqual({ stick: [1], ball: [7], sphere: [5] })
  })
})
