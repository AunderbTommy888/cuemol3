/**
 * @file plugins/chimerax-console/worker/commands/fileCommands.test.ts
 * @description `open ... from rcsb_bio`: the biological assemblies one by one;
 * and the camera of the first models of an empty scene.
 *
 * ChimeraX opens assembly 1, 2, ... until one is missing (`fetch_pdb_bio.py`):
 * a missing first one is an error, a later one ends the list, and
 * `maxAssemblies` stops it earlier. A loop that stopped at the first
 * failure as an error, or never stopped, would not show as one.
 *
 * The first models of an empty scene are viewed as ChimeraX views them
 * (turned back, then fitted as Focus fits); a later open leaves the camera.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkerContext } from '@renderer/worker/server/types/WorkerContext'
import type { CmdContext } from '@plugins/console/worker/dialect-api'

const { state } = vi.hoisted(() => ({
  state: {
    urls: [] as string[],
    /** How many assemblies the entry has. */
    count: 2,
    /** Every op run, in order. */
    ops: [] as { name: string; args: Record<string, unknown> }[],
    /** The scene's objects (fetch_entry adds one). */
    objects: [] as { uid: number; model: number; name: string }[],
  },
}))

vi.mock('../display', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  runOp: async (_ctx: unknown, _cc: unknown, name: string, args: Record<string, unknown>) => {
    state.ops.push({ name, args })
    if (name === 'fetch_entry') {
      const n = state.objects.length + 1
      state.objects.push({ uid: 100 + n, model: n, name: String(args.id) })
    }
    if (name !== 'fetch_url') return { ok: true }
    const url = String(args.url)
    state.urls.push(url)
    const n = Number(/assembly(\d+)/.exec(url)?.[1])
    return n <= state.count ? { ok: true } : { ok: false, error: 'Error: 404' }
  },
}))
vi.mock('../models', () => ({ numberedObjects: () => [...state.objects], isMolecule: () => true }))
vi.mock('../autoStyle', () => ({ applyAutoStyle: async () => ({ ok: true }) }))
vi.mock('./viewCommands', () => ({ inheritSilhouettes: async () => ({ ok: true }) }))

import { FILE_COMMANDS } from './fileCommands'

const ctx = {} as WorkerContext
const cc = { sceneId: 1, viewId: 2, cwd: '/nonexistent', print: vi.fn(), warn: vi.fn() } as unknown as CmdContext

async function open(given: Record<string, string>) {
  const cmd = FILE_COMMANDS.open
  return cmd.run(ctx, Object.fromEntries(cmd.args.map((a) => [a.name, given[a.name] ?? a.default ?? ''])), cc)
}

beforeEach(() => {
  state.urls.length = 0
  state.count = 2
  state.ops.length = 0
  state.objects.length = 0
})

describe('open from rcsb_bio', () => {
  it('opens the assemblies in order until one is missing, maxAssemblies first', async () => {
    expect((await open({ names: '3d6y', fromDatabase: 'rcsb_bio' })).ok).toBe(true)
    expect(state.urls).toEqual([1, 2, 3].map((n) => `https://files.rcsb.org/download/3d6y-assembly${n}.cif`))

    state.urls.length = 0
    expect((await open({ names: '3d6y', fromDatabase: 'rcsb_bio', maxAssemblies: '1' })).ok).toBe(true)
    expect(state.urls).toHaveLength(1)

    state.count = 0
    expect((await open({ names: '3d6y', fromDatabase: 'rcsb_bio' })).ok).toBe(false)
  })
})

describe('open into an empty scene', () => {
  it('turns the camera back and fits it to the first models only, never centring on later ones', async () => {
    expect((await open({ names: '1crn' })).ok).toBe(true)
    const camera = state.ops.filter((o) => o.name === 'set_view' || o.name === 'focus_nodes')
    expect(camera.map((o) => o.name)).toEqual(['set_view', 'focus_nodes'])
    expect(camera[0].args.rotation).toEqual([1, 0, 0, 0])
    expect(camera[1].args.nodeIds).toEqual([101])
    expect(state.ops.find((o) => o.name === 'fetch_entry')?.args.centerView).toBe(false)

    state.ops.length = 0
    expect((await open({ names: '1ubq' })).ok).toBe(true)
    expect(state.ops.some((o) => o.name === 'set_view' || o.name === 'focus_nodes')).toBe(false)
    expect(state.ops.find((o) => o.name === 'fetch_entry')?.args.centerView).toBe(false)
  })
})
