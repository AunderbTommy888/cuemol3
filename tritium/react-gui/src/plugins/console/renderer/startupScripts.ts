/**
 * @file plugins/console/renderer/startupScripts.ts
 * @description Which console dialect runs each startup script
 * (`~/.cuemol/startup.*`, listed by main in running order).
 *
 * The dialect is the one claiming the file's extension among the dialects
 * that are on (`scriptOwner`); a `.txt` no dialect claims is native command
 * lines. A script whose dialect's plugin is off is skipped, with a line
 * saying so.
 */

import { NATIVE_META, scriptOwner } from '../shared/dialectMeta'
import type { DialectMeta } from '../shared/dialectMeta'
import type { DialectId } from '../shared/consoleTypes'

/** One startup script: run in a dialect, or skipped with the reason. */
export type StartupScriptPlan =
  | { path: string; run: true; dialect: DialectId }
  | { path: string; run: false; reason: string }

/** The file name of a path (either separator). */
function baseName(filePath: string): string {
  return filePath.slice(Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\')) + 1)
}

/**
 * What to do with each startup script, in the order given.
 *
 * @param metas - the dialects that are on (`useDialectMetas`)
 */
export function planStartupScripts(paths: readonly string[], metas: readonly DialectMeta[]): StartupScriptPlan[] {
  return paths.map((p) => {
    const owner = scriptOwner(metas, p)?.meta
    if (owner) return { path: p, run: true, dialect: owner.id as DialectId }
    if (/\.txt$/i.test(p)) return { path: p, run: true, dialect: NATIVE_META.id as DialectId }
    const ext = /\.[^./\\]+$/.exec(p)?.[0] ?? ''
    return { path: p, run: false, reason: `${baseName(p)} skipped (the console dialect for ${ext} files is off)` }
  })
}
