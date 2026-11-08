/**
 * @file plugins/chimerax-console/worker/commands/warn.ts
 * @description Saying a keyword was accepted but not acted on.
 */

import type { CmdContext } from '@plugins/console/worker/dialect-api'

/**
 * Warn about each of `names` that was given: the keyword is read so a
 * ChimeraX script runs on, but the console does not do it yet.
 */
export function warnIgnored(cc: CmdContext, command: string, args: Record<string, string>, names: readonly string[]): void {
  for (const n of names) if ((args[n] ?? '') !== '') cc.warn(`${command}: ${n} is not supported yet; ignored`)
}

/**
 * Refuse what ChimeraX does and the console knows it does not (a refused
 * keyword, value or command): the runtime says it as a warning and skips it,
 * and the rest of a script runs. Anything not known to be unsupported (a
 * misspelling, a bad specification) stays a plain error, which stops it.
 */
export function unsupported(error: string): { ok: false; error: string; unsupported: true } {
  return { ok: false, error, unsupported: true }
}
