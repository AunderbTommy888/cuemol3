/**
 * @file plugins/chimerax-console/worker/display.ts
 * @description What ChimeraX shows, as the console's own renderers.
 *
 * ChimeraX keeps a display flag and a style per atom and a ribbon flag per
 * residue. CueMol draws what a renderer's selection holds, so the ChX
 * console keeps one renderer per atom style and one for the ribbon on each
 * molecule, named `chx:...`, and those renderers' selections ARE the
 * display state: nothing about it is kept anywhere else. Each command reads
 * them, works out the new selections, and writes them back through ops, in
 * the submission's undo transaction -- so undo (from the console or the GUI)
 * puts back the state the next command reads, and an edit made in the GUI
 * is where the next command starts from. Renderers not named `chx:` are
 * never touched.
 *
 * All four are made together the first time the console touches a
 * molecule, so a colour given to "atoms" is in every atom renderer and stays
 * when an atom moves from one style to another.
 *
 * Hidden atoms: CueMol has no per-atom display flag, so the style of an
 * atom ChimeraX keeps while it is hidden is kept by a second, never drawn
 * renderer per style (`chx:stick:hidden` ...; `HIDDEN_STYLES`): `hide` moves
 * atoms there, `show` moves them back, and `style` on a hidden atom moves it
 * from one to another. An atom in none of the six ("unassigned") has the
 * style the automatic styling gives it (`autoStyle.ts` `initialStylesOf`),
 * so only an atom whose style differs from that is kept. Each atom is in at
 * most one of the six. A hidden renderer is made the first time an atom
 * goes in, and is kept (emptied, never deleted) after: deleting and making
 * it again would pile renderers up in the undo history.
 *
 * Nucleic acids: the backbone is drawn by `chx:nucl` (a tube through the
 * phosphates) and the bases by `chx:nuclbase` (a `nucl` renderer drawing no
 * tube), both following the cartoon (`show` / `hide` cartoons). The bases
 * are slabs or a ladder while `chx:nuclbase` is shown (`nucleotides`), and
 * drawn by nothing (atoms) while it is hidden. ChimeraX ties the slabs to
 * the base atoms' display instead: here hiding the cartoon hides the slabs
 * too, and hiding the atoms leaves them.
 */

import type { WorkerContext } from '@renderer/worker/server/types/WorkerContext'
import { objectNodes, rendererNodesOf } from '@renderer/worker/server/catalog/refs'
// Read-only helpers (op-catalog.md 3.1: reading a property or a paint state
// is not an operation of its own).
import { getGenericProps } from '@renderer/worker/server/services/props/read'
import { getColoringClassName } from '@renderer/worker/server/services/coloring/colorTargets'
import { simplifySel } from '@renderer/worker/server/services/helpers/simplifySel'
import { makeSel } from '@renderer/worker/server/services/helpers/makeSel'
import { getSceneOrNull } from '@renderer/worker/server/services/helpers/sceneResolver'
import type { CmdContext, OpRun } from '@plugins/console/worker/dialect-api'
import { runOp as runConsoleOp } from '@plugins/console/worker/dialect-api'
import { ALL, emitFor, NONE } from './spec/emit'
import type { EmitContext } from './spec/emit'
import type { SpecNode } from './spec/parse'
import { parseSpec, SpecError } from './spec/parse'
import { isSelector, withSceneSelectors } from './spec/selectors'
import { selectionNames } from './names'
import { chxNames } from './chxNames'
import { isMolecule, numberedObjects } from './models'
import type { NumberedObject } from './models'

/** The prefix of the console's own renderers. */
export const OWNED = 'chx:'

/** A renderer the console keeps on each molecule. */
interface OwnedKind {
  name: string
  type: string
  styles: string
  /** What it is limited to (the ribbon draws proteins, `nucl` nucleic acids). */
  scope?: string
  /** Properties set after the styles, which the styles do not give. */
  props?: readonly [string, string][]
  /** Made hidden (`chx:nuclbase` is shown only while bases are slabs or a ladder). */
  hidden?: boolean
}

/** The atom renderers, one per ChimeraX atom style. */
export const ATOM_STYLES = {
  stick: { name: 'chx:stick', type: 'ballstick', styles: 'StickBallStick,DefaultCPKColoring' },
  ball: { name: 'chx:ball', type: 'ballstick', styles: 'DefaultBallStick,DefaultCPKColoring' },
  sphere: { name: 'chx:sphere', type: 'cpk', styles: 'DefaultCPK,DefaultCPKColoring' },
} as const satisfies Record<string, OwnedKind>

export type AtomStyle = keyof typeof ATOM_STYLES

/** The ribbon renderers: the protein cartoon and its nucleic acid companion. */
export const CARTOONS: readonly OwnedKind[] = [
  { name: 'chx:cartoon', type: 'ribbon', styles: 'DefaultRibbon,DefaultHSCPaint', scope: 'protein' },
  // A tube along the phosphates, drawn as `nucl`'s tube was (DefaultNucl: pivot P, a round
  // square section); a `tube` cannot take DefaultNucl itself. The bases are chx:nuclbase's.
  {
    name: 'chx:nucl', type: 'tube', styles: 'DefaultHSCPaint', scope: 'nucleic',
    props: [['pivotatom', 'P'], ['axialdetail', '8'], ['section.type', 'roundsquare'], ['section.width', '0.4'], ['section.tuber', '2.5']],
  },
]

/** The renderer drawing nucleic acid bases as slabs (`base_type` detail1) or a ladder (basepair). */
export const NUCL_BASE: OwnedKind = {
  name: 'chx:nuclbase',
  type: 'nucl',
  styles: 'DefaultNucl',
  scope: 'nucleic',
  props: [['show_tube', 'false'], ['base_type', 'detail1']],
  hidden: true,
}

const ALL_KINDS: readonly OwnedKind[] = [...Object.values(ATOM_STYLES), ...CARTOONS, NUCL_BASE]

/** The atom styles, in a fixed order. */
export const STYLE_KEYS: readonly AtomStyle[] = ['stick', 'ball', 'sphere']

const HIDDEN_SUFFIX = ':hidden'

/** The renderers keeping the style of hidden atoms, one per style; never drawn, made when first needed. */
export const HIDDEN_STYLES: Readonly<Record<AtomStyle, OwnedKind>> = {
  stick: { ...ATOM_STYLES.stick, name: `${ATOM_STYLES.stick.name}${HIDDEN_SUFFIX}`, hidden: true },
  ball: { ...ATOM_STYLES.ball, name: `${ATOM_STYLES.ball.name}${HIDDEN_SUFFIX}`, hidden: true },
  sphere: { ...ATOM_STYLES.sphere, name: `${ATOM_STYLES.sphere.name}${HIDDEN_SUFFIX}`, hidden: true },
}

/** Whether a renderer name is one of the hidden-style renderers. */
export function isHiddenStyleName(name: string): boolean {
  return name.startsWith(OWNED) && name.endsWith(HIDDEN_SUFFIX)
}

/** Run a catalog op as part of this command (the console's `runOp`, tagged `chx`). */
export function runOp(ctx: WorkerContext, cc: CmdContext, name: string, args: Record<string, unknown>): Promise<OpRun> {
  return runConsoleOp(ctx, cc, 'chx', name, args)
}

/** One molecule and the CueMol expression a specification means in it. */
export interface Target {
  obj: NumberedObject
  sel: string
}

/** A failure to read a specification, with a caret under where. */
function specError(text: string, e: SpecError): string {
  return `${text}\n${' '.repeat(e.pos)}^ ${e.message}`
}

/** One atom, as `MolAtom` exposes it (read only). */
export interface AtomView {
  /** CueMol's atom id (`aid`). */
  id: number
  name: string
  element: string
  bfac: number
  occ: number
  chainName: string
  /** The residue number with its insertion code (`10`, `10A`). */
  residIndex: string
  residName: string
  pos: { x: number; y: number; z: number }
}

/** An atom iterator, as `AtomIterator` exposes it. */
interface AtomIter {
  target: unknown
  sel: unknown
  first(): void
  next(): void
  hasMore(): boolean
  get(): AtomView
}

/**
 * Visit the atoms `expr` matches in object `objUid`, in order; stop when
 * `visit` returns false. Read only (compiling a selection and walking its
 * atoms is no operation of its own).
 */
export function forEachAtom(ctx: WorkerContext, sceneId: number, objUid: number, expr: string, visit: (a: AtomView) => boolean | void): void {
  const mol = getSceneOrNull(ctx, sceneId)?.getObject(objUid)
  const sel = makeSel(ctx, expr, sceneId)
  const iter = ctx.svc.createObj('AtomIterator') as unknown as AtomIter | null
  if (!mol || !sel || !iter) return
  iter.target = mol
  iter.sel = sel
  for (iter.first(); iter.hasMore(); iter.next()) if (visit(iter.get()) === false) return
}

/**
 * The scene as the specification emitter sees it: the molecules (for a zone,
 * which reaches across models) and a way to read which atoms an expression
 * matches (for zones to whole chains or models). Reads only.
 */
export function emitContext(ctx: WorkerContext, sceneId: number): EmitContext {
  const mols = numberedObjects(ctx, sceneId).filter(isMolecule)
  /** Visit the atoms `expr` matches in model `model`; stop when `visit` says so. */
  const eachAtom = (model: number, expr: string, visit: (chain: string) => boolean): void => {
    const obj = mols.find((m) => m.model === model)
    if (obj) forEachAtom(ctx, sceneId, obj.uid, expr, (a) => visit(a.chainName))
  }
  const own = chxNames(ctx, sceneId)
  const names = selectionNames(ctx, sceneId)
  return {
    models: mols.map((m) => ({ model: m.model, name: m.name })),
    namedSelections: names,
    currentSelection(model) {
      const obj = mols.find((m) => m.model === model)
      if (!obj) return NONE
      const props = getGenericProps(ctx, { sceneId, nodeId: obj.uid, nodeType: 'object' })
      const sel = props.ok ? props.entries.find((e) => e.key === 'sel')?.value : undefined
      const text = sel === null || sel === undefined ? '' : String(sel).trim()
      return text === '' ? NONE : text
    },
    chainsHit(model, expr) {
      const chains = new Set<string>()
      eachAtom(model, expr, (c) => { chains.add(c); return true })
      return [...chains].sort()
    },
    anyHit(model, expr) {
      let hit = false
      eachAtom(model, expr, () => { hit = true; return false })
      return hit
    },
    displayedAtoms(model) {
      const obj = mols.find((m) => m.model === model)
      return obj ? displayedAtoms(ctx, sceneId, obj.uid) : NONE
    },
    expandName(name) {
      const spec = own.get(name)
      if (spec === undefined) return undefined
      const read = withSceneSelectors(names, () => parseSpec(spec, isSelector))
      return read?.node
    },
  }
}

/** A specification read into its tree, with the scene's named selections as selectors. */
export function readSpec(ctx: WorkerContext, sceneId: number, spec: string): { ok: true; node: SpecNode; consumed: number } | { ok: false; error: string; unsupported?: true } {
  try {
    const names = selectionNames(ctx, sceneId)
    const read = withSceneSelectors(names, () => parseSpec(spec, isSelector))
    if (!read) return { ok: false, error: `Error: "${spec}" is not an atom specification` }
    return { ok: true, node: read.node, consumed: read.consumed }
  } catch (e) {
    if (e instanceof SpecError) return { ok: false, error: specError(spec, e), ...(e.unsupported ? { unsupported: true as const } : {}) }
    throw e
  }
}

/**
 * The molecules a specification tree reaches, each with what it means there.
 *
 * @param text - the specification's text, for the caret of an error
 */
export function targetsOfNode(ctx: WorkerContext, sceneId: number, node: SpecNode, text: string): { ok: true; targets: Target[] } | { ok: false; error: string; unsupported?: true } {
  const mols = numberedObjects(ctx, sceneId).filter(isMolecule)
  try {
    const ec = emitContext(ctx, sceneId)
    const targets: Target[] = []
    for (const obj of mols) {
      const sel = emitFor(node, obj.model, ec)
      if (sel !== NONE) targets.push({ obj, sel })
    }
    return { ok: true, targets }
  } catch (e) {
    if (e instanceof SpecError) return { ok: false, error: specError(text, e), ...(e.unsupported ? { unsupported: true as const } : {}) }
    throw e
  }
}

/**
 * The molecules a specification reaches, each with what it means there.
 * An empty specification is every molecule, whole.
 */
export function targetsOf(ctx: WorkerContext, sceneId: number, spec: string): { ok: true; targets: Target[] } | { ok: false; error: string; unsupported?: true } {
  if (spec.trim() === '') {
    return { ok: true, targets: numberedObjects(ctx, sceneId).filter(isMolecule).map((obj) => ({ obj, sel: '*' })) }
  }
  const read = readSpec(ctx, sceneId, spec)
  return read.ok ? targetsOfNode(ctx, sceneId, read.node, spec) : read
}

/** The console's renderers on a molecule, by name, with their uids. */
export function ownedOn(ctx: WorkerContext, sceneId: number, objId: number): Map<string, number> {
  const obj = objectNodes(ctx, sceneId).find((o) => o.id === objId)
  const out = new Map<string, number>()
  if (!obj) return out
  for (const n of rendererNodesOf(obj)) if (n.type === 'renderer' && n.name.startsWith(OWNED)) out.set(n.name, n.id)
  return out
}

/** A renderer's selection expression; '*' for one never set. */
export function readSel(ctx: WorkerContext, sceneId: number, rendId: number): string {
  const props = getGenericProps(ctx, { sceneId, nodeId: rendId, nodeType: 'renderer' })
  if (!props.ok) return NONE
  const v = props.entries.find((e) => e.key === 'sel')?.value
  const s = v === null || v === undefined ? '' : String(v).trim()
  return s === '' ? '*' : s
}

/**
 * The console's renderers on `obj`, made now if missing (drawing nothing),
 * with the styles of their kind.
 */
export async function ensureOwned(ctx: WorkerContext, cc: CmdContext, obj: NumberedObject): Promise<{ ok: true; ids: Map<string, number> } | { ok: false; error: string; unsupported?: true }> {
  const ids = ownedOn(ctx, cc.sceneId, obj.uid)
  for (const kind of ALL_KINDS) {
    if (ids.has(kind.name)) continue
    const made = await makeOwned(ctx, cc, obj, kind, ids)
    if (!made.ok) return made
  }
  return { ok: true, ids }
}

/** Make one console renderer on `obj` (drawing nothing) and add its uid to `ids`. */
async function makeOwned(ctx: WorkerContext, cc: CmdContext, obj: NumberedObject, kind: OwnedKind, ids: Map<string, number>): Promise<OpRun> {
  const made = await runOp(ctx, cc, 'create_renderer', {
    objId: obj.uid, rendererType: kind.type, name: kind.name, selection: NONE, centerView: false,
  })
  if (!made.ok) return made
  const id = ownedOn(ctx, cc.sceneId, obj.uid).get(kind.name)
  if (id === undefined) return { ok: false, error: `Error: could not make ${kind.name} on "${obj.name}"` }
  ids.set(kind.name, id)
  const styled = await runOp(ctx, cc, 'set_renderer_styles', { rendId: id, styles: kind.styles })
  if (!styled.ok) return styled
  for (const [prop, value] of kind.props ?? []) {
    const set = await runOp(ctx, cc, 'set_node_prop', { nodeType: 'renderer', nodeId: id, prop, value })
    if (!set.ok) return set
  }
  if (kind.hidden) {
    const hid = await runOp(ctx, cc, 'set_visible', { nodeId: id, nodeType: 'renderer', visible: false })
    if (!hid.ok) return hid
  }
  return { ok: true }
}

/** The atoms of a molecule by style: shown (the drawn renderers) and hidden (the hidden-style ones). */
export interface AtomSets {
  shown: Record<AtomStyle, string>
  hidden: Record<AtomStyle, string>
}

/** The atom sets as the renderers hold them now; `none` for a hidden-style renderer not made yet. */
export function readAtomSets(ctx: WorkerContext, sceneId: number, ids: Map<string, number>): AtomSets {
  const read = (name: string) => {
    const id = ids.get(name)
    return id === undefined ? NONE : readSel(ctx, sceneId, id)
  }
  const by = (f: (s: AtomStyle) => string) => Object.fromEntries(STYLE_KEYS.map((s) => [s, f(s)])) as Record<AtomStyle, string>
  return { shown: by((s) => read(ATOM_STYLES[s].name)), hidden: by((s) => read(HIDDEN_STYLES[s].name)) }
}

/** The union of a style record's three selections. */
export function unionOf(r: Record<AtomStyle, string>): string {
  return STYLE_KEYS.reduce((acc, s) => union(acc, r[s]), NONE)
}

/**
 * Write the hidden-style selections. A renderer not made yet is made only
 * when its selection matches an atom of the molecule; one made is kept and
 * emptied rather than deleted (see the file comment).
 */
export async function writeHidden(ctx: WorkerContext, cc: CmdContext, obj: NumberedObject, ids: Map<string, number>, hidden: Record<AtomStyle, string>): Promise<OpRun> {
  for (const s of STYLE_KEYS) {
    const kind = HIDDEN_STYLES[s]
    if (!ids.has(kind.name)) {
      if (hidden[s] === NONE || !emitContext(ctx, cc.sceneId).anyHit(obj.model, hidden[s])) continue
      const made = await makeOwned(ctx, cc, obj, kind, ids)
      if (!made.ok) return made
    }
    const w = await writeSel(ctx, cc, ids.get(kind.name) as number, hidden[s])
    if (!w.ok) return w
  }
  return { ok: true }
}

/** Write all six atom selections (computed from the sets read at the start of the command). */
export async function writeAtomSets(ctx: WorkerContext, cc: CmdContext, obj: NumberedObject, ids: Map<string, number>, next: AtomSets): Promise<OpRun> {
  const r = atomRenderers(ids)
  for (const s of STYLE_KEYS) {
    const w = await writeSel(ctx, cc, r[s], next.shown[s])
    if (!w.ok) return w
  }
  return writeHidden(ctx, cc, obj, ids, next.hidden)
}

/** Whether a renderer is shown (its `visible`). */
export function isVisible(ctx: WorkerContext, sceneId: number, rendId: number): boolean {
  const props = getGenericProps(ctx, { sceneId, nodeId: rendId, nodeType: 'renderer' })
  return props.ok ? props.entries.find((e) => e.key === 'visible')?.value !== false : false
}

/** Whether an object is shown (its `visible`; `hide ... models` clears it). */
export function isObjectVisible(ctx: WorkerContext, sceneId: number, objUid: number): boolean {
  const props = getGenericProps(ctx, { sceneId, nodeId: objUid, nodeType: 'object' })
  return props.ok ? props.entries.find((e) => e.key === 'visible')?.value !== false : false
}

/**
 * The objects other than molecules (maps) a specification reaches as a
 * whole: every one for an empty specification, else those a model part
 * names with nothing below it (`#1`, `#1-3`). A chain, residue, atom or
 * selector part reaches atoms only, so no map (as in ChimeraX, where a
 * volume has none).
 */
export function wholeMapsOf(ctx: WorkerContext, sceneId: number, spec: string): NumberedObject[] {
  const maps = numberedObjects(ctx, sceneId).filter((o) => !isMolecule(o))
  if (spec.trim() === '' || maps.length === 0) return maps
  const read = readSpec(ctx, sceneId, spec)
  if (!read.ok) return []
  const ec = emitContext(ctx, sceneId)
  return maps.filter((o) => {
    try {
      return emitFor(read.node, o.model, ec) === ALL
    } catch (e) {
      if (e instanceof SpecError) return false
      throw e
    }
  })
}

/** How a molecule's bases are drawn: as atoms, or by `chx:nuclbase` as slabs or a ladder. */
export type BaseMode = 'atoms' | 'slab' | 'ladder'

/** The base mode of a molecule, from its `chx:nuclbase` (shown, and its `base_type`). */
export function baseMode(ctx: WorkerContext, sceneId: number, ids: Map<string, number>): BaseMode {
  const id = ids.get(NUCL_BASE.name)
  if (id === undefined || !isVisible(ctx, sceneId, id)) return 'atoms'
  const props = getGenericProps(ctx, { sceneId, nodeId: id, nodeType: 'renderer' })
  return props.ok && props.entries.find((e) => e.key === 'base_type')?.value === 'basepair' ? 'ladder' : 'slab'
}

/**
 * The atoms of a molecule ChimeraX counts as displayed (its atom `display`
 * flag): what the shown atom renderers draw. Ribbons, tubes, base slabs and
 * surfaces are not atoms. `none` for a molecule the console never touched.
 * One definition for `@@display` and `save displayedOnly`.
 */
export function displayedAtoms(ctx: WorkerContext, sceneId: number, objUid: number): string {
  const owned = ownedOn(ctx, sceneId, objUid)
  let out = NONE
  for (const name of Object.values(ATOM_STYLES).map((k) => k.name)) {
    const id = owned.get(name)
    if (id === undefined || !isVisible(ctx, sceneId, id)) continue
    out = union(out, readSel(ctx, sceneId, id))
  }
  return out
}

/** `(a) or (b)`, simplified where one side is everything or nothing. */
export function union(a: string, b: string): string {
  if (a === '*' || b === '*') return '*'
  if (a === NONE) return b
  if (b === NONE) return a
  return `(${a}) or (${b})`
}

/** `(a) and not (b)`, simplified. */
export function minus(a: string, b: string): string {
  if (a === NONE || b === NONE) return a
  if (b === '*') return NONE
  return `(${a}) and not (${b})`
}

/** `(a) and (b)`, simplified. */
export function intersect(a: string, b: string): string {
  if (a === NONE || b === NONE) return NONE
  if (a === '*') return b
  if (b === '*') return a
  return `(${a}) and (${b})`
}

/**
 * Write a renderer's selection when it changes. `next` wraps the current
 * selection (union / minus / intersect), so it is simplified first: repeated
 * commands would otherwise nest it deeper every time.
 */
export async function writeSel(ctx: WorkerContext, cc: CmdContext, rendId: number, next: string): Promise<OpRun> {
  const selection = simplifySel(ctx, next, cc.sceneId)
  if (readSel(ctx, cc.sceneId, rendId) === selection) return { ok: true }
  return runOp(ctx, cc, 'set_renderer_selection', { rendId, selection })
}

/** The atom renderers' uids, by style. */
export function atomRenderers(ids: Map<string, number>): Record<AtomStyle, number> {
  return {
    stick: ids.get(ATOM_STYLES.stick.name) as number,
    ball: ids.get(ATOM_STYLES.ball.name) as number,
    sphere: ids.get(ATOM_STYLES.sphere.name) as number,
  }
}

/** The ribbon renderers' uids with their scopes. */
export function cartoonRenderers(ids: Map<string, number>): { id: number; scope: string }[] {
  return CARTOONS.map((k) => ({ id: ids.get(k.name) as number, scope: k.scope ?? '*' }))
}

/** How many entries a renderer's paint table has (0 when it is not painted). */
export function paintCount(ctx: WorkerContext, sceneId: number, rendId: number): number {
  const rend = getSceneOrNull(ctx, sceneId)?.getRenderer(rendId) as unknown as { coloring?: { size?: number } } | null | undefined
  try {
    return rend?.coloring?.size ?? 0
  } catch {
    return 0
  }
}

/**
 * Make sure a renderer can take paint entries: switch it to a PaintColoring
 * only when it is not one yet, since switching starts a new table and would
 * drop the entries an earlier `color` put there.
 */
export async function ensurePaint(ctx: WorkerContext, cc: CmdContext, rendId: number): Promise<OpRun> {
  // The renderer's colouring class, not the GUI panel's `canPaint`: that is
  // also false while the molecule has no selection, and switching then
  // would wipe the table every time.
  const rend = getSceneOrNull(ctx, cc.sceneId)?.getRenderer(rendId)
  if (rend && getColoringClassName(rend as Parameters<typeof getColoringClassName>[0]) === 'PaintColoring') return { ok: true }
  return runOp(ctx, cc, 'set_renderer_coloring', { nodeId: rendId, nodeType: 'renderer', mode: 'paint-type-paint', styleName: null })
}

/** One paint entry as `list_paint` reports it (and `add_paint_at` takes it back). */
export interface PaintRow {
  selStr: string
  colorValue: string
}

/** Whether a renderer is coloured by paint (a PaintColoring), whatever its table holds. */
export function isPaintColoring(ctx: WorkerContext, sceneId: number, rendId: number): boolean {
  const rend = getSceneOrNull(ctx, sceneId)?.getRenderer(rendId)
  return !!rend && getColoringClassName(rend as Parameters<typeof getColoringClassName>[0]) === 'PaintColoring'
}

/**
 * A renderer's paint entries, in order (the first that matches an atom
 * colours it); null when the renderer is not painted or its table is empty,
 * so it cannot be copied from. Checked before `list_paint`, which refuses a
 * renderer that is not a PaintColoring.
 */
export async function readPaint(ctx: WorkerContext, cc: CmdContext, rendId: number): Promise<PaintRow[] | null> {
  if (!isPaintColoring(ctx, cc.sceneId, rendId) || paintCount(ctx, cc.sceneId, rendId) === 0) return null
  const res = await runOp(ctx, cc, 'list_paint', { nodeId: rendId, nodeType: 'renderer' })
  if (!res.ok) return null
  const rows = (res.data as { entries?: PaintRow[] } | undefined)?.entries ?? []
  return rows.length > 0 ? rows : null
}

/**
 * Give a renderer exactly `rows` as its paint: switched to paint if it is
 * not (which seeds the app's default table), emptied, then the rows in order.
 */
export async function replacePaint(ctx: WorkerContext, cc: CmdContext, rendId: number, rows: readonly PaintRow[]): Promise<OpRun> {
  const painted = await ensurePaint(ctx, cc, rendId)
  if (!painted.ok) return painted
  if (paintCount(ctx, cc.sceneId, rendId) > 0) {
    const cleared = await runOp(ctx, cc, 'clear_paint', { nodeId: rendId, nodeType: 'renderer' })
    if (!cleared.ok) return cleared
  }
  for (const r of rows) {
    const res = await runOp(ctx, cc, 'add_paint_at', { nodeId: rendId, nodeType: 'renderer', selection: r.selStr, color: r.colorValue, at: null })
    if (!res.ok) return res
  }
  return { ok: true }
}

/**
 * Put `rows` first in a painted renderer's table, keeping their order, so
 * they win over the entries already there. The renderer must already be a
 * PaintColoring (switching would seed the default table over the colours
 * the rest of it keeps).
 */
export async function prependPaint(ctx: WorkerContext, cc: CmdContext, rendId: number, rows: readonly PaintRow[]): Promise<OpRun> {
  // An empty table takes them appended (there is no entry to insert before).
  const empty = paintCount(ctx, cc.sceneId, rendId) === 0
  for (const [i, r] of rows.entries()) {
    const res = await runOp(ctx, cc, 'add_paint_at', { nodeId: rendId, nodeType: 'renderer', selection: r.selStr, color: r.colorValue, at: empty ? null : i + 1 })
    if (!res.ok) return res
  }
  return { ok: true }
}
