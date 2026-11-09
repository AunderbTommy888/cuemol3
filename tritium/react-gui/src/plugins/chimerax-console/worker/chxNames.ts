/**
 * @file plugins/chimerax-console/worker/chxNames.ts
 * @description The console's own names for specifications (`name X spec`).
 *
 * ChimeraX's `name X spec` names the specification's text, which is read
 * again wherever the name is used, so `name ALC1 #2/k,l` means chain k and l
 * of model 2 only. A CueMol named selection is one expression evaluated in
 * each molecule and cannot say "in model 2 only", so the console keeps a
 * table per scene, name -> ChimeraX specification text, in worker memory (as
 * the model numbers and the aliases): a naming aid, not scene state, so it is
 * not saved with the scene and not undone. A scene that is gone has its
 * table dropped the next time a table is read.
 */

import type { WorkerContext } from '@renderer/worker/server/types/WorkerContext'
import { getSceneOrNull } from '@renderer/worker/server/services/helpers/sceneResolver'

const tables = new Map<number, Map<string, string>>()

/** Drop the tables of scenes that are gone. */
function prune(ctx: WorkerContext): void {
  for (const id of [...tables.keys()]) if (!getSceneOrNull(ctx, id)) tables.delete(id)
}

/** The names of a scene, name -> specification text, in definition order. */
export function chxNames(ctx: WorkerContext, sceneId: number): ReadonlyMap<string, string> {
  prune(ctx)
  return tables.get(sceneId) ?? new Map()
}

/** Name a specification in a scene (replacing an earlier one of that name). Returns the one replaced. */
export function setChxName(sceneId: number, name: string, spec: string): string | undefined {
  let t = tables.get(sceneId)
  if (!t) {
    t = new Map()
    tables.set(sceneId, t)
  }
  const before = t.get(name)
  t.set(name, spec)
  return before
}

/** Forget a name (or put back `restore`, the definition it replaced). */
export function deleteChxName(sceneId: number, name: string, restore?: string): void {
  const t = tables.get(sceneId)
  if (!t) return
  if (restore === undefined) t.delete(name)
  else t.set(name, restore)
}
