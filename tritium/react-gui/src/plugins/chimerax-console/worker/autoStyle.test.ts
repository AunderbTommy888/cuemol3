/**
 * @file plugins/chimerax-console/worker/autoStyle.test.ts
 * @description Which of ChimeraX's automatic styles `open` picks, and what each shows.
 *
 * Pinned: ChimeraX's size thresholds, the short peptide (a polymer of 10
 * residues or fewer) drawn as sticks rather than as a cartoon, and the
 * small-polymer selections -- the cartoon on the polymer, sticks on the
 * residues near a ligand, spheres on its metals -- and that opening keeps
 * no hidden atom's style while a preset sets them all again (display.ts).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkerContext } from '@renderer/worker/server/types/WorkerContext'
import type { CmdContext } from '@plugins/console/worker/dialect-api'

const { state } = vi.hoisted(() => ({
  state: {
    /** The polymer residues of the molecule. */
    residues: 0,
    /** The selections written, by renderer name. */
    written: new Map<string, string>(),
    /** The hidden-style selections written (`writeHidden`), one record per call. */
    hidden: [] as Record<string, string>[],
  },
}))

const IDS = ['chx:stick', 'chx:ball', 'chx:sphere', 'chx:cartoon', 'chx:nucl']

vi.mock('./display', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ensureOwned: async () => ({ ok: true, ids: new Map(IDS.map((n, i) => [n, i])) }),
  writeSel: async (_ctx: unknown, _cc: unknown, id: number, sel: string) => {
    state.written.set(IDS[id], sel)
    return { ok: true }
  },
  writeHidden: async (_ctx: unknown, _cc: unknown, _obj: unknown, _ids: unknown, hidden: Record<string, string>) => {
    state.hidden.push(hidden)
    return { ok: true }
  },
  forEachAtom: (_ctx: unknown, _s: number, _uid: number, _expr: string, visit: (a: unknown) => void) => {
    for (let i = 0; i < state.residues; i++) visit({ chainName: 'A', residIndex: String(i + 1), residName: 'ALA', name: 'CA' })
  },
}))
vi.mock('./commands/colorCommands', () => ({ paintTarget: async () => ({ ok: true }), elementEntries: () => [] }))
vi.mock('./commands/displayCommands', () => ({ setBaseMode: async () => ({ ok: true }) }))

import { applyAutoStyle, autoStyleOf, LIGAND, METAL, SMALL_SHOWN } from './autoStyle'

const ctx = {} as WorkerContext
const cc = { sceneId: 1, viewId: 2, print: vi.fn(), warn: vi.fn() } as unknown as CmdContext
const obj = { uid: 10, model: 1, name: 'm', className: 'MolCoord' }

beforeEach(() => {
  state.written.clear()
  state.hidden = []
})

describe('auto style', () => {
  it('sizes a molecule up with ChimeraX\'s thresholds', () => {
    const size = { chains: 1, atoms: 1000, residues: 100, oneSequence: true }
    expect(autoStyleOf({ ...size, chains: 0 })).toBe('non-polymer')
    expect(autoStyleOf(size)).toBe('small polymer')
    expect(autoStyleOf({ ...size, chains: 5 })).toBe('medium polymer')
    expect(autoStyleOf({ ...size, residues: 5000 })).toBe('medium polymer')
    expect(autoStyleOf({ ...size, atoms: 1_000_000 })).toBe('large polymer')
  })

  it('draws a short peptide as sticks, and a small polymer as a cartoon with sticks near its ligands', async () => {
    state.residues = 10
    await applyAutoStyle(ctx, cc, obj)
    expect(Object.fromEntries(state.written)).toMatchObject({ 'chx:stick': '*', 'chx:cartoon': 'none' })

    state.residues = 11
    await applyAutoStyle(ctx, cc, obj)
    expect(state.written.get('chx:cartoon')).toBe('protein')
    expect(state.written.get('chx:stick')).toContain(`byres ((${LIGAND}) expand 3.6)`)
    expect(state.written.get('chx:sphere')).toBe(`(${SMALL_SHOWN}) and (${METAL} or ligand and elem F,Cl,Br,I)`)
    // Opening keeps no hidden atom's style: the atoms not shown are unassigned.
    expect(state.hidden).toEqual([])
  })

  it('sets the hidden atoms\' styles again with a preset, keeping none from before', async () => {
    state.residues = 11
    await applyAutoStyle(ctx, cc, obj, 'non-polymer', true)
    expect(state.written.get('chx:stick')).toBe('*')
    // Every atom is shown, so every hidden-style selection is emptied.
    expect(state.hidden).toEqual([{ stick: 'none', ball: 'none', sphere: 'none' }])
  })
})
