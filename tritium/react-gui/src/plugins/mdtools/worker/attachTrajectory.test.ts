/**
 * Contract tests for attaching dropped trajectory files to a molecule
 * (attachTrajectory.ts).
 *
 * Pinned: a plain molecule is converted in ONE undo txn (XML round trip into
 * a Trajectory, objects swapped, scene-tree position kept, its structure file
 * appended as the frame-0 `structframe` block, then the trajectory files); a
 * failed read rolls all of it back; and the target list keeps only molecules
 * the files fit, with the reason for those that cannot be converted.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { WorkerContext } from '@renderer/worker/server/types/WorkerContext'

vi.mock('fs', () => {
  const existsSync = (p: string) => p.startsWith('/p/')
  return { existsSync, default: { existsSync } }
})

const sceneObjects: { uid: number; name: string; className: string }[] = []
vi.mock('@renderer/worker/server/services/scene/listSceneObjects', () => ({
  listSceneObjects: () => ({ objects: sceneObjects }),
}))

import { services as mdtoolsServices } from './mdtools.service'

interface MolOpts {
  uid: number
  className: string
  natoms: number
  src?: string
  moved?: boolean
  modified?: boolean
}

function makeMol(o: MolOpts) {
  return {
    uid: o.uid,
    name: `m${o.uid}`,
    ui_order: 3,
    modified: o.modified ?? false,
    src: o.src ?? '',
    alt_src: '',
    srctype: o.src ? 'pdb' : '',
    xformMat: { isIdent: () => !o.moved },
    getClassName: () => o.className,
    getAtomSize: () => o.natoms,
    getAllAtomSize: () => o.natoms,
  }
}

function makeFixture(opts: { mols: ReturnType<typeof makeMol>[]; fileAtoms?: number; failRead?: string }) {
  const calls: string[] = []
  const objs = new Map(opts.mols.map((m) => [m.uid, m]))

  const traj: Record<string, unknown> = {
    uid: 99,
    nframe: 11,
    set name(v: string) { calls.push(`traj.name=${v}`) },
    set ui_order(v: number) { calls.push(`traj.ui_order=${v}`) },
    append: vi.fn(() => calls.push('traj.append')),
  }

  const makeReader = (nick: string) => ({
    set targTrajUID(v: number) { calls.push(`${nick}.targTrajUID=${v}`) },
    set struct_type(v: string) { calls.push(`${nick}.struct_type=${v}`) },
    set nevery(v: number) { calls.push(`${nick}.nevery=${v}`) },
    setPath: (p: string) => calls.push(`${nick}.setPath(${p})`),
    attach: () => {},
    detach: () => {},
    createDefaultObj: () => ({}),
    read: () => {
      if (nick === opts.failRead) throw new Error('XTC: inconsistent NATOM with topology')
      calls.push(`${nick}.read`)
    },
    getFileAtomCount: () => opts.fileAtoms ?? -1,
  })

  const scene = {
    uid: 1,
    getObject: (uid: number) => objs.get(uid) ?? null,
    destroyObject: (uid: number) => calls.push(`scene.destroyObject(${uid})`),
    addObject: () => calls.push('scene.addObject(traj)'),
    startUndoTxn: (l: string) => calls.push(`startUndoTxn(${l})`),
    commitUndoTxn: () => calls.push('commitUndoTxn'),
    rollbackUndoTxn: () => calls.push('rollbackUndoTxn'),
  }

  const ctx = {
    sceMgr: { getScene: () => scene },
    strMgr: {
      createHandler: (nick: string) => makeReader(nick),
      toXML2: (_mol: unknown, cls: string) => { calls.push(`toXML2(${cls})`); return '<xml/>' },
      fromXML: () => { calls.push('fromXML'); return traj },
    },
  } as unknown as WorkerContext

  return { ctx, calls }
}

describe('attachTrajectory', () => {
  beforeEach(() => { sceneObjects.length = 0 })

  it('converts a molecule in one txn, keeping its coordinates as frame 0', () => {
    const mol = makeMol({ uid: 5, className: 'MolCoord', natoms: 100, src: '/p/m.pdb' })
    const { ctx, calls } = makeFixture({ mols: [mol] })

    const res = mdtoolsServices.attachTrajectory(ctx, { sceneId: 1, objId: 5, trajPaths: ['/p/a.xtc'] })

    expect(res).toEqual({ ok: true, objId: 99, nframe: 11 })
    expect(calls).toEqual([
      'startUndoTxn(Attach MD trajectory)',
      'toXML2(Trajectory)',
      'fromXML',
      'traj.name=m5',
      'scene.destroyObject(5)',
      'scene.addObject(traj)',
      'traj.ui_order=3',
      'structframe.targTrajUID=99',
      'structframe.struct_type=pdb',
      'structframe.setPath(/p/m.pdb)',
      'structframe.read',
      'traj.append',
      'xtctraj.targTrajUID=99',
      'xtctraj.setPath(/p/a.xtc)',
      'xtctraj.read',
      'traj.append',
      'commitUndoTxn',
    ])
  })

  it('rolls the conversion back when a trajectory file fails to read', () => {
    const mol = makeMol({ uid: 5, className: 'MolCoord', natoms: 100, src: '/p/m.pdb' })
    const { ctx, calls } = makeFixture({ mols: [mol], failRead: 'xtctraj' })

    const res = mdtoolsServices.attachTrajectory(ctx, { sceneId: 1, objId: 5, trajPaths: ['/p/a.xtc'] })

    expect(res).toEqual(expect.objectContaining({ ok: false, error: expect.stringMatching(/NATOM/) }))
    expect(calls).toContain('rollbackUndoTxn')
    expect(calls).not.toContain('commitUndoTxn')
  })

  it('lists only molecules with the files\' atom count, greying those it cannot convert', () => {
    const mols = [
      makeMol({ uid: 1, className: 'MolCoord', natoms: 100, src: '/p/ok.pdb' }),
      makeMol({ uid: 2, className: 'MolCoord', natoms: 50, src: '/p/small.pdb' }),
      makeMol({ uid: 3, className: 'MorphMol', natoms: 100, src: '/p/morph.pdb' }),
      makeMol({ uid: 4, className: 'MolCoord', natoms: 100, src: '/p/moved.pdb', moved: true }),
      makeMol({ uid: 5, className: 'MolCoord', natoms: 100, src: '/p/edited.pdb', modified: true }),
      makeMol({ uid: 6, className: 'MolCoord', natoms: 100 }),
      makeMol({ uid: 7, className: 'Trajectory', natoms: 100 }),
    ]
    for (const m of mols) sceneObjects.push({ uid: m.uid, name: m.name, className: m.getClassName() })
    const { ctx } = makeFixture({ mols, fileAtoms: 100 })

    const res = mdtoolsServices.listAttachTargets(ctx, { sceneId: 1, paths: ['/p/a.xtc'] })

    expect(res.fileAtoms).toBe(100)
    expect(res.mismatched).toBe(1)
    expect(res.targets.map((t) => [t.uid, t.reason ?? ''])).toEqual([
      [1, ''],
      [4, expect.stringMatching(/transformation matrix/)],
      [5, expect.stringMatching(/edited/)],
      [6, expect.stringMatching(/no original file/)],
      [7, ''],
    ])
  })
})
