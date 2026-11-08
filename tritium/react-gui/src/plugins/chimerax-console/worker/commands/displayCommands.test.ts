/**
 * @file plugins/chimerax-console/worker/commands/displayCommands.test.ts
 * @description `show ... models only` and the sections `cartoon style` writes.
 *
 * What the scene does not show as an error: `show #1 models only` leaving
 * the other models shown, and `cartoon style` writing ChimeraX's width
 * along CueMol's thickness axis (CueMol's section `width` is half the
 * thickness; the wide side is `2 width tuber`), or piping onto the coil,
 * which ChimeraX leaves round. And the nucleic acid bases (`chx:nuclbase`):
 * `nucleotides` switching how they are drawn on that renderer only, refusing
 * part of a model's nucleic acids (the setting is one per renderer), and the
 * base slabs going with the cartoon when it is hidden.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkerContext } from '@renderer/worker/server/types/WorkerContext'
import type { CmdContext } from '@plugins/console/worker/dialect-api'

const { ops, spec } = vi.hoisted(() => ({
  ops: [] as { name: string; args: Record<string, unknown> }[],
  /** What the specification means in the molecule. */
  spec: { sel: '*' },
}))

const OWNED = new Map([['chx:stick', 1], ['chx:ball', 2], ['chx:sphere', 3], ['chx:cartoon', 4], ['chx:nucl', 5], ['chx:nuclbase', 6]])

vi.mock('../display', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  runOp: async (_ctx: unknown, _cc: unknown, name: string, args: Record<string, unknown>) => {
    ops.push({ name, args })
    return { ok: true }
  },
  ensureOwned: async () => ({ ok: true, ids: new Map(OWNED) }),
  writeSel: async (_ctx: unknown, _cc: unknown, rendId: number, selection: string) => {
    ops.push({ name: 'set_renderer_selection', args: { rendId, selection } })
    return { ok: true }
  },
  targetsOf: () => ({ ok: true, targets: [{ obj: { uid: 10, model: 1, name: 'a', className: 'MolCoord' }, sel: spec.sel }] }),
  // The molecule has every kind of residue, so every section applies.
  emitContext: () => ({ anyHit: () => true }),
}))
vi.mock('../models', () => ({
  numberedObjects: () => [10, 20].map((uid) => ({ uid, model: uid / 10, name: `m${uid}`, className: 'MolCoord' })),
  isMolecule: () => true,
}))
vi.mock('@renderer/worker/server/services/props/read', () => ({
  // DefaultRibbon's sections: 0.4 thick, 2.4 wide.
  getGenericProps: () => ({
    ok: true,
    entries: ['helix', 'sheet', 'coil', 'section'].flatMap((p) => [
      { key: `${p}.width`, value: 0.2 },
      { key: `${p}.tuber`, value: 6 },
      { key: `${p}.type`, value: 'rectangle' },
    ]),
  }),
}))

vi.mock('@renderer/worker/server/services/helpers/simplifySel', () => ({ simplifySel: (_ctx: unknown, s: string) => s }))

import { DISPLAY_COMMANDS } from './displayCommands'

const ctx = {} as WorkerContext
const cc = { sceneId: 1, viewId: 2, print: vi.fn(), warn: vi.fn() } as unknown as CmdContext

/** Run a command with the given arguments, the rest at their defaults. */
async function run(name: keyof typeof DISPLAY_COMMANDS, given: Record<string, string>): Promise<void> {
  const cmd = DISPLAY_COMMANDS[name]
  const res = await cmd.run(ctx, Object.fromEntries(cmd.args.map((a) => [a.name, given[a.name] ?? a.default ?? ''])), cc)
  expect(res.ok).toBe(true)
}

/** The section properties written, as `renderer prop=value`. */
const written = () => ops.filter((o) => o.name === 'set_node_prop').map((o) => `${o.args.nodeId} ${o.args.prop}=${o.args.value}`)

beforeEach(() => {
  ops.length = 0
  spec.sel = '*'
})

describe('show models only', () => {
  it('shows the models named and hides every other one', async () => {
    await run('show', { objects: '#1', what: 'models', only: 'true' })
    expect(ops.filter((o) => o.name === 'set_visible').map((o) => [o.args.nodeId, o.args.visible])).toEqual([[10, true], [20, false]])
  })
})

describe('cartoon style', () => {
  it('writes the width along the wide axis, the thickness as the section width, and leaves the coil round', async () => {
    await run('cartoonStyle', { width: '3', thickness: '0.6' })
    expect(written()).toEqual([
      '4 helix.width=0.3', '4 helix.tuber=5',
      '4 sheet.width=0.3', '4 sheet.tuber=5',
      '4 coil.width=0.3', '4 coil.tuber=1',
      '5 section.width=0.3', '5 section.tuber=5',
    ])
    ops.length = 0
    await run('cartoonStyle', { xsection: 'piping' })
    expect(written()).not.toContain('4 coil.type=fancy1')
    expect(written()).toContain('4 helix.type=fancy1')
    expect(written()).toContain('4 helix.sharp=0.166667')
  })
})

describe('nucleotides', () => {
  it('draws the bases as a ladder or slabs on chx:nuclbase, hides it for atoms, and skips part of a model', async () => {
    // chx:nuclbase (6) is shown, as slabs (getGenericProps gives no visible / base_type).
    await run('nucleotides', { representation: 'ladder' })
    expect(written()).toEqual(['6 base_type=basepair'])
    expect(ops.filter((o) => o.name === 'set_visible')).toEqual([])

    ops.length = 0
    await run('nucleotides', { representation: 'atoms' })
    expect(ops.map((o) => [o.name, o.args.nodeId, o.args.visible])).toEqual([['set_visible', 6, false]])

    // Some of the nucleic acids only (anyHit: there are others).
    ops.length = 0
    spec.sel = 'chain A'
    await run('nucleotides', { objects: '/A', representation: 'slab' })
    expect(ops).toEqual([])
  })

  it('hides the base slabs with the nucleic cartoon', async () => {
    await run('hide', { what: 'cartoons' })
    expect(ops.filter((o) => o.name === 'set_renderer_selection').map((o) => [o.args.rendId, o.args.selection])).toEqual([[4, 'none'], [5, 'none'], [6, 'none']])
  })
})
