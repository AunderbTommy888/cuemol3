/**
 * @file plugins/chimerax-console/worker/commands/colorCommands.ts
 * @description `color`: [spec] [color | byhetero | byelement | bychain |
 * bymodel], target; and `rainbow`.
 *
 * A colour is a paint entry put first in the paint table of each `chx:`
 * renderer the target reaches (`add_paint_at`), so a later `color` wins
 * over an earlier one where they overlap. A colouring that covers a whole
 * molecule (a colour, `bychain` or `bymodel` on `#1` or on everything)
 * hides every entry before it, so those are cleared first: the table does
 * not grow each time the molecule is coloured again. The atom renderers all get the
 * same entries, so a colour stays when an atom changes style. A renderer is
 * switched to per-selection colouring only when it is not one already
 * (`ensurePaint`): switching starts a new table.
 *
 * `byhetero` colours every atom but carbon by element (Jmol colours, as
 * ChimeraX) and leaves carbons and the cartoon as they are; `byelement`
 * colours carbons too. `bychain` and `bymodel` colour atoms, cartoons and
 * surfaces alike (`colorSchemes.ts`); `bynucleotide` colours the
 * nucleotides by base (atoms, cartoon and base slabs). `bypolymer` and
 * `byidentity` (a random colour per sequence) are not supported yet.
 * `random` (a colour per
 * atom in ChimeraX) is refused too: an entry per atom, or even per residue,
 * makes the paint table as long as the molecule and colouring slow.
 *
 * `rainbow` colours each chain's residues along a palette, in RAINBOW_STEPS
 * colours, one paint entry per run of residues of one colour.
 *
 * `color byattribute bfactor|occupancy` (and `color bfactor`) colours atoms
 * by their value along a palette, in VALUE_STEPS colours: one paint entry
 * per step (`bfac > t`), so a later `color` paints over it as over any
 * other colour. The atoms and the range are ChimeraX's (all the atoms
 * named, together); only the colours are stepped.
 */

import type { WorkerContext } from '@renderer/worker/server/types/WorkerContext'
import type { CmdContext, CmdOutcome } from '@plugins/console/worker/dialect-api'
import { ColorArg, EnumOf, FloatArg, ListOf, Or, SpecArg, StringArg } from '../cli/argTypes'
import { chxCommand } from '../cli/command'
import type { ChxCommand } from '../cli/command'
import { BUILTIN_COLORS, ELEMENT_COLORS } from '../colorTables'
import { readColor, splitColorArg } from '../colors'
import { chainColor, modelColor, nucleotideEntries, paletteColors, plddtEntries, RAINBOW, rainbowRanges, readPaletteOrFetch, VALUE_STEPS, valueEntries, valueRange } from '../colorSchemes'
import { ATOM_STYLES, CARTOONS, NUCL_BASE, atomRenderers, cartoonRenderers, emitContext, ensureOwned, ensurePaint, forEachAtom, intersect, isPaintColoring, ownedOn, paintCount, prependPaint, readPaint, replacePaint, runOp, targetsOf } from '../display'
import type { PaintRow, Target } from '../display'
import type { NumberedObject } from '../models'
import { surfacesOn } from '../surface'
import { unsupported, warnIgnored } from './warn'
import { mapObjectsOf, mapSurfaceRenderers } from './mapCommands'
import { modifyColor } from '../colorModify'
import type { Adjuster, ModifyOp } from '../colorModify'
import { NONE } from '../spec/emit'

/** The colourings by name the console does. */
const SPECIAL = ['byhetero', 'byelement', 'bychain', 'bymodel', 'bynucleotide']

/** Surfaces coloured from their atoms or cartoon (`colorFromAtoms`); words of the colour argument as the others. */
const FROM_ATOMS = 'fromatoms'
const FROM_CARTOONS = ['fromcartoons', 'fromribbons']

/** Those that colour atoms only, leaving the cartoon as it is. */
const ATOMS_ONLY = ['byhetero', 'byelement']

/** Those that leave out some atoms of what they colour (carbons, non-nucleotides), so cannot replace the table. */
const PARTIAL = [...ATOMS_ONLY, 'bynucleotide']

/** ChimeraX's other colourings by name: refused, with the reason. */
const REFUSED: Readonly<Record<string, string>> = {
  bypolymer: 'not supported yet (a random colour per sequence)',
  byidentity: 'not supported yet (a random colour per sequence)',
  byatom: 'use byelement',
  random: 'a colour per atom makes the paint table as long as the molecule',
}

/**
 * The elements `byhetero` / `byelement` paint: those common in
 * biomolecules and their ligands. A paint entry per element of the
 * periodic table would make the table unreadable for no gain.
 */
const PAINTED_ELEMENTS = ['C', 'N', 'O', 'S', 'P', 'H', 'F', 'Cl', 'Br', 'I', 'Se', 'Fe', 'Zn', 'Mg', 'Ca', 'Mn', 'Cu', 'Co', 'Ni', 'Na', 'K']

/** A paint entry: [selection, #rrggbb]. */
export type PaintEntry = [string, string]

/** The polymer residues, which ChimeraX's chains are made of. */
const POLYMER = '(protein or nucleic)'

/** The residues `expr` reaches in a molecule, by chain, in chain order. */
export function residuesByChain(ctx: WorkerContext, sceneId: number, objUid: number, expr: string): Map<string, string[]> {
  const out = new Map<string, string[]>()
  const seen = new Set<string>()
  forEachAtom(ctx, sceneId, objUid, expr, (a) => {
    const key = `${a.chainName}:${a.residIndex}`
    if (seen.has(key)) return
    seen.add(key)
    const list = out.get(a.chainName) ?? []
    list.push(a.residIndex)
    out.set(a.chainName, list)
  })
  return out
}

/** Paint entries colouring the atoms of `sel` by element, carbon left out unless `carbon`. */
export function elementEntries(sel: string, carbon: boolean): PaintEntry[] {
  const elements = carbon ? PAINTED_ELEMENTS : PAINTED_ELEMENTS.filter((e) => e !== 'C')
  return elements.map((e) => [intersect(sel, `elem ${e}`), ELEMENT_COLORS[e] ?? '#b4b4b4'])
}

/** The paint entries a colour argument means in a target. */
function entriesFor(ctx: WorkerContext, cc: CmdContext, color: string, t: Target): PaintEntry[] {
  if (ATOMS_ONLY.includes(color)) return elementEntries(t.sel, color === 'byelement')
  if (color === 'bychain') {
    return emitContext(ctx, cc.sceneId).chainsHit(t.obj.model, t.sel).map((chain) => {
      const c = chainColor(chain)
      if (!c.exact) cc.warn(`color: chain ${chain} has no colour in ChimeraX's table; its colour differs from ChimeraX's`)
      return [intersect(t.sel, `chain ${chain}`), c.hex]
    })
  }
  if (color === 'bynucleotide') return nucleotideEntries(t.sel)
  if (color === 'bymodel') {
    const c = modelColor(t.obj.model)
    if (!c.exact) cc.warn(`color: #${t.obj.model} is past ChimeraX's model colours; its colour differs from ChimeraX's`)
    return [[t.sel, c.hex]]
  }
  return [[t.sel, color]]
}

/**
 * Put paint entries first in the tables of the renderers target letters
 * name on a molecule: a, b atoms; c, r cartoons (unless `atomsOnly`); f the
 * filled base rings (`chx:nuclbase`'s slabs); s the surfaces there are
 * (colouring does not make one).
 *
 * @param replace - the entries colour every atom of the molecule, so the
 *   entries already there can never show again: clear them first
 */
export async function paintTarget(ctx: WorkerContext, cc: CmdContext, t: Target, target: string, entries: readonly PaintEntry[], atomsOnly = false, replace = false): Promise<CmdOutcome> {
  if (entries.length === 0) return { ok: true }
  const owned = await ensureOwned(ctx, cc, t.obj)
  if (!owned.ok) return owned
  const r = atomRenderers(owned.ids)
  const rends = [
    ...(/[ab]/.test(target) ? [r.stick, r.ball, r.sphere] : []),
    ...(/[cr]/.test(target) && !atomsOnly ? cartoonRenderers(owned.ids).map((c) => c.id) : []),
    ...(/f/.test(target) && !atomsOnly ? [owned.ids.get(NUCL_BASE.name) as number] : []),
    ...(/s/.test(target) ? surfacesOn(ctx, cc.sceneId, t.obj.uid).map((s) => s.id) : []),
  ]
  for (const id of rends) {
    const painted = await ensurePaint(ctx, cc, id)
    if (!painted.ok) return painted
    if (replace && paintCount(ctx, cc.sceneId, id) > 0) {
      const cleared = await runOp(ctx, cc, 'clear_paint', { nodeId: id, nodeType: 'renderer' })
      if (!cleared.ok) return cleared
    }
    for (const [selection, hex] of entries) {
      const res = await runOp(ctx, cc, 'add_paint_at', { nodeId: id, nodeType: 'renderer', selection, color: hex, at: 1 })
      if (!res.ok) return res
    }
  }
  return { ok: true }
}

/**
 * Colour a whole molecule by pLDDT, as ChimeraX colours an AlphaFold model
 * when it opens (`alphafold/fetch.py` `_color_by_confidence`): atoms and
 * cartoons, replacing the colours it was opened with.
 */
export function colorByPlddt(ctx: WorkerContext, cc: CmdContext, obj: NumberedObject): Promise<CmdOutcome> {
  return paintTarget(ctx, cc, { obj, sel: '*' }, 'ac', plddtEntries(), false, true)
}

/** ChimeraX's default target, acsbpf: atoms (and bonds), cartoons, surfaces... */
const DEFAULT_TARGET = 'acsbpf'

const color: ChxCommand = chxCommand({
  words: ['color'],
  args: [
    { name: 'objects', type: SpecArg, role: 'optional' },
    { name: 'color', type: Or(ColorArg, EnumOf([...SPECIAL, FROM_ATOMS, ...FROM_CARTOONS, ...Object.keys(REFUSED)])), role: 'optional' },
    { name: 'what', type: StringArg, role: 'optional', ignored: true },
    { name: 'target', type: StringArg, role: 'keyword' },
    { name: 'transparency', type: StringArg, role: 'keyword', ignored: true },
    { name: 'halfbond', type: StringArg, role: 'keyword', ignored: true },
  ],
  mutates: true,
  summary: 'Colour atoms, cartoons and surfaces: a colour, byhetero, byelement, bychain or bymodel.',
  async run(ctx, args, cc): Promise<CmdOutcome> {
    warnIgnored(cc, 'color', args, ['what', 'transparency', 'halfbond'])
    if (args.color === '') return { ok: false, error: 'Error: color: give a colour or one of byhetero, byelement, bychain, bymodel' }
    const refused = REFUSED[args.color]
    if (refused) return unsupported(`Error: color: ${args.color} is not supported (${refused})`)
    if (args.color === FROM_ATOMS) return colorFromAtoms(ctx, cc, args.objects, args.target, 'atoms')
    if (FROM_CARTOONS.includes(args.color)) return colorFromAtoms(ctx, cc, args.objects, args.target, 'cartoon')
    // CueMol's paint has no alpha; a colour that states one is drawn opaque.
    const { hex: colorValue, alpha } = SPECIAL.includes(args.color) ? { hex: args.color, alpha: null } : splitColorArg(args.color)
    if (alpha !== null && alpha < 1) cc.warn('color: transparency in a colour is not supported yet; drawn opaque')
    const target = args.target === '' ? DEFAULT_TARGET : args.target
    const found = targetsOf(ctx, cc.sceneId, args.objects)
    if (!found.ok) return found
    for (const t of found.targets) {
      // On the whole molecule, every colouring but a partial one covers each atom.
      const replace = t.sel === '*' && !PARTIAL.includes(colorValue)
      const res = await paintTarget(ctx, cc, t, target, entriesFor(ctx, cc, colorValue, t), ATOMS_ONLY.includes(colorValue), replace)
      if (!res.ok) return res
    }
    return { ok: true }
  },
})

/**
 * `color <spec> fromatoms`: the surface patches of the atoms named take the
 * atoms' colours, copied once from the console's atom renderers (ChimeraX
 * copies the colours once too; later changes to the atoms do not follow).
 * On a whole molecule the surface's table is replaced; on part of one the
 * copied entries, limited to the part, go first in the surface's table. A
 * surface not coloured by paint (the default colouring) cannot keep the rest
 * of its colours that way, so part of one is left as it is, with a warning;
 * so is a molecule whose atoms the console has not painted.
 */
async function colorFromAtoms(ctx: WorkerContext, cc: CmdContext, spec: string, target: string, from: 'atoms' | 'cartoon'): Promise<CmdOutcome> {
  const word = from === 'atoms' ? 'fromatoms' : 'fromcartoons'
  if (target !== '' && !target.includes('s')) cc.warn(`color ${word}: only surfaces are coloured from ${from === 'atoms' ? 'atoms' : 'the cartoon'}; target is ignored`)
  const sources = from === 'atoms' ? [ATOM_STYLES.sphere.name, ATOM_STYLES.stick.name, ATOM_STYLES.ball.name] : CARTOONS.map((k) => k.name)
  const found = targetsOf(ctx, cc.sceneId, spec)
  if (!found.ok) return found
  for (const t of found.targets) {
    const surfaces = surfacesOn(ctx, cc.sceneId, t.obj.uid)
    if (surfaces.length === 0) continue
    const owned = ownedOn(ctx, cc.sceneId, t.obj.uid)
    let rows: PaintRow[] | null = null
    for (const name of sources) {
      const id = owned.get(name)
      rows = id === undefined ? null : await readPaint(ctx, cc, id)
      if (rows) break
    }
    if (!rows) {
      cc.warn(`color ${word}: the ${from === 'atoms' ? 'atoms' : 'cartoon'} of #${t.obj.model} has no console colours to copy; its surfaces are left as they are`)
      continue
    }
    for (const s of surfaces) {
      if (t.sel === '*') {
        const res = await replacePaint(ctx, cc, s.id, rows)
        if (!res.ok) return res
        continue
      }
      if (!isPaintColoring(ctx, cc.sceneId, s.id)) {
        cc.warn(`color ${word}: a surface of #${t.obj.model} is not painted; colour the whole model first (color #${t.obj.model} ${word})`)
        continue
      }
      const res = await prependPaint(ctx, cc, s.id, rows.map((r) => ({ selStr: intersect(r.selStr, t.sel), colorValue: r.colorValue })))
      if (!res.ok) return res
    }
  }
  return { ok: true }
}

/** The atom values `color byattribute` colours by, and CueMol's selection keyword for each. */
const VALUE_ATTRS: Readonly<Record<string, 'bfac' | 'occ'>> = {
  bfactor: 'bfac', 'a:bfactor': 'bfac', occupancy: 'occ', 'a:occupancy': 'occ',
}

/** What `what` names, as target letters. */
const WHAT_LETTERS: Readonly<Record<string, string>> = { atoms: 'a', cartoons: 'c', ribbons: 'r', surfaces: 's' }

const BYATTR_IGNORED = ['average', 'noValueColor', 'transparency', 'key', 'logInfo']

/** Read `range`: `full`, or `lo,hi`. */
function readRange(text: string): { ok: true; range: [number, number] | 'full' | null } | { ok: false; error: string } {
  if (text === '') return { ok: true, range: null }
  if (text === 'full') return { ok: true, range: 'full' }
  const r = text.split(',').map(Number)
  if (r.length !== 2 || !r.every(Number.isFinite) || r[0] > r[1]) return { ok: false, error: 'range is full or lo,hi' }
  return { ok: true, range: [r[0], r[1]] }
}

/** `color byattribute <attr> ...` (and `color bfactor`, its alias with the attribute fixed). */
function colorByAttr(words: string[], attr: string | null): ChxCommand {
  return chxCommand({
    words,
    args: [
      ...(attr === null ? [{ name: 'attrName', type: StringArg, role: 'required' as const }] : []),
      { name: 'atoms', type: SpecArg, role: 'optional' },
      { name: 'what', type: ListOf(EnumOf(Object.keys(WHAT_LETTERS))), role: 'optional' },
      { name: 'target', type: StringArg, role: 'keyword' },
      { name: 'palette', type: StringArg, role: 'keyword' },
      { name: 'range', type: StringArg, role: 'keyword' },
      ...BYATTR_IGNORED.map((name) => ({ name, type: StringArg, role: 'keyword' as const, ignored: true })),
    ],
    mutates: true,
    summary: attr === null
      ? 'Colour atoms by bfactor or occupancy along a palette (blue-white-red).'
      : `Colour atoms by ${attr} along a palette (blue-white-red).`,
    async run(ctx, args, cc): Promise<CmdOutcome> {
      const name = words.join(' ')
      warnIgnored(cc, name, args, BYATTR_IGNORED)
      const attrName = attr ?? args.attrName
      const kw = VALUE_ATTRS[attrName]
      if (!kw) return unsupported(`Error: ${name}: attribute "${attrName}" is not supported (bfactor or occupancy)`)
      const pal = await readPaletteOrFetch(args.palette === '' ? 'blue-white-red' : args.palette)
      if (!pal.ok) return { ok: false, error: `Error: ${name}: ${pal.error}` }
      const range = readRange(args.range)
      if (!range.ok) return { ok: false, error: `Error: ${name}: ${range.error}` }
      const found = targetsOf(ctx, cc.sceneId, args.atoms)
      if (!found.ok) return found
      // One range over every atom named, in every model (ChimeraX `_value_colors`).
      let min = Infinity
      let max = -Infinity
      let count = 0
      for (const t of found.targets) {
        forEachAtom(ctx, cc.sceneId, t.obj.uid, t.sel, (a) => {
          const v = kw === 'bfac' ? a.bfac : a.occ
          if (v < min) min = v
          if (v > max) max = v
          count++
        })
      }
      if (count === 0) return { ok: false, error: `Error: ${name}: no atoms specified` }
      const [lo, hi] = valueRange(pal.palette, range.range, min, max)
      const letters = args.what === '' ? '' : args.what.split(',').map((w) => WHAT_LETTERS[w]).join('')
      const target = args.target !== '' ? args.target : letters !== '' ? letters : DEFAULT_TARGET
      if (/[cr]/.test(target)) cc.warn(`${name}: a cartoon takes the value of one atom of each residue (ChimeraX averages the residue)`)
      cc.print(`${count} atoms, atom ${attrName.replace(/^a:/, '')} range ${Number(min.toPrecision(4))} to ${Number(max.toPrecision(4))}`)
      for (const t of found.targets) {
        const res = await paintTarget(ctx, cc, t, target, valueEntries(kw, pal.palette, lo, hi, VALUE_STEPS, t.sel), false, t.sel === '*')
        if (!res.ok) return res
      }
      return { ok: true }
    },
  })
}

const LEVELS = ['residues', 'chains', 'polymers', 'structures']

const rainbow: ChxCommand = chxCommand({
  words: ['rainbow'],
  args: [
    { name: 'objects', type: SpecArg, role: 'optional' },
    { name: 'level', type: EnumOf(LEVELS), role: 'optional', default: 'residues' },
    { name: 'target', type: StringArg, role: 'keyword' },
    { name: 'transparency', type: FloatArg, role: 'keyword', ignored: true },
    { name: 'palette', type: StringArg, role: 'keyword' },
  ],
  mutates: true,
  summary: 'Colour residues along each chain (or chains, or models) through a palette, blue to red.',
  async run(ctx, args, cc): Promise<CmdOutcome> {
    warnIgnored(cc, 'rainbow', args, ['transparency'])
    if (args.level === 'polymers') return unsupported('Error: rainbow: polymers is not supported yet (the console does not compare sequences)')
    const pal = args.palette === '' ? { ok: true as const, palette: RAINBOW } : await readPaletteOrFetch(args.palette)
    if (!pal.ok) return { ok: false, error: `Error: rainbow: ${pal.error}` }
    const target = args.target === '' ? DEFAULT_TARGET : args.target
    const found = targetsOf(ctx, cc.sceneId, args.objects)
    if (!found.ok) return found
    const modelHexes = paletteColors(pal.palette, found.targets.length)
    for (const [i, t] of found.targets.entries()) {
      let entries: PaintEntry[]
      if (args.level === 'structures') {
        entries = [[t.sel, modelHexes[i]]]

      } else if (args.level === 'chains') {
        // As ChimeraX, the whole of each chain reached, in chain id order.
        const chains = emitContext(ctx, cc.sceneId).chainsHit(t.obj.model, intersect(t.sel, POLYMER))
        const hexes = paletteColors(pal.palette, chains.length)
        entries = chains.map((c, k) => [`chain ${c} and ${POLYMER}`, hexes[k]])
      } else {
        entries = []
        for (const [chain, residues] of residuesByChain(ctx, cc.sceneId, t.obj.uid, intersect(t.sel, POLYMER))) {
          for (const [first, last, hex] of rainbowRanges(residues, pal.palette)) {
            const resi = first === last ? first : `${first}:${last}`
            entries.push([intersect(t.sel, `chain ${chain} and resi ${resi} and ${POLYMER}`), hex])
          }
        }
      }
      const res = await paintTarget(ctx, cc, t, target, entries)
      if (!res.ok) return res
    }
    return { ok: true }
  },
})

/**
 * `color zone <surfaces> near <atoms> [distance d]` on maps: an isosurface
 * renderer can colour its surface by the nearest atom of one molecule
 * (`colormode molecule`, its `target` and `sel`; `MapSurfRenderer::
 * getColorMol`), the colours taken from the molecule's atom renderers'
 * paint table, copied once. CueMol has no distance limit there: the whole
 * surface takes the nearest atom's colour (ChimeraX leaves farther parts as
 * they were), said by a warning. A mesh has no such colouring; molecular
 * surfaces are not done yet.
 */
const COLOR_ZONE_IGNORED = ['sharpEdges', 'bondPointSpacing', 'farColor', 'update']

const colorZone: ChxCommand = chxCommand({
  words: ['color', 'zone'],
  args: [
    { name: 'surfaces', type: SpecArg, role: 'required' },
    { name: 'near', type: SpecArg, role: 'keyword' },
    { name: 'distance', type: FloatArg, role: 'keyword' },
    ...COLOR_ZONE_IGNORED.map((name) => ({ name, type: StringArg, role: 'keyword' as const, ignored: true })),
  ],
  mutates: true,
  summary: 'Colour map surfaces by the nearest atoms of a molecule.',
  async run(ctx, args, cc): Promise<CmdOutcome> {
    warnIgnored(cc, 'color zone', args, COLOR_ZONE_IGNORED)
    if (args.near === '') return { ok: false, error: 'Error: color zone: give near' }
    const near = targetsOf(ctx, cc.sceneId, args.near)
    if (!near.ok) return near
    if (near.targets.length !== 1) {
      return { ok: false, error: `Error: color zone: the atoms must be in one model (a map surface is coloured from one molecule; they are in ${near.targets.length})` }
    }
    const t = near.targets[0]
    const maps = mapObjectsOf(ctx, cc.sceneId, args.surfaces)
    if (maps.length === 0) {
      const mols = targetsOf(ctx, cc.sceneId, args.surfaces)
      if (mols.ok && mols.targets.length > 0) return unsupported('Error: color zone on molecular surfaces is not supported yet (maps only)')
      return { ok: false, error: 'Error: color zone: no surfaces specified' }
    }
    const surfaces = maps.flatMap((m) => mapSurfaceRenderers(ctx, cc.sceneId, m.uid))
    if (surfaces.length === 0) cc.warn('color zone: a map drawn as a mesh cannot be coloured by atoms; draw it as a surface (volume style surface)')
    let rows: PaintRow[] | null = null
    const owned = ownedOn(ctx, cc.sceneId, t.obj.uid)
    for (const name of [ATOM_STYLES.sphere.name, ATOM_STYLES.stick.name, ATOM_STYLES.ball.name]) {
      const id = owned.get(name)
      rows = id === undefined ? null : await readPaint(ctx, cc, id)
      if (rows) break
    }
    if (surfaces.length > 0 && !rows) cc.warn(`color zone: the atoms of #${t.obj.model} have no console colours to copy; the surface takes the default atom colours`)
    for (const id of surfaces) {
      if (rows) {
        // Switching to paint also puts the renderer in molecule colour mode.
        const painted = await replacePaint(ctx, cc, id, rows)
        if (!painted.ok) return painted
      }
      for (const [prop, value] of [['colormode', 'molecule'], ['target', t.obj.name], ['sel', t.sel]] as const) {
        const res = await runOp(ctx, cc, 'set_node_prop', { nodeType: 'renderer', nodeId: id, prop, value })
        if (!res.ok) return res
      }
    }
    if (surfaces.length > 0 && args.distance !== '') {
      cc.warn('color zone: distance is not supported yet (the whole map surface takes the colour of the nearest atom)')
    }
    return { ok: true }
  },
})

/** The adjusters `color modify` takes (ChimeraX `ADJUST_TYPES`). */
const ADJUSTERS = ['hue', 'saturation', 'lightness', 'whiteness', 'blackness', 'contrast', 'red', 'green', 'blue']

/**
 * `color modify [spec] <adjuster> [+|-|*] [number] [what] [target t]`
 * (`std_commands/color.py` `color_modify`): change the colours the atoms
 * named have, by HLS / HWB / RGB (`colorModify.ts`). ChimeraX changes each
 * atom's colour; here each paint entry of the renderers the target reaches
 * that the atoms take a colour from is copied with the colour changed,
 * limited to the atoms named, and put first in the table in the same order
 * (the first entry that matches an atom colours it), so the named atoms
 * show the changed colour of the entry they had. Renderers not coloured by
 * paint are left as they are, with a warning. `contrast` is not supported
 * yet.
 */
const colorModify: ChxCommand = chxCommand({
  words: ['color', 'modify'],
  args: [
    { name: 'objects', type: SpecArg, role: 'optional' },
    { name: 'adjuster', type: EnumOf(ADJUSTERS), role: 'optional' },
    { name: 'op', type: EnumOf(['+', '-', '*']), role: 'optional' },
    { name: 'number', type: FloatArg, role: 'optional' },
    { name: 'what', type: ListOf(EnumOf(Object.keys(WHAT_LETTERS))), role: 'optional' },
    { name: 'target', type: StringArg, role: 'keyword' },
  ],
  mutates: true,
  summary: 'Change the colours of atoms, cartoons and surfaces: hue, saturation, lightness, whiteness, blackness, red, green or blue.',
  async run(ctx, args, cc): Promise<CmdOutcome> {
    const adjuster = args.adjuster
    if (adjuster === '') return { ok: false, error: `Error: color modify: give one of ${ADJUSTERS.join(', ')}` }
    if (adjuster === 'contrast') return unsupported('Error: color modify: contrast is not supported yet')
    if (args.number === '') return { ok: false, error: 'Error: color modify: give a number' }
    if (adjuster === 'hue' && args.op === '*') return { ok: false, error: 'Error: color modify: unable to scale hue' }
    const n = Number(args.number)
    const amount = (adjuster === 'hue' ? n / 360 : n / 100) * (args.op === '-' ? -1 : 1)
    const op: ModifyOp = args.op === '' ? 'set' : args.op === '*' ? 'mul' : 'add'
    const letters = args.what === '' ? '' : args.what.split(',').map((w) => WHAT_LETTERS[w]).join('')
    const target = args.target !== '' ? args.target : letters !== '' ? letters : DEFAULT_TARGET
    const found = targetsOf(ctx, cc.sceneId, args.objects)
    if (!found.ok) return found
    let unpainted = 0
    for (const t of found.targets) {
      const owned = ownedOn(ctx, cc.sceneId, t.obj.uid)
      const r = atomRenderers(owned)
      const rends = [
        ...(/[ab]/.test(target) ? [r.stick, r.ball, r.sphere] : []),
        ...(/[cr]/.test(target) ? cartoonRenderers(owned).map((c) => c.id) : []),
        ...(/f/.test(target) ? [owned.get(NUCL_BASE.name) as number] : []),
        ...(/s/.test(target) ? surfacesOn(ctx, cc.sceneId, t.obj.uid).map((x) => x.id) : []),
      ].filter((id) => id !== undefined)
      for (const id of rends) {
        const rows = await readPaint(ctx, cc, id)
        if (!rows) {
          unpainted++
          continue
        }
        const changed: PaintRow[] = []
        for (const row of rows) {
          const sel = intersect(row.selStr, t.sel)
          const c = readColor(row.colorValue)
          if (sel === NONE || !c) continue
          changed.push({ selStr: sel, colorValue: modifyColor(c.hex, adjuster as Adjuster, op, amount) })
        }
        const res = await prependPaint(ctx, cc, id, changed)
        if (!res.ok) return res
      }
    }
    if (unpainted > 0) cc.warn('color modify: some renderers are not coloured by the console (no paint table) and are left as they are')
    return { ok: true }
  },
})

/**
 * `color list [all|custom|builtin]`: the colour names, in ChimeraX's form
 * (`colorname.py` `_list_colors`). The console keeps no custom colours.
 */
const colorList: ChxCommand = chxCommand({
  words: ['color', 'list'],
  args: [{ name: 'which', type: EnumOf(['all', 'custom', 'builtin']), role: 'optional', default: 'all' }],
  mutates: false,
  summary: 'List the colour names.',
  run(_ctx, args, cc) {
    if (args.which !== 'builtin') cc.print('No custom colors.')
    if (args.which !== 'custom') {
      const names = Object.keys(BUILTIN_COLORS)
      const listed = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names.join('')
      cc.print(`${names.length} builtin colors: ${listed}.`)
    }
    return { ok: true }
  },
})

/** `colour`: ChimeraX's British spelling of `color`. */
const colour: ChxCommand = chxCommand({ ...color, words: ['colour'] })

export const COLOR_COMMANDS: Record<string, ChxCommand> = {
  color,
  colorByattribute: colorByAttr(['color', 'byattribute'], null),
  colorBfactor: colorByAttr(['color', 'bfactor'], 'bfactor'),
  colorList,
  colorModify,
  colorZone,
  colour,
  rainbow,
}
