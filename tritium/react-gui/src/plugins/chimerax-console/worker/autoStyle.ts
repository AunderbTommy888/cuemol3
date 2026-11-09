/**
 * @file plugins/chimerax-console/worker/autoStyle.ts
 * @description How a molecule is drawn when `open` reads it, after ChimeraX's
 * automatic styling (`atomic/structure.py` `apply_auto_styling`).
 *
 * The molecule is sized up as ChimeraX does (its polymer chains, atoms and
 * polymer residues, with ChimeraX's thresholds), and the console's
 * renderers get the selections and colours of that style:
 *
 * - non-polymer, or a small polymer with 10 residues or fewer: every atom
 *   as a stick, the model colour with heteroatoms by element.
 * - small polymer: the cartoon, the ligands and metals with the residues
 *   within 3.6 A of them as sticks (metals and ions as spheres), hydrogens
 *   on carbon hidden, the model colour with heteroatoms by element. Nucleic
 *   acid bases are slabs (100 nucleotides or fewer) or a ladder (2000 or
 *   fewer), coloured by base (`nucleotides`, `nucleotide_colors`).
 * - medium polymer: every atom as a sphere, ligands as sticks, solvent as
 *   balls; coloured by chain when all chains have one sequence, ligands and
 *   solvent by element.
 * - large polymer: every atom as a sphere in the model colour.
 *
 * Where CueMol cannot tell what ChimeraX tells, the console comes close:
 * - ions are halide and metal atoms (ChimeraX: one-atom residues);
 * - a hydrogen on carbon is told by its name (ChimeraX: by its bond);
 * - medium and large polymers with several sequences keep the model colour
 *   (ChimeraX colours each sequence with a seeded random colour), and say so.
 */

import type { WorkerContext } from '@renderer/worker/server/types/WorkerContext'
import type { CmdContext, CmdOutcome } from '@plugins/console/worker/dialect-api'
import { chainColor, modelColor } from './colorSchemes'
import { ATOM_STYLES, CARTOONS, ensureOwned, forEachAtom, minus, NUCL_BASE, STYLE_KEYS, union, writeHidden, writeSel } from './display'
import type { AtomStyle, BaseMode } from './display'
import { nucleotideEntries } from './colorSchemes'
import type { NumberedObject } from './models'
import { NONE } from './spec/emit'
import { HALIDE_ION, LIGAND, METAL, NONPOLAR_H } from './atomClasses'

export { LIGAND, METAL, NONPOLAR_H }
import { elementEntries, paintTarget } from './commands/colorCommands'
import { setBaseMode } from './commands/displayCommands'
import type { PaintEntry } from './commands/colorCommands'

/** ChimeraX's size thresholds (`atomic/structure.py`). */
const SMALL_THRESHOLD = 200_000
const MEDIUM_THRESHOLD = 1_000_000
const MIN_RIBBON_THRESHOLD = 10
const MAX_RIBBON_THRESHOLD = 5000
const SLAB_THRESHOLD = 100
const LADDER_THRESHOLD = 2000

const POLYMER = '(protein or nucleic)'

/** The atoms the small-polymer style shows: the residues within 3.6 A of a ligand or metal. */
export const SMALL_SHOWN = minus(`byres ((${LIGAND}) expand 3.6)`, NONPOLAR_H)

export type AutoStyle = 'non-polymer' | 'small polymer' | 'medium polymer' | 'large polymer'

/** What decides the style: polymer chains, atoms, polymer residues, and whether all chains share one sequence. */
export interface MoleculeSize {
  chains: number
  atoms: number
  residues: number
  oneSequence: boolean
}

/** ChimeraX's choice of style from a molecule's size. */
export function autoStyleOf(m: MoleculeSize): AutoStyle {
  if (m.chains === 0) return 'non-polymer'
  if (m.chains < 5 && m.atoms < SMALL_THRESHOLD && m.residues < MAX_RIBBON_THRESHOLD) return 'small polymer'
  if (m.chains < 250 && m.atoms < MEDIUM_THRESHOLD) return 'medium polymer'
  return 'large polymer'
}

/** How many nucleic acid residues a molecule has. */
function nucleicCount(ctx: WorkerContext, sceneId: number, objUid: number): number {
  let n = 0
  let lastKey = ''
  forEachAtom(ctx, sceneId, objUid, 'nucleic', (a) => {
    const key = `${a.chainName}:${a.residIndex}`
    if (key !== lastKey) n++
    lastKey = key
  })
  return n
}

/** The nucleotides a small polymer draws: slabs, a ladder, or (too many) neither. */
export function baseModeOf(nucleotides: number): BaseMode | null {
  if (nucleotides === 0 || nucleotides > LADDER_THRESHOLD) return null
  return nucleotides <= SLAB_THRESHOLD ? 'slab' : 'ladder'
}

/** A molecule's size, read from its atoms. */
function sizeOf(ctx: WorkerContext, sceneId: number, objUid: number): MoleculeSize & { chainIds: string[] } {
  let atoms = 0
  forEachAtom(ctx, sceneId, objUid, '*', () => { atoms++ })
  const seqs = new Map<string, string[]>()
  let lastKey = ''
  forEachAtom(ctx, sceneId, objUid, POLYMER, (a) => {
    const key = `${a.chainName}:${a.residIndex}`
    if (key === lastKey) return
    lastKey = key
    const s = seqs.get(a.chainName) ?? []
    s.push(a.residName)
    seqs.set(a.chainName, s)
  })
  const sequences = new Set([...seqs.values()].map((s) => s.join(' ')))
  return {
    chains: seqs.size,
    atoms,
    residues: [...seqs.values()].reduce((n, s) => n + s.length, 0),
    oneSequence: sequences.size <= 1,
    chainIds: [...seqs.keys()].sort(),
  }
}

/**
 * The style ChimeraX's automatic styling gives every atom, shown or not
 * (`apply_auto_styling`, after the Initial Styles reset every atom to
 * sphere): small polymer sticks, metals and ions spheres; medium spheres,
 * ligands sticks, solvent balls; large spheres; non-polymer sticks. CueMol
 * draws an atom only in the renderer of its style, so this is the style of
 * an atom in no console renderer ("unassigned", `display.ts`).
 *
 * @param given - the style asked for (a preset); by the molecule's size when absent
 */
function drawModesOf(size: MoleculeSize, given?: AutoStyle): Record<AtomStyle, string> {
  const style = given ?? autoStyleOf(size)
  if (style === 'non-polymer' || (style === 'small polymer' && given === undefined && size.residues <= MIN_RIBBON_THRESHOLD)) {
    return { stick: '*', ball: NONE, sphere: NONE }
  }
  if (style === 'small polymer') {
    const spheres = `(${METAL} or ${HALIDE_ION})`
    return { stick: minus('*', spheres), ball: NONE, sphere: spheres }
  }
  if (style === 'medium polymer') {
    return { stick: LIGAND, ball: 'water', sphere: minus('*', `(${LIGAND}) or water`) }
  }
  return { stick: NONE, ball: NONE, sphere: '*' }
}

/** The style an unassigned atom of molecule `objUid` has: the automatic styling's, from the molecule's size. */
export function initialStylesOf(ctx: WorkerContext, sceneId: number, objUid: number): Record<AtomStyle, string> {
  return drawModesOf(sizeOf(ctx, sceneId, objUid))
}

/** The selections of the console's renderers a style draws. */
interface Shown {
  stick: string
  ball: string
  sphere: string
  cartoon: string
  nucl: string
}

/**
 * Style a molecule as ChimeraX's automatic styling would: when it is opened,
 * and for the Initial Styles presets (`apply_auto_styling(style=...)`).
 *
 * @param given - the style to apply (a preset); by the molecule's size when absent
 * @param preset - a preset on a molecule already open: the styles of the
 *   hidden atoms are set again too (ChimeraX resets every atom first), so
 *   none kept from before stays; when it opens, there are none to set
 */
export async function applyAutoStyle(ctx: WorkerContext, cc: CmdContext, obj: NumberedObject, given?: AutoStyle, preset = false): Promise<CmdOutcome> {
  const owned = await ensureOwned(ctx, cc, obj)
  if (!owned.ok) return owned
  const size = sizeOf(ctx, cc.sceneId, obj.uid)
  const style = given ?? autoStyleOf(size)
  const model = modelColor(obj.model)
  if (!model.exact) cc.warn(`open: #${obj.model} is past ChimeraX's model colours; its colour differs from ChimeraX's`)
  const none = NONE
  let bases: BaseMode | null = null
  let shown: Shown
  // Paint entries per target letters, painted in order (a later entry wins).
  let paints: [string, PaintEntry[]][]
  // A short peptide is drawn as sticks, unless the style was asked for (ChimeraX's `explicit_style`).
  if (style === 'non-polymer' || (style === 'small polymer' && given === undefined && size.residues <= MIN_RIBBON_THRESHOLD)) {
    shown = { stick: '*', ball: none, sphere: none, cartoon: none, nucl: none }
    paints = [['ac', [['*', model.hex]]], ['a', elementEntries('*', false)]]
  } else if (style === 'small polymer') {
    const spheres = `(${SMALL_SHOWN}) and (${METAL} or ${HALIDE_ION})`
    bases = baseModeOf(nucleicCount(ctx, cc.sceneId, obj.uid))
    shown = { stick: minus(SMALL_SHOWN, spheres), ball: none, sphere: spheres, cartoon: 'protein', nucl: 'nucleic' }
    paints = [['ac', [['*', model.hex]]], ['a', elementEntries('*', false)]]
  } else if (style === 'medium polymer') {
    shown = { stick: LIGAND, ball: 'water', sphere: minus('*', `(${LIGAND}) or water`), cartoon: none, nucl: none }
    if (!size.oneSequence) cc.warn('open: chains with different sequences keep the model colour (ChimeraX colours each sequence)')
    const byChain: PaintEntry[] = size.oneSequence ? size.chainIds.map((c) => [`chain ${c}`, chainColor(c).hex]) : []
    paints = [['ac', [['*', model.hex], ...byChain]], ['a', elementEntries(`(${LIGAND}) or water`, false)]]
  } else {
    shown = { stick: none, ball: none, sphere: '*', cartoon: none, nucl: none }
    if (!size.oneSequence) cc.warn('open: chains with different sequences keep the model colour (ChimeraX colours each sequence)')
    paints = [['ac', [['*', model.hex]]]]
  }
  const ids = owned.ids
  const writes: [string, string][] = [
    [ATOM_STYLES.stick.name, shown.stick],
    [ATOM_STYLES.ball.name, shown.ball],
    [ATOM_STYLES.sphere.name, shown.sphere],
    [CARTOONS[0].name, shown.cartoon],
    [CARTOONS[1].name, shown.nucl],
    [NUCL_BASE.name, shown.nucl],
  ]
  for (const [name, sel] of writes) {
    const id = ids.get(name)
    if (id === undefined) continue
    const w = await writeSel(ctx, cc, id, sel)
    if (!w.ok) return w
  }
  if (preset) {
    // The hidden atoms keep the preset's style where it differs from the one they have unassigned.
    const after = drawModesOf(size, given)
    const initial = drawModesOf(size)
    const visible = union(union(shown.stick, shown.ball), shown.sphere)
    const hidden = Object.fromEntries(STYLE_KEYS.map((s) => [s, minus(minus(after[s], visible), initial[s])])) as Record<AtomStyle, string>
    const h = await writeHidden(ctx, cc, obj, ids, hidden)
    if (!h.ok) return h
  }
  // Painted in order, each entry first in the table: the later ones win. The
  // first colours every atom, so the table is cleared before it (a preset
  // applied again does not grow it).
  for (const [i, [target, entries]] of paints.entries()) {
    const res = await paintTarget(ctx, cc, { obj, sel: '*' }, target, entries, false, i === 0)
    if (!res.ok) return res
  }
  const drawn = await setBaseMode(ctx, cc, ids, bases ?? 'atoms')
  if (!drawn.ok) return drawn
  if (bases) {
    // The base slabs by base (`nucleic.ring_colors = nucleotide_colors(...)`); the rest keeps the model colour.
    const ringed = await paintTarget(ctx, cc, { obj, sel: '*' }, 'f', nucleotideEntries(), false, true)
    if (!ringed.ok) return ringed
  }
  return { ok: true }
}
