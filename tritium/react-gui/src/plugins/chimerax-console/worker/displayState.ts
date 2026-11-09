/**
 * @file plugins/chimerax-console/worker/displayState.ts
 * @description The console's atom display state of a molecule, read from and
 * written to CueMol (`atomDisplayState.ts` is the state itself).
 *
 * The state is kept, encoded, in a transient app-data entry of the scene
 * (`TransientStrData`, key `chx:display:<object uid>`): written in the
 * command's undo transaction, so an undo puts it back with the renderers, and
 * never saved. The atom renderers draw what it says is shown, written as
 * expressions without atom ids (`MolCoord.toAtomNameSel`), so a saved scene
 * still draws the same atoms when its atoms are numbered again on load.
 *
 * With no state kept (a molecule the console has not styled, a scene opened
 * from a file, an undo of the first command) it is read from the renderers:
 * an atom one of them draws is shown in its style, any other is hidden in
 * the style the automatic styling gives it. Atoms the state does not know
 * (added since) are taken in the same way.
 */

import type { WorkerContext } from '@renderer/worker/server/types/WorkerContext'
import { makeSel } from '@renderer/worker/server/services/helpers/makeSel'
import { getSceneOrNull } from '@renderer/worker/server/services/helpers/sceneResolver'
import type { CmdContext, OpRun } from '@plugins/console/worker/dialect-api'
import * as ads from './atomDisplayState'
import type { AtomStyle, DisplayState } from './atomDisplayState'
import { atomRenderers, readSel, runOp } from './display'
import { initialStylesOf } from './autoStyle'
import { NONE } from './spec/emit'
import type { NumberedObject } from './models'

/** The app-data class the state is kept in. */
const STORE_CLASS = 'TransientStrData'

/** The app-data key of a molecule's state. */
function storeKey(objUid: number): string {
  return `chx:display:${objUid}`
}

/** An app-data entry, as its wrapper exposes it. */
interface StoreEntry {
  getProp(name: string): unknown
  setProp(name: string, value: unknown): void
}

/** The scene's app-data store, as its wrapper exposes it. */
interface StoreScene {
  getAppData(id: string): StoreEntry | null | undefined
  getCreateAppData(id: string, className: string): StoreEntry | null | undefined
}

function storeOf(ctx: WorkerContext, sceneId: number): StoreScene | null {
  return getSceneOrNull(ctx, sceneId) as unknown as StoreScene | null
}

/** The state kept for a molecule, encoded; null when none is. */
function readStored(ctx: WorkerContext, sceneId: number, objUid: number): string | null {
  const e = storeOf(ctx, sceneId)?.getAppData(storeKey(objUid))
  if (!e || e.getProp('has_value') !== true) return null
  return String(e.getProp('value'))
}

/**
 * Keep the encoded state of a molecule (null: none), as an edit of this
 * command. The entry is never removed (the undo history refers to it), only
 * emptied.
 */
function writeStored(ctx: WorkerContext, cc: CmdContext, objUid: number, value: string | null): OpRun {
  try {
    const e = storeOf(ctx, cc.sceneId)?.getCreateAppData(storeKey(objUid), STORE_CLASS)
    if (!e) return { ok: false, error: 'Error: cannot keep the atom display state (no TransientStrData in this build)' }
    e.setProp('value', value ?? '')
    e.setProp('has_value', value !== null)
    // Not an op: tell the console the transaction holds an edit.
    cc.markMutated()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: `Error: cannot keep the atom display state: ${e instanceof Error ? e.message : String(e)}` }
  }
}

/** A molecule, as its wrapper exposes the calls used here. */
interface MolCalls {
  getSelArray(sel: unknown): unknown
  toAtomNameSel(sel: unknown): string
}

function molOf(ctx: WorkerContext, sceneId: number, objUid: number): MolCalls | null {
  return (getSceneOrNull(ctx, sceneId)?.getObject(objUid) as unknown as MolCalls | null) ?? null
}

/** The ids of the atoms `expr` matches in a molecule now, ascending. */
export function atomIds(ctx: WorkerContext, sceneId: number, objUid: number, expr: string): Int32Array {
  if (expr === NONE) return new Int32Array(0)
  const mol = molOf(ctx, sceneId, objUid)
  const sel = makeSel(ctx, expr, sceneId)
  if (!mol || !sel) return new Int32Array(0)
  const bytes = ctx.svc.copyToTypedArray(mol.getSelArray(sel)) as Uint8Array
  // A copy of its own, so the int view starts at offset 0.
  return new Int32Array(bytes.slice().buffer)
}

/** The atoms `ids` as an expression without atom ids; null when it cannot be written. */
function nameSelOf(ctx: WorkerContext, sceneId: number, objUid: number, ids: Int32Array): string | null {
  if (ids.length === 0) return NONE
  const mol = molOf(ctx, sceneId, objUid)
  const sel = makeSel(ctx, `aid ${ads.rangesOf(ids)}`, sceneId)
  if (!mol || !sel) return null
  const expr = mol.toAtomNameSel(sel)
  return expr === '' ? null : expr
}

/** A molecule's state as a command starts from it. */
export interface LoadedState {
  state: DisplayState
  /** A state was kept (else it was read from the renderers). */
  stored: boolean
  /** The ids of the atoms there are now. */
  present: Int32Array
}

/** Membership of each id in a few id sets, first match wins. */
function firstOf(sets: readonly [Set<number>, number][], fallback: number): (id: number) => number {
  return (id) => sets.find(([s]) => s.has(id))?.[1] ?? fallback
}

/**
 * The state a command starts from (reads only). Atoms the kept state does
 * not know are taken from the renderers (drawn: shown in that style) or
 * else hidden in the automatic styling's style.
 */
export function loadDisplayState(ctx: WorkerContext, sceneId: number, obj: NumberedObject, ids: Map<string, number>): LoadedState {
  const present = atomIds(ctx, sceneId, obj.uid, '*')
  const text = readStored(ctx, sceneId, obj.uid)
  const kept = text === null ? null : ads.decode(text)
  const base: DisplayState = kept ?? { ids: new Int32Array(0), code: new Uint8Array(0) }
  let fill: ((id: number) => number) | null = null
  const fillOf = (id: number): number => {
    if (!fill) {
      const r = atomRenderers(ids)
      const set = (expr: string) => new Set(atomIds(ctx, sceneId, obj.uid, expr))
      const initial = initialStylesOf(ctx, sceneId, obj.uid)
      fill = firstOf([
        ...ads.STYLE_KEYS.map((s): [Set<number>, number] => [set(readSel(ctx, sceneId, r[s])), ads.codeOf(s, true)]),
        ...ads.STYLE_KEYS.map((s): [Set<number>, number] => [set(initial[s]), ads.codeOf(s, false)]),
      ], ads.codeOf('stick', false))
    }
    return fill(id)
  }
  return { state: ads.withAtoms(base, present, fillOf), stored: kept !== null, present }
}

/**
 * The state the automatic styling sets (open, Initial Styles): `shown` are
 * the atoms drawn in each style, `modes` every atom's style (ChimeraX sets
 * the draw mode of every atom, shown or not). Nothing is kept from before.
 */
export function styledState(ctx: WorkerContext, sceneId: number, objUid: number, shown: Record<AtomStyle, string>, modes: Record<AtomStyle, string>): DisplayState {
  const present = atomIds(ctx, sceneId, objUid, '*')
  const set = (expr: string) => new Set(atomIds(ctx, sceneId, objUid, expr))
  const codeAt = firstOf([
    ...ads.STYLE_KEYS.map((s): [Set<number>, number] => [set(shown[s]), ads.codeOf(s, true)]),
    ...ads.STYLE_KEYS.map((s): [Set<number>, number] => [set(modes[s]), ads.codeOf(s, false)]),
  ], ads.codeOf('stick', false))
  return ads.stateOf(present, codeAt)
}

/**
 * Write a molecule's new state: the atom renderers whose atoms differ, and
 * the kept state when it changed, in this command's transaction. Nothing is
 * written when nothing changed and no state was kept yet (a no-op must not
 * clear redo). When a write fails, the ones made are put back first.
 */
export async function commitDisplayState(ctx: WorkerContext, cc: CmdContext, obj: NumberedObject, ids: Map<string, number>, before: LoadedState, next: DisplayState): Promise<OpRun> {
  const changed = !ads.sameState(before.state, next)
  if (!changed && !before.stored) return { ok: true }
  const r = atomRenderers(ids)
  const shown = ads.shownIds(next, before.present)

  // Everything written is worked out before the first write.
  const writes: { rendId: number; sel: string; old: string }[] = []
  for (const s of ads.STYLE_KEYS) {
    const old = readSel(ctx, cc.sceneId, r[s])
    if (ads.sameIds(atomIds(ctx, cc.sceneId, obj.uid, old), shown[s])) continue
    const sel = nameSelOf(ctx, cc.sceneId, obj.uid, shown[s])
    if (sel === null) return { ok: false, error: `Error: cannot write the ${s} atoms of "${obj.name}" as a selection` }
    writes.push({ rendId: r[s], sel, old })
  }

  const done: typeof writes = []
  const undoDone = async (error: string): Promise<OpRun> => {
    for (const w of done.reverse()) {
      const back = await runOp(ctx, cc, 'set_renderer_selection', { rendId: w.rendId, selection: w.old })
      if (!back.ok) return { ok: false, error: `${error}\n${back.error} (putting back the selection)` }
    }
    return { ok: false, error }
  }
  for (const w of writes) {
    const res = await runOp(ctx, cc, 'set_renderer_selection', { rendId: w.rendId, selection: w.sel })
    if (!res.ok) return undoDone(res.error)
    done.push(w)
  }
  if (changed) {
    const kept = writeStored(ctx, cc, obj.uid, ads.encode(next))
    if (!kept.ok) return undoDone(kept.error)
  }
  return { ok: true }
}
