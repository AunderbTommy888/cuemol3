/**
 * @file plugins/console/renderer/useStartupScripts.ts
 * @description Running the startup scripts (`~/.cuemol/startup.txt`,
 * `.qax`, `.pml`, `.cxc`) once per launch, before the files the OS handed
 * to the app open and before command-line requests run.
 *
 * - The hold on the startup gate (`plugin-host/startupGate.ts`) is taken
 *   when the Root mounts. Once the launch is ready (saved plugin preferences
 *   read, first scene in), the right to run is claimed: once per launch, so
 *   switching the console off and on again does not run them twice.
 * - Each script runs through the runner as a typed submission does
 *   (`runScript`): it shows as running, Stop cancels it, Undo / Redo wait.
 *   A script that fails goes on to the next; Stop, or the console switched
 *   off meanwhile, ends the startup scripts there.
 * - The gate opens when the last run returns, not when the Root unmounts.
 * - The progress goes to the status bar (`startupActivity`), which is where
 *   it is seen when the Console tab is not in front, and where Stop is.
 */

import { useEffect, useRef } from 'react'
import { IPC } from '@shared/ipcChannels'
import { holdStartup, startupReady } from '@renderer/plugin-host/api'
import { consoleSession } from './consoleSessionStore'
import { beginStartup, endStartup, setStartupFile } from './startupActivity'
import { planStartupScripts } from './startupScripts'
import { STARTUP_ECHO_PREFIX } from './useConsoleRunner'
import type { ScriptRunner } from './useConsoleRunner'
import { useDialectMetas } from './useDialectMetas'

export function useStartupScripts(runScript: ScriptRunner): void {
  const metas = useDialectMetas()
  // Read when the launch is ready, not when the hook first rendered: the
  // dialect plugins switched on by the saved preferences are in by then.
  const metasRef = useRef(metas)
  metasRef.current = metas
  const runRef = useRef(runScript)
  runRef.current = runScript

  useEffect(() => {
    const hold = holdStartup()
    let unmounted = false
    let started = false
    void (async () => {
      await startupReady()
      if (unmounted || !hold.claim()) {
        hold.release()
        return
      }
      started = true
      try {
        const info = await window.electronAPI?.invoke(IPC.APP_PATH)
        const plans = planStartupScripts(info?.startupScripts ?? [], metasRef.current)
        if (plans.length === 0) return
        beginStartup(plans.map((p) => p.path))
        let stopped = false
        try {
          for (const [i, plan] of plans.entries()) {
            if (!plan.run) {
              consoleSession.append([{ kind: 'warning', text: `${STARTUP_ECHO_PREFIX}${plan.reason}` }])
              setStartupFile(i, 'skipped')
              continue
            }
            setStartupFile(i, 'running')
            const res = await runRef.current(plan.path, plan.dialect)
            setStartupFile(i, res.failed ? 'failed' : res.stopped ? 'stopped' : 'done')
            if (res.stopped || unmounted) {
              stopped = true
              consoleSession.append([{ kind: 'warning', text: `${STARTUP_ECHO_PREFIX}startup scripts stopped` }])
              break
            }
          }
        } finally {
          endStartup(stopped)
        }
      } catch (e) {
        console.error('console: startup scripts:', e)
      } finally {
        hold.release()
      }
    })()
    return () => {
      unmounted = true
      // An unclaimed hold goes now; a running one when its run returns.
      if (!started) hold.release()
    }
  }, [])
}
