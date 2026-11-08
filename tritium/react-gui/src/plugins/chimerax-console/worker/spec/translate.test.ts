/**
 * @file plugins/chimerax-console/worker/spec/translate.test.ts
 * @description A ChimeraX atom specification as CueMol's expression, per model.
 *
 * The cases pin what is easy to get wrong without noticing: a residue
 * number with an insertion code read as a name, a model number applied to
 * every object, a hex colour read as a model, a wildcard passed through as a
 * literal character (which then matches nothing), a zone that forgets the
 * other models, and a part not supported yet translated into something that
 * selects other atoms.
 */

import { describe, expect, it } from 'vitest'
import { emitFor } from './emit'
import type { EmitContext } from './emit'
import { parseSpec, SpecError } from './parse'
import { isSelector, withSceneSelectors } from './selectors'

/** The console's names (`name X spec`): one naming a model, one using it, and two using each other. */
const CHX_NAMES: Record<string, string> = { alc: '#2/A', both: 'alc | #1/B', loop1: 'loop2', loop2: 'loop1' }

/** Two molecules, #1 `1abc` and #2 `2xyz`; every expression hits chain A only. */
const scene: EmitContext = {
  models: [{ model: 1, name: '1abc' }, { model: 2, name: '2xyz' }],
  chainsHit: () => ['A'],
  anyHit: () => true,
  currentSelection: () => 'chain B',
  namedSelections: new Set(['site', ...Object.keys(CHX_NAMES)]),
  displayedAtoms: (model) => `shown${model}`,
  expandName: (name) => {
    const spec = CHX_NAMES[name]
    return spec === undefined ? undefined : withSceneSelectors(scene.namedSelections, () => parseSpec(spec, isSelector))?.node
  },
}

/** The expression in model `n`, or the error. */
function inModel(spec: string, n = 1): string {
  try {
    const read = withSceneSelectors(scene.namedSelections, () => parseSpec(spec, isSelector))
    return read ? emitFor(read.node, n, scene) : '(no spec)'
  } catch (e) {
    if (e instanceof SpecError) return `error: ${e.message}`
    throw e
  }
}

describe('atom specification translation', () => {
  it('translates the hierarchy, residue numbers and names, and the operators', () => {
    const cases: [string, string][] = [
      ['#1/A:10-20@CA', '(chain A) and ((resi 10:20) and (name CA))'],
      [':10-20,30', '(resi 10:20) or (resi 30)'],
      // An insertion code is a residue number; leading zeros are dropped for CueMol.
      [':010A-20B', 'resi 10A:20B'],
      // A name that is not a number with one letter after it.
      [':5HT', 'resn 5HT'],
      ['protein & ~:ALA', '(protein) and (not (resn ALA))'],
      ['Fe | ligand', '(elem Fe) or (ligand)'],
      // Wildcards are CueMol regular expressions, not literal characters.
      ['@C*', 'name /(?i)^C.*$/'],
      [':A?A', 'resn /(?i)^A.A$/'],
      [':start-5', 'resi -99999:5'],
      // Attribute tests.
      ['@@bfactor>50', 'bfac > 50'],
      ['@@occupancy>=0.5', 'not (occ < 0.5)'],
      ['::name=THR', 'resn THR'],
      ['::number<10', 'resi -99999:9'],
      ['::polymer_type=2', 'nucleic'],
      ['::^is_helix', 'not (helix)'],
      ['@@name==ca', 'name /^ca$/'],
      // A zone reaches the other model too, and keeps the reference atoms (`expand`).
      [':CYS :< 4', 'byres (((resn CYS) expand 4) or ((resn CYS) around 4 ["2xyz"]))'],
      ['ligand @> 5', 'not (((ligand) expand 5) or ((ligand) around 5 ["2xyz"]))'],
      ['ligand /< 5', 'chain A'],
      ['##name=2x*', 'none'],
      // `sel` is the molecule's current selection, a name the scene's named selection.
      ['sel & :CYS', '(chain B) and (resn CYS)'],
      ['site | :CYS', '(site) or (resn CYS)'],
    ]
    for (const [spec, expr] of cases) expect([spec, inModel(spec)]).toEqual([spec, expr])
  })

  it('applies a model part only in that model', () => {
    expect([inModel('#1/A | #2/B', 1), inModel('#1/A | #2/B', 2), inModel('#1/A | #2/B', 3)]).toEqual([
      'chain A',
      'chain B',
      'none',
    ])
  })

  it('reads a hex colour as no specification, and refuses what it cannot translate', () => {
    expect(inModel('#ff0000')).toBe('(no spec)')
    expect(inModel('red')).toBe('(no spec)')
    expect(inModel('#1.2')).toMatch(/sub-model is not supported/)
    expect(inModel('ions')).toMatch(/"ions" is not supported/)
    expect(inModel('@@idatm_type=C3')).toMatch(/attribute "idatm_type" is not supported/)
  })
})

describe('@@display', () => {
  it('is the displayed atoms of each model, and its negations the others', () => {
    expect(inModel('@@display', 2)).toBe('shown2')
    expect(inModel(':10@@display')).toBe('(resi 10) and (shown1)')
    expect(inModel('@@^display')).toBe('not (shown1)')
    expect(inModel('@@display=false')).toBe('not (shown1)')
  })
})

describe('model forms and console names', () => {
  it('reads #! as the model itself (CueMol objects have no sub-models)', () => {
    expect(inModel('#!1', 1)).toBe('*')
    expect(inModel('#!1', 2)).toBe('none')
    expect(inModel('#!1.2')).toMatch(/^error: a sub-model/)
  })

  it('emits a name where it is used, so a name may name a model and use other names', () => {
    expect([inModel('alc', 1), inModel('alc', 2)]).toEqual(['none', 'chain A'])
    expect([inModel('both', 1), inModel('both', 2)]).toEqual(['chain B', 'chain A'])
    expect(inModel('loop1')).toBe('error: the name "loop1" is used inside itself')
  })
})
