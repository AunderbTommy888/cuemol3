/**
 * @file plugins/chimerax-console/worker/colorSchemes.test.ts
 * @description ChimeraX's chain colours and `rainbow`'s ranges.
 *
 * Pinned: a chain id is looked up case-blind in ChimeraX's table (`/a` and
 * `/A` share a colour), and `rainbow residues` keeps the paint table small
 * -- at most RAINBOW_STEPS ranges per chain, blue at the first residue and
 * red at the last, `^` running it backwards.
 */

import { describe, expect, it } from 'vitest'
import { chainColor, RAINBOW, RAINBOW_STEPS, rainbowRanges, readPalette } from './colorSchemes'
import { modifyColor } from './colorModify'

describe('chain colours', () => {
  it('reads ChimeraX\'s table case-blind, and hashes an id outside it', () => {
    expect(chainColor('A')).toEqual({ hex: '#7b68ee', exact: true })
    expect(chainColor('a').hex).toBe(chainColor('A').hex)
    expect(chainColor('AB').exact).toBe(false)
  })
})

describe('rainbow residues', () => {
  it('merges residues of one colour into ranges, at most RAINBOW_STEPS, blue to red', () => {
    const residues = Array.from({ length: 200 }, (_, i) => String(i + 1))
    const ranges = rainbowRanges(residues, RAINBOW)
    expect(ranges).toHaveLength(RAINBOW_STEPS)
    expect(ranges[0].slice(0, 1)).toEqual(['1'])
    expect(ranges[0][2]).toBe('#0000ff')
    expect(ranges[ranges.length - 1]).toEqual([expect.any(String), '200', '#ff0000'])
    // Every residue is in exactly one range, in order.
    expect(ranges.map((r) => [Number(r[0]), Number(r[1])]).every(([a, b], i, all) => a <= b && (i === 0 || a === all[i - 1][1] + 1))).toBe(true)

    const reversed = readPalette('^rainbow')
    expect(reversed.ok && rainbowRanges(['1', '2'], reversed.palette).map((r) => r[2])).toEqual(['#ff0000', '#0000ff'])
  })
})

describe('palettes and colour changes', () => {
  it('reads ColorBrewer palettes by name and count, and by name alone at the default count', () => {
    const p4 = readPalette('Pastel2-4')
    expect(p4.ok && p4.palette.stops.length).toBe(4)
    const p = readPalette('pastel2')
    expect(p.ok && p.palette.stops.length).toBe(6)
  })

  it('changes a colour as ChimeraX\'s color modify (values from Python colorsys)', () => {
    expect(modifyColor('#d2b48c', 'hue', 'add', 45 / 360)).toBe('#bbd28c')
    expect(modifyColor('#40ff40', 'whiteness', 'add', -0.5)).toBe('#00ff00')
    expect(modifyColor('#808080', 'hue', 'add', 0.1)).toBe('#808080')
  })
})
