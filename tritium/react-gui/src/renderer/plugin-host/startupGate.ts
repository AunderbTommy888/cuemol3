/**
 * @file renderer/plugin-host/startupGate.ts
 * @description The startup gate: what runs at launch (a plugin's startup
 * work, such as the console's startup scripts) runs before the files the
 * OS handed to the app open, and before command-line requests run.
 *
 * Module state, so it outlives a plugin's Root: `PluginRoots` unmounts a
 * plugin switched off and mounts it afresh when it is switched on, and the
 * launch's work must neither run again then nor be forgotten.
 *
 * - A plugin registers a hold when it mounts (`holdStartup`), waits for the
 *   launch to be ready (`startupReady`: the saved plugin preferences are
 *   read and the first scene has settled), then claims the right to run
 *   (`claim`). Claims succeed once per launch, while the gate is still
 *   closed.
 * - The gate opens (`startupSettled`) once the launch is ready and no hold
 *   is left. A hold goes when its work ends (`release`), or when it is
 *   dropped unclaimed (the plugin unmounted before running).
 * - A hold that is never claimed is dropped after a while, so a plugin that
 *   never starts cannot keep files from opening. A claimed hold has no
 *   time limit: opening the gate would not stop the work already running,
 *   and the files would load into the scene alongside it; stopping it is
 *   the plugin's job (the console's Stop).
 */

/** How long an unclaimed hold may keep the gate closed. */
export const UNCLAIMED_HOLD_MS = 30_000

/** One plugin's hold on the gate. */
export interface StartupHold {
  /** Take the right to run the launch's work; false when it is not this launch's to run any more. */
  claim(): boolean
  /** The work is done (or will not run): let go of the gate. */
  release(): void
}

let launchReady = false
let gateOpen = false
let claimed = false
const holds = new Set<symbol>()
let readyWaiters: (() => void)[] = []
let settledWaiters: (() => void)[] = []

function maybeOpen(): void {
  if (gateOpen || !launchReady || holds.size > 0) return
  gateOpen = true
  const waiters = settledWaiters
  settledWaiters = []
  for (const w of waiters) w()
}

/**
 * Tell the gate the launch is ready: the saved plugin preferences are read
 * and the first scene has settled (`AppBoot`).
 */
export function markStartupReady(): void {
  if (launchReady) return
  launchReady = true
  const waiters = readyWaiters
  readyWaiters = []
  for (const w of waiters) w()
  maybeOpen()
}

/** Resolves when the launch is ready (see `markStartupReady`). */
export function startupReady(): Promise<void> {
  return launchReady ? Promise.resolve() : new Promise((resolve) => readyWaiters.push(resolve))
}

/** Resolves when the launch's startup work is done: files may open, requests may run. */
export function startupSettled(): Promise<void> {
  return gateOpen ? Promise.resolve() : new Promise((resolve) => settledWaiters.push(resolve))
}

/** Hold the gate closed until the startup work this plugin may run is done. */
export function holdStartup(): StartupHold {
  const id = Symbol('startup hold')
  let running = false
  let released = false
  if (!gateOpen) holds.add(id)
  const release = () => {
    if (released) return
    released = true
    clearTimeout(timer)
    holds.delete(id)
    maybeOpen()
  }
  // Only an unclaimed hold times out (see the file comment).
  const timer = setTimeout(() => {
    if (running) return
    console.warn('startup gate: a hold was never claimed; opening the gate')
    release()
  }, UNCLAIMED_HOLD_MS)
  return {
    claim() {
      if (released || gateOpen || claimed) return false
      claimed = true
      running = true
      return true
    },
    release,
  }
}

/** Put the gate back to the launch state (tests). */
export function resetStartupGate(): void {
  launchReady = false
  gateOpen = false
  claimed = false
  holds.clear()
  readyWaiters = []
  settledWaiters = []
}
