/**
 * @file plugins/chimerax-console/worker/display.test.ts
 * @description What the ChX display commands write, as ops on the console's own renderers.
 *
 * Cartoons and paint are the `chx:` renderers' state; atoms have a display
 * state of their own (`displayState.ts`), kept in a scene app-data entry, from
 * which the atom renderers are written. The contracts:
 *
 * - show / hide / style write the specification into the selections, and no
 *   renderer not named `chx:` is touched; a hidden atom keeps its style
 *   (also one given while hidden, and through `show ... only`);
 * - a molecule the specification reaches no atom of is left alone (no
 *   renderer made);
 * - with no state kept (an undo of the first command, a scene opened from a
 *   file), a command starts from the selections as they are, and one that
 *   changes nothing writes nothing (redo is kept), also once atoms the state
 *   knows are deleted;
 * - a failed write puts back what the command had written;
 * - a colour given to atoms is in every atom renderer, so it stays when an
 *   atom changes style;
 * - a renderer is switched to per-selection paint once only, so a second
 *   `color` does not wipe the first;
 * - a map is reached as a whole by its model number only (a chain or residue
 *   part reaches atoms), so `view /b:16-24` does not frame a map.
 *
 * The catalog ops are faked over an in-memory molecule; what is checked is
 * the dialect's bookkeeping, not the ops.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkerContext } from '@renderer/worker/server/types/WorkerContext'
import type { CmdContext } from '@plugins/console/worker/dialect-api'

interface Rend {
  id: number
  name: string
  sel: string
  paint: boolean
  entries: [string, string][]
}

const state = vi.hoisted(() => ({
  rends: [] as Rend[],
  /** The ids of the atoms there are (indexes into ATOMS). */
  present: [0, 1, 2, 3],
  /** The app-data store (the kept display state). */
  store: new Map<string, { value: string; has_value: boolean }>(),
  /** Writes that change something: selections and store values. */
  writes: 0,
  failStore: false,
  nextId: 100,
  switched: [] as string[],
  objects: [] as { uid: number; name: string; className: string }[],
  initial: { stick: '*', ball: 'none', sphere: 'none' },
}))

vi.mock('@renderer/worker/server/catalog', async (importOriginal) => ({
  // The rest of the catalog is real: the console's runtime reads it through dialect-api.
  ...(await importOriginal<object>()),
  findOp: (name: string) => ({ name }),
  invokeOp: async (op: { name: string }, _ctx: unknown, a: Record<string, unknown>) => {
    const byId = (id: unknown) => state.rends.find((r) => r.id === id) as Rend
    switch (op.name) {
      case 'create_renderer':
        state.rends.push({ id: state.nextId++, name: String(a.name), sel: String(a.selection), paint: false, entries: [] })
        break
      case 'set_renderer_selection':
        byId(a.rendId).sel = String(a.selection)
        state.writes++
        break
      case 'set_renderer_coloring':
        byId(a.nodeId).paint = true
        byId(a.nodeId).entries = []
        state.switched.push(byId(a.nodeId).name)
        break
      case 'add_paint_at':
        byId(a.nodeId).entries.unshift([String(a.selection), String(a.color)])
        break
    }
    return { ok: true }
  },
}))
vi.mock('@renderer/worker/server/catalog/refs', () => ({
  objectNodes: () => [{ id: 1, name: '1crn', type: 'object', children: state.rends.map((r) => ({ id: r.id, name: r.name, type: 'renderer', children: [] })) }],
  rendererNodesOf: (obj: { children: unknown[] }) => obj.children,
}))
vi.mock('@renderer/worker/server/services/props/read', () => ({
  getGenericProps: (_ctx: unknown, a: { nodeId: number }) => ({
    ok: true,
    entries: [{ key: 'sel', value: state.rends.find((r) => r.id === a.nodeId)?.sel }],
  }),
}))
vi.mock('@renderer/worker/server/services/coloring/colorTargets', () => ({
  getColoringClassName: (rend: { id: number }) => (state.rends.find((r) => r.id === rend.id)?.paint ? 'PaintColoring' : 'CPKColoring'),
}))
vi.mock('@renderer/worker/server/services/helpers/makeSel', () => ({ makeSel: (_ctx: unknown, expr: string) => expr }))
vi.mock('@renderer/worker/server/services/helpers/sceneResolver', () => ({
  getSceneOrNull: () => ({
    getRenderer: (id: number) => ({ id }),
    getObject: () => ({
      getSelArray: (expr: string) => new Uint8Array(Int32Array.from(selectedIds(expr)).buffer),
      toAtomNameSel: (expr: string) => expr,
    }),
    getAppData: (key: string) => entry(key, false),
    getCreateAppData: (key: string) => entry(key, true),
  }),
}))

/** A fake TransientStrData entry over `state.store`. */
function entry(key: string, create: boolean) {
  if (!state.store.has(key)) {
    if (!create) return null
    state.store.set(key, { value: '', has_value: false })
  }
  const e = state.store.get(key) as { value: string; has_value: boolean }
  return {
    getProp: (n: 'value' | 'has_value') => e[n],
    setProp: (n: 'value' | 'has_value', v: never) => {
      if (state.failStore) throw new Error('store failed')
      e[n] = v
      if (n === 'value') state.writes++
    },
  }
}
vi.mock('@renderer/worker/server/services/scene/listSceneObjects', () => ({
  listSceneObjects: () => ({ objects: state.objects }),
}))

vi.mock('./autoStyle', () => ({
  applyAutoStyle: async () => ({ ok: true }),
  initialStylesOf: () => state.initial,
}))

import { CHX_COMMANDS } from './commands/registry'
import { bindLine, resolveWords } from './cli/syntax'
import { wholeMapsOf } from './display'
import { resetModelNumbers } from './models'

// No view: the camera is not read (keepingSilhouettes).
const ctx = { sceMgr: { getView: () => null }, svc: { copyToTypedArray: (a: unknown) => a } } as unknown as WorkerContext
const cc = {
  sceneId: 1, viewId: 2, cwd: '/', print: () => {}, printMarkdown: () => {}, warn: () => {}, markMutated: () => {},
  setCwd: () => {}, noteStream: () => {}, streamId: (t: string) => t, stopped: () => false,
  runScript: async () => ({ ok: true }), openScene: () => {}, requestScene: () => false,
} as unknown as CmdContext

/** Run one ChX command line against the fake molecule. */
async function chx(line: string): Promise<void> {
  const r = resolveWords(line, CHX_COMMANDS)
  if ('error' in r) throw new Error(r.error)
  const b = bindLine(r.spec, line)
  if (b.kind !== 'args') throw new Error(b.kind === 'error' ? b.error : 'usage')
  const out = await r.spec.run(ctx, b.args, cc)
  if (!out.ok) throw new Error(out.error)
}

const rend = (name: string) => state.rends.find((r) => r.name === name) as Rend

/** A few atoms to evaluate the written expressions on, rather than pin their text. */
const ATOMS = [
  { chain: 'A', resi: 3, resn: 'ALA', name: 'CA' },
  { chain: 'A', resi: 3, resn: 'ALA', name: 'CB' },
  { chain: 'A', resi: 7, resn: 'SER', name: 'CA' },
  { chain: 'A', resi: 9, resn: 'GLY', name: 'CA' },
]
type Atom = (typeof ATOMS)[number]

/**
 * The atoms a CueMol expression selects, for the subset the dialect writes:
 * and / or / not, brackets, `*`, `none`, `protein`, `ligand` (none here),
 * `resn`, `name`, `chain`, `resi a:b`, `aid a:b` (the index into ATOMS);
 * only atoms there are (`state.present`).
 */
function selectedIds(expr: string): number[] {
  const toks = expr.match(/\(|\)|[^\s()]+/g) ?? []
  let i = 0
  const term = (): (a: Atom) => boolean => {
    const t = toks[i++]
    if (t === '(') {
      const e = orExpr()
      i++
      return e
    }
    if (t === 'not') {
      const e = term()
      return (a) => !e(a)
    }
    if (t === '*' || t === 'protein') return () => true
    if (t === 'none' || t === 'ligand') return () => false
    const v = toks[i++].split(',')
    if (t === 'resn') return (a) => v.includes(a.resn)
    if (t === 'name') return (a) => v.includes(a.name)
    if (t === 'chain') return (a) => v.includes(a.chain)
    const inRange = (x: number) => v.some((r) => { const [lo, hi = lo] = r.split(':').map(Number); return x >= lo && x <= hi })
    if (t === 'resi') return (a) => inRange(a.resi)
    if (t === 'aid') return (a) => inRange(ATOMS.indexOf(a))
    throw new Error(`unexpected ${t}`)
  }
  const andExpr = () => {
    let e = term()
    while (toks[i] === 'and') { i++; const l = e, r = term(); e = (a) => l(a) && r(a) }
    return e
  }
  const orExpr = () => {
    let e = andExpr()
    while (toks[i] === 'or') { i++; const l = e, r = andExpr(); e = (a) => l(a) || r(a) }
    return e
  }
  const f = orExpr()
  return ATOMS.flatMap((a, id) => (state.present.includes(id) && f(a) ? [id] : []))
}

/** The atoms an expression selects, by name. */
function selected(expr: string): string[] {
  return selectedIds(expr).map((id) => `${ATOMS[id].resn}${ATOMS[id].resi}@${ATOMS[id].name}`)
}

describe('ChX display state', () => {
  beforeEach(() => {
    state.rends = [{ id: 1, name: 'mine', sel: 'protein', paint: false, entries: [] }]
    state.nextId = 100
    state.switched = []
    state.objects = [{ uid: 1, name: '1crn', className: 'MolCoord' }]
    state.initial = { stick: '*', ball: 'none', sphere: 'none' }
    state.present = [0, 1, 2, 3]
    state.store.clear()
    state.writes = 0
    state.failStore = false
    resetModelNumbers()
  })

  it('combines show, hide, style and cartoon into the chx: selections, leaving other renderers alone', async () => {
    await chx('show :ALA atoms')
    await chx('style :ALA sphere')
    await chx('hide :ALA@CB')
    await chx('cartoon')
    await chx('cartoon hide :1-5')
    expect(selected(rend('chx:stick').sel)).toEqual([])
    expect(selected(rend('chx:sphere').sel)).toEqual(['ALA3@CA'])
    // Residues 1-5 left the cartoon; the rest of the protein stays.
    expect(selected(rend('chx:cartoon').sel)).toEqual(['SER7@CA', 'GLY9@CA'])
    expect(rend('mine').sel).toBe('protein')
  })

  it('keeps the style of a hidden atom, and leaves a molecule the specification reaches no atom of alone', async () => {
    await chx('show :TRP atoms only')
    expect(state.rends.map((r) => r.name)).toEqual(['mine'])

    await chx('show :ALA,SER atoms')
    await chx('style :ALA sphere')
    await chx('hide :ALA')
    // A style given while hidden is kept too, and through show ... only.
    await chx('style :ALA@CB ball')
    await chx('show :SER atoms only')
    await chx('show :ALA atoms')
    expect(selected(rend('chx:sphere').sel)).toEqual(['ALA3@CA'])
    expect(selected(rend('chx:ball').sel)).toEqual(['ALA3@CB'])
    expect(selected(rend('chx:stick').sel)).toEqual(['SER7@CA'])
  })

  it('starts from the selections with no state kept, and writes nothing when nothing changes', async () => {
    await chx('show :ALA')
    // An undo of that command: the state is gone, the selection is back.
    state.store.clear()
    rend('chx:stick').sel = 'resn GLY'
    await chx('show :SER')
    expect(selected(rend('chx:stick').sel)).toEqual(['SER7@CA', 'GLY9@CA'])

    state.store.clear()
    state.writes = 0
    await chx('show :GLY')
    expect(state.writes).toBe(0)

    // A state kept, then an atom it knows deleted: still nothing to write.
    await chx('style :SER ball')
    await chx('style :SER stick')
    state.present = [0, 1, 2]
    state.writes = 0
    await chx('show :SER')
    expect(state.writes).toBe(0)
  })

  it('puts the selections back when keeping the state fails', async () => {
    await chx('show :ALA')
    state.failStore = true
    await expect(chx('style :ALA sphere')).rejects.toThrow('store failed')
    expect(selected(rend('chx:stick').sel)).toEqual(['ALA3@CA', 'ALA3@CB'])
    expect(selected(rend('chx:sphere').sel)).toEqual([])
  })

  it('keeps a colour across a style change, and switches a renderer to paint once only', async () => {
    await chx('show :ALA')
    await chx('color /A red target a')
    await chx('color /B blue target a')
    await chx('style :ALA sphere')
    for (const name of ['chx:stick', 'chx:ball', 'chx:sphere']) {
      expect(rend(name).entries).toEqual([['chain B', '#0000ff'], ['chain A', '#ff0000']])
    }
    expect(state.switched).toEqual(['chx:stick', 'chx:ball', 'chx:sphere'])
  })

  it('reaches a map as a whole by its model number only', () => {
    state.objects.push({ uid: 2, name: 'emd', className: 'DensityMap' })
    expect(wholeMapsOf(ctx, 1, '#2').map((o) => o.uid)).toEqual([2])
    expect(wholeMapsOf(ctx, 1, '').map((o) => o.uid)).toEqual([2])
    expect(wholeMapsOf(ctx, 1, '/A:3-7')).toEqual([])
  })
})
