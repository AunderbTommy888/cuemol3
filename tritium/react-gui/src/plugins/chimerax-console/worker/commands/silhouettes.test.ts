/**
 * @file plugins/chimerax-console/worker/commands/silhouettes.test.ts
 * @description ChimeraX's silhouettes as CueMol outlines.
 *
 * ChimeraX inks every depth jump, which is CueMol's `edges` mode; its
 * `silhouette` mode inks the outer contour only, so writing it would lose
 * every interior line. And the silhouettes are one setting for the view:
 * renderers made after they were turned on (a model opened later) take the
 * same outline, or that model would be drawn without one.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkerContext } from '@renderer/worker/server/types/WorkerContext'
import type { CmdContext } from '@plugins/console/worker/dialect-api'

const { state } = vi.hoisted(() => ({
  state: {
    ops: [] as { name: string; args: Record<string, unknown> }[],
    /** Each renderer's object, type and outline. */
    rends: [] as { id: number; obj: number; type: string; egtype: string; eglinew: number; egcolor: string }[],
  },
}))

vi.mock('../display', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  runOp: async (_ctx: unknown, _cc: unknown, name: string, args: Record<string, unknown>) => {
    state.ops.push({ name, args })
    return { ok: true }
  },
}))
vi.mock('../camera', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  // 30 A over 300 pixels: 0.1 A a pixel.
  readCamera: () => ({ zoom: 30, height: 300, width: 400 }),
}))
vi.mock('@renderer/worker/server/catalog/refs', () => ({
  objectNodes: () => [...new Set(state.rends.map((r) => r.obj))].map((id) => ({ id })),
  rendererNodesOf: (obj: { id: number }) => state.rends.filter((r) => r.obj === obj.id).map((r) => ({ id: r.id, name: `r${r.id}`, type: 'renderer' })),
}))
vi.mock('@renderer/worker/server/services/props/read', () => ({
  getGenericProps: (_ctx: unknown, a: { nodeId: number }) => {
    const r = state.rends.find((x) => x.id === a.nodeId)
    return {
      ok: true,
      entries: r ? Object.entries({ type_name: r.type, egtype: r.egtype, eglinew: r.eglinew, egcolor: r.egcolor }).map(([key, value]) => ({ key, value })) : [],
    }
  },
}))

import { inheritSilhouettes, VIEW_COMMANDS } from './viewCommands'

const ctx = {} as WorkerContext
const cc = { sceneId: 1, viewId: 2, print: vi.fn(), warn: vi.fn() } as unknown as CmdContext

/** The set_node_prop writes, as `id prop=value`. */
const writes = () => state.ops.filter((o) => o.name === 'set_node_prop').map((o) => `${o.args.nodeId} ${o.args.prop}=${o.args.value}`)

beforeEach(() => {
  state.ops.length = 0
  state.rends = [
    { id: 1, obj: 10, type: 'cpk', egtype: 'none', eglinew: 0.01, egcolor: '#000000' },
    // Lines have no faces to outline.
    { id: 2, obj: 10, type: 'simple', egtype: 'none', eglinew: 0.01, egcolor: '#000000' },
  ]
})

describe('silhouettes', () => {
  it('outlines in the edges mode, and gives renderers made later the same outline', async () => {
    const cmd = VIEW_COMMANDS.graphicsSilhouettes
    const args = Object.fromEntries(cmd.args.map((a) => [a.name, a.default ?? '']))
    expect((await cmd.run(ctx, { ...args, enable: 'true' }, cc)).ok).toBe(true)
    // ChimeraX's 1 pixel at the current zoom.
    expect(writes()).toEqual(['1 egtype=edges', '1 eglinew=0.1'])

    // A model opened afterwards.
    state.rends[0] = { ...state.rends[0], egtype: 'edges', eglinew: 0.1 }
    state.rends.push({ id: 3, obj: 20, type: 'ribbon', egtype: 'none', eglinew: 0.01, egcolor: '#000000' })
    state.ops.length = 0
    expect((await inheritSilhouettes(ctx, cc, (r) => r.objUid === 20)).ok).toBe(true)
    expect(writes()).toEqual(['3 egtype=edges', '3 eglinew=0.1'])
  })
})
