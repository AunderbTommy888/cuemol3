/**
 * @file plugins/chimerax-console/worker/commands/displayCommands.ts
 * @description `show`, `hide`, `cartoon`, `cartoon hide` and `style`.
 *
 * Each reads the selections of the molecule's `chx:` renderers, combines
 * the specification in (show adds, hide takes away, as PyMOL's flags and
 * ChimeraX's display flags do), and writes them back with
 * `set_renderer_selection` (`display.ts`).
 */

import type { WorkerContext } from '@renderer/worker/server/types/WorkerContext'
import type { CmdContext, CmdOutcome } from '@plugins/console/worker/dialect-api'
import { getGenericProps } from '@renderer/worker/server/services/props/read'
import { BoolArg, EnumOf, FloatArg, IntArg, ListOf, NoArg, SpecArg, StringArg } from '../cli/argTypes'
import { chxCommand } from '../cli/command'
import type { ChxCommand } from '../cli/command'
import {
  CARTOONS,
  atomRenderers,
  baseMode,
  cartoonRenderers,
  emitContext,
  ensureOwned,
  intersect,
  minus,
  NUCL_BASE,
  ownedOn,
  readSel,
  runOp,
  targetsOf,
  union,
  wholeMapsOf,
  writeSel,
} from '../display'
import type { AtomStyle, BaseMode, Target } from '../display'
import { numberedObjects } from '../models'
import type { NumberedObject } from '../models'
import { hideSurfaces, showSurfaces } from '../surface'
import { warnIgnored } from './warn'

/** What `show` / `hide` can act on (cli.py `WhatArg`). */
const WHAT = ['atoms', 'bonds', 'pseudobonds', 'pbonds', 'cartoons', 'ribbons', 'surfaces', 'models']

/** The parts a `target` string's letters name (`show.py` `TargetArg`). */
type Part = 'atoms' | 'cartoons' | 'models' | 'surfaces' | 'pseudobonds'

const LETTERS: Readonly<Record<string, Part>> = {
  a: 'atoms', b: 'atoms', c: 'cartoons', r: 'cartoons', m: 'models', s: 'surfaces', p: 'pseudobonds',
}

/**
 * The parts a `what` list or `target` letters name. When neither is given:
 * atoms if the specification reaches any, else models (`show.py`
 * `what_objects`), so `show #1` on a map shows the map.
 */
function partsOf(what: string, target: string, anyAtoms = true): { ok: true; parts: Set<Part> } | { ok: false; error: string } {
  const parts = new Set<Part>()
  for (const w of what === '' ? [] : what.split(',')) {
    if (w === 'atoms' || w === 'bonds') parts.add('atoms')
    else if (w === 'cartoons' || w === 'ribbons') parts.add('cartoons')
    else if (w === 'models') parts.add('models')
    else if (w === 'surfaces') parts.add('surfaces')
    else parts.add('pseudobonds')
  }
  for (const ch of target) {
    const p = LETTERS[ch]
    if (!p) return { ok: false, error: `Error: "${ch}" in target is not one of a b c m p r s` }
    parts.add(p)
  }
  if (parts.size === 0) parts.add(anyAtoms ? 'atoms' : 'models')
  return { ok: true, parts }
}

/**
 * Show or hide `parts` of each target.
 *
 * @param only - `show ... only` (show.py): in each molecule reached, what is
 *   not in the specification is hidden (of the same parts), and with
 *   `models` every object of the scene not reached is hidden
 * @param wholeScene - the specification was empty, so `models only` has no
 *   other object to hide
 * @param maps - the maps the specification names as models (`wholeMapsOf`),
 *   shown or hidden with `models`
 */
async function showHide(
  ctx: WorkerContext, cc: CmdContext, targets: readonly Target[], parts: Set<Part>, show: boolean,
  only = false, wholeScene = false, maps: readonly NumberedObject[] = [],
): Promise<CmdOutcome> {
  if (parts.has('pseudobonds')) cc.warn(`${show ? 'show' : 'hide'}: pseudobonds are not supported yet; ignored`)
  if (parts.has('models')) {
    for (const m of maps) {
      const res = await runOp(ctx, cc, 'set_visible', { nodeId: m.uid, nodeType: 'object', visible: show })
      if (!res.ok) return res
    }
  }
  for (const t of targets) {
    if (parts.has('models')) {
      const res = await runOp(ctx, cc, 'set_visible', { nodeId: t.obj.uid, nodeType: 'object', visible: show })
      if (!res.ok) return res
    }
    if (parts.has('surfaces')) {
      if (only && t.sel !== '*') {
        const res = await hideSurfaces(ctx, cc, { obj: t.obj, sel: `not (${t.sel})` })
        if (!res.ok) return res
      }
      // Show makes the surface of each chain reached; hide only edits the ones there are.
      const res = show ? await showSurfaces(ctx, cc, t) : await hideSurfaces(ctx, cc, t)
      if (!res.ok) return res
    }
    if (!parts.has('atoms') && !parts.has('cartoons')) continue
    const owned = await ensureOwned(ctx, cc, t.obj)
    if (!owned.ok) return owned
    if (parts.has('atoms')) {
      const r = atomRenderers(owned.ids)
      const sel = (id: number) => readSel(ctx, cc.sceneId, id)
      // With `only`, what each style shows outside the specification goes.
      const kept = (id: number) => (only ? intersect(sel(id), t.sel) : sel(id))
      const writes: [number, string][] = show
        // New atoms come in as sticks; atoms already shown keep their style.
        ? [
            [r.stick, union(kept(r.stick), minus(t.sel, union(sel(r.ball), sel(r.sphere))))],
            ...(only ? [r.ball, r.sphere].map((id): [number, string] => [id, kept(id)]) : []),
          ]
        : [r.stick, r.ball, r.sphere].map((id) => [id, minus(sel(id), t.sel)])
      for (const [id, next] of writes) {
        const w = await writeSel(ctx, cc, id, next)
        if (!w.ok) return w
      }
    }
    if (parts.has('cartoons')) {
      // The base slabs follow the nucleic cartoon (display.ts).
      const base = { id: owned.ids.get(NUCL_BASE.name) as number, scope: NUCL_BASE.scope as string }
      for (const c of [...cartoonRenderers(owned.ids), base]) {
        const cur = readSel(ctx, cc.sceneId, c.id)
        const next = show ? union(only ? intersect(cur, t.sel) : cur, intersect(t.sel, c.scope)) : minus(cur, t.sel)
        const w = await writeSel(ctx, cc, c.id, next)
        if (!w.ok) return w
      }
    }
  }
  if (only && parts.has('models') && !wholeScene) {
    // show_models(only=True): every model not specified is hidden.
    const reached = new Set([...targets.map((t) => t.obj.uid), ...maps.map((m) => m.uid)])
    for (const o of numberedObjects(ctx, cc.sceneId)) {
      if (reached.has(o.uid)) continue
      const res = await runOp(ctx, cc, 'set_visible', { nodeId: o.uid, nodeType: 'object', visible: false })
      if (!res.ok) return res
    }
  }
  return { ok: true }
}

/**
 * `show` / `hide`: [spec] [what], target, and for show `only`. `word` names
 * ChimeraX's other names of the same commands (`display`; `~show`,
 * `~display`; std_commands `__init__.py`).
 */
function showHideCommand(show: boolean, word = show ? 'show' : 'hide'): ChxCommand {
  return chxCommand({
    words: [word],
    args: [
      { name: 'objects', type: SpecArg, role: 'optional' },
      { name: 'what', type: ListOf(EnumOf(WHAT)), role: 'optional' },
      { name: 'target', type: StringArg, role: 'keyword' },
      ...(show ? [{ name: 'only', type: NoArg, role: 'keyword' as const }] : []),
    ],
    mutates: true,
    summary: show ? 'Show atoms, cartoons, surfaces or models.' : 'Hide atoms, cartoons, surfaces or models.',
    async run(ctx, args, cc) {
      const found = targetsOf(ctx, cc.sceneId, args.objects)
      if (!found.ok) return found
      const parts = partsOf(args.what, args.target, found.targets.length > 0)
      if (!parts.ok) return parts
      const maps = parts.parts.has('models') ? wholeMapsOf(ctx, cc.sceneId, args.objects) : []
      return showHide(ctx, cc, found.targets, parts.parts, show, args.only === 'true', args.objects.trim() === '', maps)
    },
  })
}

/** `cartoon` / `cartoon hide`: [spec]. */
function cartoonCommand(show: boolean): ChxCommand {
  return chxCommand({
    words: show ? ['cartoon'] : ['cartoon', 'hide'],
    args: [
      { name: 'atoms', type: SpecArg, role: 'optional' },
      ...(show
        ? [
            { name: 'smooth', type: StringArg, role: 'keyword' as const, ignored: true },
            { name: 'suppressBackboneDisplay', type: BoolArg, role: 'keyword' as const },
          ]
        : []),
    ],
    mutates: true,
    summary: show ? 'Show residues as cartoon.' : 'Hide the cartoon of residues.',
    async run(ctx, args, cc) {
      warnIgnored(cc, 'cartoon', args, ['smooth'])
      // The console never hides backbone atoms for the cartoon, which is what false asks for.
      if (args.suppressBackboneDisplay === 'true') cc.warn('cartoon: suppressBackboneDisplay true is not supported yet (backbone atoms stay shown); ignored')
      const found = targetsOf(ctx, cc.sceneId, args.atoms)
      if (!found.ok) return found
      return showHide(ctx, cc, found.targets, new Set(['cartoons']), show)
    },
  })
}

// --- cartoon style ---

/** A CueMol section shape: its `type`, and `sharp` where the shape takes one. */
interface SectionShape {
  type: string
  sharp?: number
}

/**
 * ChimeraX's piping (`ribbon.py` `_xsection_piping`): a flat band with a
 * round pipe along each edge, the pipes as thick as the section and the band
 * `ratio` (0.5) of that, joining the pipes at `asin(ratio)`. CueMol's
 * `fancy1` (`TubeSection::setupMolScrSection`) is built the same way, its
 * band joining at `180 sharp` degrees: `sharp = asin(0.5) / 180 deg = 1/6`.
 */
const PIPING: SectionShape = { type: 'fancy1', sharp: 1 / 6 }

/** ChimeraX's cross sections (`cartoon.py` `_XSectionMap`) as CueMol section shapes. */
const XSECTIONS: Readonly<Record<string, SectionShape>> = {
  rectangle: { type: 'rectangle' }, square: { type: 'rectangle' },
  oval: { type: 'elliptical' }, round: { type: 'elliptical' },
  barbell: PIPING, piping: PIPING,
}

/** A CueMol section `type` by ChimeraX's name for it, for the report (CueMol's own name otherwise). */
const XSECTION_NAMES: Readonly<Record<string, string>> = { rectangle: 'rectangle', elliptical: 'oval', fancy1: 'piping' }

/** The `cartoon style` options the console does not do yet (accepted, warned). */
const CARTOON_STYLE_IGNORED = [
  'barScale', 'barSides', 'worm',
]

/**
 * One cross section `cartoon style` sets: a renderer's TubeSection
 * property, and which residues make it apply (ChimeraX sets the style of
 * each secondary structure type the residues given include).
 */
interface SectionKind {
  label: 'helix' | 'strand' | 'coil' | 'nucleic'
  renderer: 'chx:cartoon' | 'chx:nucl'
  prop: 'helix' | 'sheet' | 'coil' | 'section'
  residues: string
}

const SECTION_KINDS: readonly SectionKind[] = [
  { label: 'helix', renderer: 'chx:cartoon', prop: 'helix', residues: '(protein) and (helix)' },
  { label: 'strand', renderer: 'chx:cartoon', prop: 'sheet', residues: '(protein) and (sheet)' },
  { label: 'coil', renderer: 'chx:cartoon', prop: 'coil', residues: '(protein) and not (helix or sheet)' },
  { label: 'nucleic', renderer: 'chx:nucl', prop: 'section', residues: 'nucleic' },
]

/** A number as a property value, without float noise. */
const num = (x: number): string => String(Number(x.toPrecision(6)))

/**
 * The full width and thickness (Angstrom) a CueMol section draws, as
 * ChimeraX names them. A section is `2 width` across its first axis and
 * `2 width tuber` across its second. ChimeraX's width is the second in both
 * renderers: the protein ribbon's wide side (DefaultRibbon: width 0.2,
 * tuber 6), and in `nucl` the side towards the bases, where ChimeraX turns
 * its nucleic section a quarter turn from the protein one (`cartoon.py`:
 * "Invert width and thickness"; `ribbon.py` `scale_nucleic = (0.2, 1.0)`).
 */
function sectionSize(lw: number, tuber: number): { width: number; thickness: number } {
  return { width: 2 * lw * tuber, thickness: 2 * lw }
}

/** The CueMol `width` / `tuber` that draw a section of full `width` x `thickness`. */
function sectionProps(width: number, thickness: number): { width: number; tuber: number } {
  return { width: thickness / 2, tuber: width / thickness }
}

/**
 * `cartoon style modeHelix tube|default|wrap [radius r]`: helices as
 * cylinders, or as ribbons again. The ribbon is a `ribbon` renderer, which
 * has no cylinders; the `cartoon` renderer (Ribbon2Renderer) draws a helix
 * as a cylinder (`helix_ribbon` false), so `chx:cartoon` is redrawn as that
 * type (`set_renderer_type`, which keeps its selection and colours) and back.
 * One mode per renderer, so it is set for a model's whole protein: part of
 * it is skipped with a warning.
 */
async function setHelixMode(ctx: WorkerContext, cc: CmdContext, t: Target, mode: string, radius: string): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  const name = CARTOONS[0].name
  const id = ownedOn(ctx, cc.sceneId, t.obj.uid).get(name) as number
  if (t.sel !== '*' && emitContext(ctx, cc.sceneId).anyHit(t.obj.model, minus('protein', t.sel))) {
    cc.warn(`cartoon style: modeHelix for part of the protein of #${t.obj.model} is not supported yet (one helix mode per model); ignored`)
    return { ok: true, id }
  }
  const props = getGenericProps(ctx, { sceneId: cc.sceneId, nodeId: id, nodeType: 'renderer' })
  const type = props.ok ? String(props.entries.find((e) => e.key === 'type_name')?.value ?? '') : ''
  const want = mode === 'tube' ? 'cartoon' : 'ribbon'
  let rendId = id
  if (type !== want) {
    const res = await runOp(ctx, cc, 'set_renderer_type', { rendId: id, rendererType: want })
    if (!res.ok) return res
    rendId = (res.data as { rendererId: number }).rendererId
  }
  if (mode === 'wrap') cc.warn('cartoon style: modeHelix wrap is drawn as default (CueMol does not wrap the helix around a tube)')
  if (want === 'cartoon') {
    // A round cylinder: its size is helix_width (the ribbon's flat helix section came along with the type change).
    const writes: [string, string][] = [
      ['helix_ribbon', 'false'], ['helix.type', 'elliptical'], ['helix.tuber', '1'],
      ...(radius !== '' ? [['helix_width_mode', 'const'], ['helix_width', radius]] as [string, string][] : []),
    ]
    for (const [prop, value] of writes) {
      const res = await runOp(ctx, cc, 'set_node_prop', { nodeType: 'renderer', nodeId: rendId, prop, value })
      if (!res.ok) return res
    }
  } else {
    if (radius !== '') cc.warn('cartoon style: radius is for modeHelix tube; ignored')
    if (type !== want) {
      // Back to the ribbon's own helix section (its style's), not the cylinder's.
      for (const prop of ['helix.type', 'helix.tuber', 'helix.width']) {
        const res = await runOp(ctx, cc, 'reset_prop', { path: `#${rendId}.${prop}` })
        if (!res.ok) return res
      }
    }
  }
  return { ok: true, id: rendId }
}

const cartoonStyle = chxCommand({
  words: ['cartoon', 'style'],
  args: [
    { name: 'atoms', type: SpecArg, role: 'optional' },
    { name: 'width', type: FloatArg, role: 'keyword' },
    { name: 'thickness', type: FloatArg, role: 'keyword' },
    { name: 'xsection', type: EnumOf(Object.keys(XSECTIONS)), role: 'keyword' },
    { name: 'modeHelix', type: EnumOf(['default', 'tube', 'wrap']), role: 'keyword' },
    { name: 'radius', type: FloatArg, role: 'keyword' },
    { name: 'arrows', type: BoolArg, role: 'keyword' },
    { name: 'arrowsHelix', type: BoolArg, role: 'keyword' },
    { name: 'arrowScale', type: FloatArg, role: 'keyword' },
    { name: 'sides', type: IntArg, role: 'keyword' },
    { name: 'divisions', type: IntArg, role: 'keyword' },
    ...CARTOON_STYLE_IGNORED.map((name) => ({ name, type: StringArg, role: 'keyword' as const, ignored: true })),
  ],
  mutates: true,
  summary: 'Set the cartoon cross section (width, thickness, xsection) of the secondary structure types named; report it with no option.',
  async run(ctx, args, cc) {
    warnIgnored(cc, 'cartoon style', args, CARTOON_STYLE_IGNORED)
    const width = args.width === '' ? null : Number(args.width)
    const thickness = args.thickness === '' ? null : Number(args.thickness)
    if ((width !== null && !(width > 0)) || (thickness !== null && !(thickness > 0))) {
      return { ok: false, error: 'Error: cartoon style: width and thickness must be positive' }
    }
    const shape = args.xsection === '' ? undefined : XSECTIONS[args.xsection]
    const details = ['arrows', 'arrowsHelix', 'arrowScale', 'sides', 'divisions'].some((k) => args[k] !== '')
    const report = width === null && thickness === null && shape === undefined && args.modeHelix === '' && !details
    const found = targetsOf(ctx, cc.sceneId, args.atoms)
    if (!found.ok) return found
    const ec = emitContext(ctx, cc.sceneId)
    for (const t of found.targets) {
      const owned = await ensureOwned(ctx, cc, t.obj)
      if (!owned.ok) return owned
      if (args.modeHelix !== '' && ec.anyHit(t.obj.model, intersect(t.sel, 'protein'))) {
        const helix = await setHelixMode(ctx, cc, t, args.modeHelix, args.radius)
        if (!helix.ok) return helix
        owned.ids.set(CARTOONS[0].name, helix.id)
      }
      for (const kind of SECTION_KINDS) {
        if (!ec.anyHit(t.obj.model, intersect(t.sel, kind.residues))) continue
        const rendId = owned.ids.get(kind.renderer) as number
        const props = getGenericProps(ctx, { sceneId: cc.sceneId, nodeId: rendId, nodeType: 'renderer' })
        // Cylinder helices take their size from radius, not width / thickness (ChimeraX too).
        if (kind.label === 'helix' && props.ok && props.entries.find((e) => e.key === 'helix_ribbon')?.value === false) continue
        const read = (k: string) => (props.ok ? props.entries.find((e) => e.key === `${kind.prop}.${k}`)?.value : undefined)
        const size = sectionSize(Number(read('width')), Number(read('tuber')))
        if (report) {
          cc.print(`#${t.obj.model} ${kind.label} xsection ${XSECTION_NAMES[String(read('type'))] ?? String(read('type'))} width ${num(size.width)} thickness ${num(size.thickness)}`)
          continue
        }
        const writes: [string, string][] = []
        if (kind.label === 'coil') {
          // A coil is round, its diameter the thickness (`set_coil_scale(t, t)`).
          if (thickness !== null) writes.push(['width', num(thickness / 2)], ['tuber', '1'])
        } else if (width !== null || thickness !== null) {
          const p = sectionProps(width ?? size.width, thickness ?? size.thickness)
          writes.push(['width', num(p.width)], ['tuber', num(p.tuber)])
        }
        // ChimeraX leaves the coil as it is for piping (`cartoon.py`: `!= STYLE_PIPING`).
        if (shape !== undefined && !(kind.label === 'coil' && shape === PIPING)) {
          writes.push(['type', shape.type])
          if (shape.sharp !== undefined) writes.push(['sharp', num(shape.sharp)])
        }
        for (const [k, value] of writes) {
          const res = await runOp(ctx, cc, 'set_node_prop', { nodeType: 'renderer', nodeId: rendId, prop: `${kind.prop}.${k}`, value })
          if (!res.ok) return res
        }
      }
      if (details) {
        const res = await writeCartoonDetails(ctx, cc, owned.ids, args, ec.anyHit(t.obj.model, intersect(t.sel, 'protein')), ec.anyHit(t.obj.model, intersect(t.sel, 'nucleic')))
        if (!res.ok) return res
      }
    }
    return { ok: true }
  },
})

/**
 * `cartoon style` `arrows` / `arrowsHelix` / `arrowScale` / `sides` /
 * `divisions` as renderer properties (one value per renderer, as ChimeraX's
 * are per secondary structure type): the strand head (`sheethead.type`,
 * `sheethead.arrow`, the arrow's width over the strand's as ChimeraX's
 * `arrowScale`), the helix head (`helixhead` on the ribbon, `ribhelix_head`
 * on the cartoon renderer), the sections' points around (`detail`) and the
 * points per residue along the chain (`axialdetail`).
 */
async function writeCartoonDetails(
  ctx: WorkerContext, cc: CmdContext, ids: Map<string, number>, args: Record<string, string>, protein: boolean, nucleic: boolean,
): Promise<CmdOutcome> {
  const writes: [number, string, string][] = []
  const prot = ids.get(CARTOONS[0].name) as number
  const nucl = ids.get(CARTOONS[1].name) as number
  if (protein) {
    const props = getGenericProps(ctx, { sceneId: cc.sceneId, nodeId: prot, nodeType: 'renderer' })
    const type = props.ok ? String(props.entries.find((e) => e.key === 'type_name')?.value ?? '') : ''
    const head = (on: string) => (on === 'true' ? 'arrow' : 'smooth')
    if (args.arrows !== '') writes.push([prot, 'sheethead.type', head(args.arrows)])
    if (args.arrowScale !== '') writes.push([prot, 'sheethead.arrow', args.arrowScale])
    if (args.arrowsHelix !== '') writes.push([prot, type === 'cartoon' ? 'ribhelix_head.type' : 'helixhead.type', head(args.arrowsHelix)])
    if (args.sides !== '') for (const sec of ['helix', 'sheet', 'coil']) writes.push([prot, `${sec}.detail`, args.sides])
    if (args.divisions !== '') writes.push([prot, 'axialdetail', args.divisions])
  }
  if (nucleic) {
    if (args.sides !== '') writes.push([nucl, 'section.detail', args.sides])
    if (args.divisions !== '') writes.push([nucl, 'axialdetail', args.divisions])
  }
  for (const [nodeId, prop, value] of writes) {
    const res = await runOp(ctx, cc, 'set_node_prop', { nodeType: 'renderer', nodeId, prop, value })
    if (!res.ok) return res
  }
  return { ok: true }
}

const STYLES: readonly AtomStyle[] = ['stick', 'ball', 'sphere']

/** The ring plate thickness of `ringFill thin` (Angstrom); `thick` takes the stick's radius. */
const THIN_RING = 0.05

/**
 * `ringFill on|off|thin|thick`: the ball-and-stick renderers' ring plates
 * (`ring`, `thickness`), coloured as the atoms (`ringcolor` $molcol).
 * ChimeraX's `thick` follows the stick width, so it takes the renderer's
 * bond radius. A ring setting is one per renderer, so it is set for whole
 * models only (thickness 0 would stop drawing the rings, so it is not used
 * for thin).
 */
async function setRingFill(ctx: WorkerContext, cc: CmdContext, t: Target, fill: string): Promise<CmdOutcome> {
  if (t.sel !== '*') {
    cc.warn(`style: ringFill for part of a model is not supported yet (one ring setting per renderer); #${t.obj.model} is left as it is`)
    return { ok: true }
  }
  const owned = await ensureOwned(ctx, cc, t.obj)
  if (!owned.ok) return owned
  const r = atomRenderers(owned.ids)
  for (const id of [r.stick, r.ball]) {
    const props = getGenericProps(ctx, { sceneId: cc.sceneId, nodeId: id, nodeType: 'renderer' })
    const bondw = Number(props.ok ? props.entries.find((e) => e.key === 'bondw')?.value : NaN)
    const writes: [string, string][] = fill === 'off'
      ? [['ring', 'false']]
      : [
          ['ring', 'true'],
          ['ringcolor', '$molcol'],
          ...(fill === 'thin' ? [['thickness', String(THIN_RING)] as [string, string]] : []),
          ...(fill === 'thick' && Number.isFinite(bondw) && bondw > 0 ? [['thickness', String(bondw)] as [string, string]] : []),
        ]
    for (const [prop, value] of writes) {
      const res = await runOp(ctx, cc, 'set_node_prop', { nodeType: 'renderer', nodeId: id, prop, value })
      if (!res.ok) return res
    }
  }
  return { ok: true }
}

const style = chxCommand({
  words: ['style'],
  args: [
    { name: 'objects', type: SpecArg, role: 'optional' },
    { name: 'atomStyle', type: EnumOf(STYLES), role: 'optional' },
    { name: 'dashes', type: StringArg, role: 'keyword', ignored: true },
    { name: 'ringFill', type: EnumOf(['on', 'off', 'thick', 'thin']), role: 'keyword' },
  ],
  mutates: true,
  summary: 'Draw atoms as stick, ball or sphere; ringFill fills rings with plates.',
  async run(ctx, args, cc) {
    warnIgnored(cc, 'style', args, ['dashes'])
    const to = args.atomStyle as AtomStyle | ''
    if (to === '' && args.ringFill === '') return { ok: false, error: 'Error: style: give stick, ball or sphere' }
    const found = targetsOf(ctx, cc.sceneId, args.objects)
    if (!found.ok) return found
    for (const t of found.targets) {
      if (args.ringFill !== '') {
        const ring = await setRingFill(ctx, cc, t, args.ringFill)
        if (!ring.ok) return ring
      }
      if (to === '') continue
      const owned = await ensureOwned(ctx, cc, t.obj)
      if (!owned.ok) return owned
      const r = atomRenderers(owned.ids)
      const others = STYLES.filter((s) => s !== to)
      const sel = (s: AtomStyle) => readSel(ctx, cc.sceneId, r[s])
      // Only atoms shown move: a hidden atom has no style to keep (display.ts).
      const moved = intersect(t.sel, union(sel(others[0]), sel(others[1])))
      const writes: [number, string][] = [
        [r[to], union(sel(to), moved)],
        ...others.map((s): [number, string] => [r[s], minus(sel(s), t.sel)]),
      ]
      for (const [id, next] of writes) {
        const w = await writeSel(ctx, cc, id, next)
        if (!w.ok) return w
      }
    }
    return { ok: true }
  },
})

// --- nucleotides ---

/** ChimeraX's nucleotide representations, and how the console draws each. */
const BASE_REPRESENTATIONS: Readonly<Record<string, BaseMode>> = {
  atoms: 'atoms', fill: 'slab', slab: 'slab', 'tube/slab': 'slab', ladder: 'ladder', stubs: 'ladder',
}

/** The `nucleotides` keywords that shape ChimeraX's slabs and rungs, which `nucl` does not take. */
const NUCLEOTIDES_IGNORED = ['showOrientation', 'shape', 'dimensions', 'thickness', 'hideAtoms', 'glycosidic', 'baseOnly', 'showStubs', 'radius']

/**
 * Draw a molecule's bases as slabs or a ladder (`chx:nuclbase` shown, its
 * `base_type`), or as nothing but their atoms (`chx:nuclbase` hidden) --
 * ChimeraX `nucleotides`. Which residues have slabs is the cartoon's
 * business (`chx:nuclbase` follows it); atoms are not touched.
 */
export async function setBaseMode(ctx: WorkerContext, cc: CmdContext, ids: Map<string, number>, mode: BaseMode): Promise<CmdOutcome> {
  const base = ids.get(NUCL_BASE.name) as number
  const from = baseMode(ctx, cc.sceneId, ids)
  if (mode !== 'atoms') {
    const type = await runOp(ctx, cc, 'set_node_prop', { nodeType: 'renderer', nodeId: base, prop: 'base_type', value: mode === 'ladder' ? 'basepair' : 'detail1' })
    if (!type.ok) return type
  }
  if ((mode === 'atoms') !== (from === 'atoms')) {
    const vis = await runOp(ctx, cc, 'set_visible', { nodeId: base, nodeType: 'renderer', visible: mode !== 'atoms' })
    if (!vis.ok) return vis
  }
  return { ok: true }
}

/**
 * `nucleotides [spec] atoms|fill|slab|tube/slab|ladder|stubs`. The slabs are
 * `nucl`'s filled base rings (`base_type` detail1: fill, slab and tube/slab
 * alike), the ladder its base-pair rungs (basepair: ladder and stubs);
 * `atoms` hides them (the atoms are shown with `show`, as in ChimeraX). The
 * representation is one per renderer, so it is set for all the nucleic
 * acids of a model at once: a specification reaching only some of them is
 * skipped with a warning.
 */
const nucleotides = chxCommand({
  words: ['nucleotides'],
  args: [
    { name: 'objects', type: SpecArg, role: 'optional' },
    { name: 'representation', type: EnumOf(Object.keys(BASE_REPRESENTATIONS)), role: 'optional' },
    ...NUCLEOTIDES_IGNORED.map((name) => ({ name, type: StringArg, role: 'keyword' as const, ignored: true })),
  ],
  mutates: true,
  summary: 'Draw nucleic acid bases as atoms, slabs (fill, slab, tube/slab) or a ladder (ladder, stubs).',
  async run(ctx, args, cc) {
    warnIgnored(cc, 'nucleotides', args, NUCLEOTIDES_IGNORED)
    if (args.representation === '') return { ok: false, error: 'Error: nucleotides: give atoms, fill, slab, tube/slab, ladder or stubs' }
    const mode = BASE_REPRESENTATIONS[args.representation]
    const found = targetsOf(ctx, cc.sceneId, args.objects)
    if (!found.ok) return found
    const ec = emitContext(ctx, cc.sceneId)
    // No nucleotide reached is no error, as in ChimeraX (a preset runs it on any structure).
    for (const t of found.targets) {
      if (!ec.anyHit(t.obj.model, intersect(t.sel, 'nucleic'))) continue
      if (t.sel !== '*' && ec.anyHit(t.obj.model, minus('nucleic', t.sel))) {
        cc.warn(`nucleotides: part of the nucleic acids of #${t.obj.model} is not supported yet (one representation per model); #${t.obj.model} is left as it is`)
        continue
      }
      const owned = await ensureOwned(ctx, cc, t.obj)
      if (!owned.ok) return owned
      const res = await setBaseMode(ctx, cc, owned.ids, mode)
      if (!res.ok) return res
    }
    return { ok: true }
  },
})

export const DISPLAY_COMMANDS: Record<string, ChxCommand> = {
  nucleotides,
  show: showHideCommand(true),
  hide: showHideCommand(false),
  display: showHideCommand(true, 'display'),
  unshow: showHideCommand(false, '~show'),
  undisplay: showHideCommand(false, '~display'),
  cartoon: cartoonCommand(true),
  cartoonHide: cartoonCommand(false),
  cartoonStyle,
  style,
}
