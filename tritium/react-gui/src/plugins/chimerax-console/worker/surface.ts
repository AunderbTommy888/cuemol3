/**
 * @file plugins/chimerax-console/worker/surface.ts
 * @description The console's molecular surfaces, one `dsurface` renderer per chain.
 *
 * ChimeraX makes one solvent excluded surface per chain, of the chain's
 * polymer atoms, and shows or hides patches of it per atom. A `dsurface`
 * renderer does the same: its `sel` holds the atoms the surface is built
 * from, and its `showsel` the atoms whose patches are drawn. So each chain
 * gets `chx:surface:<chain>` (built from the chain's protein and nucleic
 * acid), and showing or hiding surfaces only edits `showsel` -- the renderer
 * selections are, as for the other `chx:` renderers, the display state.
 *
 * `surface enclose` builds one surface around the atoms given, as its own
 * renderer `chx:surface:enclose`.
 *
 * A new surface is coloured from the molecule's cartoon (its atoms when the
 * cartoon is not painted), as ChimeraX colours a new surface from the
 * ribbon colours (`molsurf.py` `surface_initial_color`). ChimeraX takes one
 * average colour per chain; the copy keeps each residue's colour, the same
 * picture after `color bychain`. A molecule the console has not styled
 * (opened from the GUI) has no painted renderer to copy, and its surface
 * keeps the default colouring.
 */

import type { WorkerContext } from '@renderer/worker/server/types/WorkerContext'
import { getGenericProps } from '@renderer/worker/server/services/props/read'
import { simplifySel } from '@renderer/worker/server/services/helpers/simplifySel'
import type { CmdContext, OpRun } from '@plugins/console/worker/dialect-api'
import { ATOM_STYLES, CARTOONS, emitContext, intersect, ownedOn, readPaint, replacePaint, runOp } from './display'
import type { PaintRow, Target } from './display'
import { NONE } from './spec/emit'
import { inheritSilhouettes } from './commands/viewCommands'

/** The prefix of the per-chain surfaces. */
export const SURFACE_PREFIX = 'chx:surface:'

/** The surface `surface enclose` builds. */
export const ENCLOSE = `${SURFACE_PREFIX}enclose`

/** What a chain's surface is built from: its polymer, no solvent, ligand or ion. */
const POLYMER = '(protein or nucleic)'

/** The atoms of chain `chain`. */
function chainSel(chain: string): string {
  return `chain ${chain}`
}

/** One console surface on a molecule. */
export interface OwnedSurface {
  id: number
  /** Its chain; null for the enclosing surface. */
  chain: string | null
}

/** The console's surfaces on molecule `objUid`. */
export function surfacesOn(ctx: WorkerContext, sceneId: number, objUid: number): OwnedSurface[] {
  const out: OwnedSurface[] = []
  for (const [name, id] of ownedOn(ctx, sceneId, objUid)) {
    if (!name.startsWith(SURFACE_PREFIX)) continue
    out.push({ id, chain: name === ENCLOSE ? null : name.slice(SURFACE_PREFIX.length) })
  }
  return out
}

/** A surface's `showsel`; '*' for an empty one (dsurface then shows everything). */
export function readShowSel(ctx: WorkerContext, sceneId: number, rendId: number): string {
  const props = getGenericProps(ctx, { sceneId, nodeId: rendId, nodeType: 'renderer' })
  if (!props.ok) return NONE
  const v = props.entries.find((e) => e.key === 'showsel')?.value
  const s = v === null || v === undefined ? '' : String(v).trim()
  return s === '' ? '*' : s
}

/** Write a surface's `showsel` when it changes (simplified first, as `writeSel`). */
export async function writeShowSel(ctx: WorkerContext, cc: CmdContext, rendId: number, next: string): Promise<OpRun> {
  const value = simplifySel(ctx, next, cc.sceneId)
  if (readShowSel(ctx, cc.sceneId, rendId) === value) return { ok: true }
  return runOp(ctx, cc, 'set_node_prop', { nodeType: 'renderer', nodeId: rendId, prop: 'showsel', value })
}

/** Make a surface renderer named `name` from `sel`, showing nothing yet. */
async function makeSurface(ctx: WorkerContext, cc: CmdContext, t: Target, name: string, sel: string): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  const made = await runOp(ctx, cc, 'create_renderer', {
    objId: t.obj.uid, rendererType: 'dsurface', name, selection: sel, centerView: false,
  })
  if (!made.ok) return made
  const id = ownedOn(ctx, cc.sceneId, t.obj.uid).get(name)
  if (id === undefined) return { ok: false, error: `Error: could not make ${name} on "${t.obj.name}"` }
  const hidden = await runOp(ctx, cc, 'set_node_prop', { nodeType: 'renderer', nodeId: id, prop: 'showsel', value: NONE })
  if (!hidden.ok) return hidden
  // The source is settled before the surface is touched: none leaves it as made.
  const rows = await initialPaint(ctx, cc, t.obj.uid)
  if (rows) {
    const painted = await replacePaint(ctx, cc, id, rows)
    if (!painted.ok) return painted
  }
  const outlined = await inheritSilhouettes(ctx, cc, (r) => r.id === id)
  return outlined.ok ? { ok: true, id } : outlined
}

/**
 * The paint a new surface of molecule `objUid` starts with: the console
 * cartoon's, else the first painted atom renderer's; null when neither is
 * painted (a molecule the console has not styled).
 */
async function initialPaint(ctx: WorkerContext, cc: CmdContext, objUid: number): Promise<PaintRow[] | null> {
  const owned = ownedOn(ctx, cc.sceneId, objUid)
  for (const name of [CARTOONS[0].name, ATOM_STYLES.sphere.name, ATOM_STYLES.stick.name, ATOM_STYLES.ball.name]) {
    const id = owned.get(name)
    if (id === undefined) continue
    const rows = await readPaint(ctx, cc, id)
    if (rows) return rows
  }
  return null
}

/**
 * Show the surface patches of a target's atoms, making the surface of each
 * chain they reach when it has none.
 *
 * @returns the surfaces it touched
 */
export async function showSurfaces(ctx: WorkerContext, cc: CmdContext, t: Target): Promise<{ ok: true; ids: number[] } | { ok: false; error: string }> {
  const chains = emitContext(ctx, cc.sceneId).chainsHit(t.obj.model, intersect(t.sel, POLYMER))
  const have = new Map(surfacesOn(ctx, cc.sceneId, t.obj.uid).filter((s) => s.chain !== null).map((s) => [s.chain as string, s.id]))
  const ids: number[] = []
  for (const chain of chains) {
    let id = have.get(chain)
    if (id === undefined) {
      const made = await makeSurface(ctx, cc, t, `${SURFACE_PREFIX}${chain}`, `(${chainSel(chain)}) and ${POLYMER}`)
      if (!made.ok) return made
      id = made.id
    }
    const shown = await writeShowSel(ctx, cc, id, unionShown(readShowSel(ctx, cc.sceneId, id), intersect(t.sel, chainSel(chain))))
    if (!shown.ok) return shown
    ids.push(id)
  }
  return { ok: true, ids }
}

/** `(a) or (b)` for `showsel`, simplified. */
function unionShown(a: string, b: string): string {
  if (a === '*' || b === '*') return '*'
  if (a === NONE) return b
  if (b === NONE) return a
  return `(${a}) or (${b})`
}

/** Build one surface around a target's atoms (`surface enclose`), shown whole. */
export async function encloseSurface(ctx: WorkerContext, cc: CmdContext, t: Target): Promise<{ ok: true; ids: number[] } | { ok: false; error: string }> {
  let id = surfacesOn(ctx, cc.sceneId, t.obj.uid).find((s) => s.chain === null)?.id
  if (id === undefined) {
    const made = await makeSurface(ctx, cc, t, ENCLOSE, t.sel)
    if (!made.ok) return made
    id = made.id
  } else {
    const resel = await runOp(ctx, cc, 'set_renderer_selection', { rendId: id, selection: t.sel })
    if (!resel.ok) return resel
  }
  const shown = await writeShowSel(ctx, cc, id, '*')
  return shown.ok ? { ok: true, ids: [id] } : shown
}

/** Hide the surface patches of a target's atoms on every console surface of its molecule. */
export async function hideSurfaces(ctx: WorkerContext, cc: CmdContext, t: Target): Promise<OpRun> {
  for (const s of surfacesOn(ctx, cc.sceneId, t.obj.uid)) {
    const cur = readShowSel(ctx, cc.sceneId, s.id)
    const next = t.sel === '*' || cur === NONE ? NONE : `(${cur}) and not (${t.sel})`
    const w = await writeShowSel(ctx, cc, s.id, next)
    if (!w.ok) return w
  }
  return { ok: true }
}

/** Delete the console surfaces a target's atoms reach (`surface close`). */
export async function closeSurfaces(ctx: WorkerContext, cc: CmdContext, t: Target): Promise<OpRun> {
  const chains = new Set(emitContext(ctx, cc.sceneId).chainsHit(t.obj.model, t.sel))
  for (const s of surfacesOn(ctx, cc.sceneId, t.obj.uid)) {
    // The enclosing surface goes with any of its molecule's atoms.
    if (s.chain !== null && !chains.has(s.chain)) continue
    const res = await runOp(ctx, cc, 'delete_node', { nodeId: s.id, nodeType: 'renderer' })
    if (!res.ok) return res
  }
  return { ok: true }
}
