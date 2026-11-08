/**
 * @file main/dotDir.ts
 * @description The user's dot directory (`~/.cuemol/`, or `$CUEMOL_HOME`) and
 * the files CueMol reads from it at startup.
 *
 * ```
 * ~/.cuemol/
 *   startup.txt / startup.qax / startup.pml / startup.cxc   run at startup, in this order
 *   styles/*.xml                                            extra styles, by file name
 *   local-api.json                                          the command line's connection info
 * ```
 *
 * `CUEMOL_HOME` replaces the directory (development and tests). tritium_cli
 * resolves `local-api.json` by the same rule (`cli/src/connection.ts`).
 * Plain Node: no Electron import, so the local API module can use it.
 */

import fs from 'fs'
import os from 'os'
import path from 'path'

/** The startup scripts, in the order they run. */
export const STARTUP_SCRIPT_NAMES = ['startup.txt', 'startup.qax', 'startup.pml', 'startup.cxc'] as const

/** The user's dot directory: `$CUEMOL_HOME`, else `~/.cuemol`. */
export function getDotDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.CUEMOL_HOME || path.join(os.homedir(), '.cuemol')
}

/** The startup scripts there are, as absolute paths in running order. */
export function listStartupScripts(dir: string = getDotDir()): string[] {
  return STARTUP_SCRIPT_NAMES.map((n) => path.join(dir, n)).filter((p) => {
    try {
      return fs.statSync(p).isFile()
    } catch {
      return false
    }
  })
}

/** The extra style files (`styles/*.xml`), as absolute paths by file name; none without the folder. */
export function listDotStyleFiles(dir: string = getDotDir()): string[] {
  const styles = path.join(dir, 'styles')
  try {
    return fs
      .readdirSync(styles)
      .filter((n) => /\.xml$/i.test(n))
      .sort()
      .map((n) => path.join(styles, n))
      .filter((p) => fs.statSync(p).isFile())
  } catch {
    return []
  }
}
