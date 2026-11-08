/**
 * Pins the startup gate (plugin-host/startupGate.ts): the launch's startup
 * work runs once, and the files the OS handed over wait for it.
 *
 * What would go unnoticed otherwise: a console switched off and on again
 * running the startup scripts a second time, a plugin that never starts
 * keeping files from opening for ever, and a long startup script having the
 * files opened into the scene while it still runs.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  UNCLAIMED_HOLD_MS,
  holdStartup,
  markStartupReady,
  resetStartupGate,
  startupSettled,
} from '@renderer/plugin-host/startupGate'

/** Whether the gate has opened, after pending promise callbacks ran. */
async function settled(): Promise<boolean> {
  let open = false
  void startupSettled().then(() => { open = true })
  await Promise.resolve()
  await Promise.resolve()
  return open
}

describe('startupGate', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetStartupGate()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('stays closed while claimed work runs, past the unclaimed timeout, and runs the work once per launch', async () => {
    const hold = holdStartup()
    markStartupReady()
    expect(hold.claim()).toBe(true)
    vi.advanceTimersByTime(UNCLAIMED_HOLD_MS * 2)
    expect(await settled()).toBe(false)

    // The console switched off and on: the new Root may not run it again.
    const again = holdStartup()
    expect(again.claim()).toBe(false)
    again.release()

    hold.release()
    expect(await settled()).toBe(true)
  })

  it('drops a hold that is never claimed', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    holdStartup()
    markStartupReady()
    expect(await settled()).toBe(false)
    vi.advanceTimersByTime(UNCLAIMED_HOLD_MS)
    expect(await settled()).toBe(true)
  })
})
