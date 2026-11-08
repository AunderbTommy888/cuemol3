/**
 * @file plugins/console/renderer/startupActivity.ts
 * @description The startup scripts' progress, for the status bar.
 *
 * Written by `useStartupScripts` (which runs them) and read by the status
 * bar item; a module store because the two are mounted in different places.
 * The item shows while the scripts run, and stays after a failure or Stop
 * until the user has looked at it (`dismissStartup`).
 */

import { useSyncExternalStore } from 'react'

/** Where one startup script is. */
export type StartupFileStatus = 'waiting' | 'running' | 'done' | 'failed' | 'stopped' | 'skipped' | 'not-run'

export interface StartupFile {
  path: string
  status: StartupFileStatus
}

/** idle: nothing to show (none ran, or all went well, or it was seen). */
export type StartupPhase = 'idle' | 'running' | 'failed' | 'stopped'

export interface StartupActivity {
  phase: StartupPhase
  files: readonly StartupFile[]
}

const IDLE: StartupActivity = { phase: 'idle', files: [] }

let state: StartupActivity = IDLE
const listeners = new Set<() => void>()

function emit(next: StartupActivity): void {
  state = next
  for (const l of listeners) l()
}

/** The scripts are about to run, in this order. */
export function beginStartup(paths: readonly string[]): void {
  emit({ phase: 'running', files: paths.map((path) => ({ path, status: 'waiting' })) })
}

/** One script moved on. */
export function setStartupFile(index: number, status: StartupFileStatus): void {
  if (!state.files[index]) return
  emit({ ...state, files: state.files.map((f, i) => (i === index ? { ...f, status } : f)) })
}

/**
 * The scripts are over: the item goes when every script ran (or was
 * skipped), and stays to say so when one failed or Stop ended them.
 */
export function endStartup(stopped: boolean): void {
  const files = state.files.map((f) => (f.status === 'waiting' || f.status === 'running' ? { ...f, status: 'not-run' as const } : f))
  const failed = files.some((f) => f.status === 'failed')
  emit({ phase: stopped ? 'stopped' : failed ? 'failed' : 'idle', files: stopped || failed ? files : [] })
}

/** The user has seen how the scripts ended. */
export function dismissStartup(): void {
  if (state.phase === 'running') return
  emit(IDLE)
}

function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

/** The startup scripts' progress now. */
export function getStartupActivity(): StartupActivity {
  return state
}

/** The startup scripts' progress. */
export function useStartupActivity(): StartupActivity {
  return useSyncExternalStore(subscribe, getStartupActivity)
}
