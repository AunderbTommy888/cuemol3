/**
 * @file plugins/mdtools/worker/attachTrajectory.ts
 * @description Attaching dropped trajectory files to a molecule already in the
 * scene (PyMOL's load of a trajectory onto an object).
 *
 * Runs in the Web Worker thread; wrappers are sync. A Trajectory target gets
 * the files appended as blocks. A plain molecule is first converted into a
 * Trajectory the way `convertToMorphMol` converts into a MorphMol (XML round
 * trip with the type overwritten, then the objects swapped), and keeps its own
 * coordinates as frame 0 through a `structframe` block that references its
 * structure file. Everything is one undo txn, so a failure (most often an atom
 * count that does not match) leaves the molecule as it was.
 *
 * Molecules that cannot be converted are refused, both in the target list
 * (with the reason) and here, for callers other than the dialog:
 *   - MorphMol: its morph frames would not carry over to the Trajectory.
 *   - a non-identity transformation matrix: Trajectory drops it, so the
 *     molecule would jump.
 *   - an edited molecule, or one without a local source file: it would be
 *     embedded in a .qsc (the same rule as SceneXMLWriter), and the frame-0
 *     block needs the original file to reference.
 */

import * as fs from 'fs';
import type { WorkerContext } from '@renderer/worker/server/types/WorkerContext';
import { undoTxnResult } from '@renderer/worker/server/services/withUndoTxn';
import { safeRead } from '@renderer/worker/server/services/helpers/safeRead';
import { isMoleculeClass } from '@renderer/worker/shared/objectClasses';
import { listSceneObjects } from '@renderer/worker/server/services/scene/listSceneObjects';
import { fail, ok, type Result } from '@renderer/worker/shared/result';
import { appendStructFrame, appendTrajFile, fileAtomCount, unsupportedTrajFormat, type TrajAppendTarget } from './trajBlocks';

const log = console;

/** Minimal surface of a molecule (driven through casts). */
interface MolHandle {
    uid: number;
    name: string;
    ui_order: number;
    modified: boolean;
    src: string;
    alt_src: string;
    srctype: string;
    xformMat: { isIdent(): boolean };
    getClassName(): string;
    getAtomSize(): number;
    /** Trajectory only: the topology's full atom count. */
    getAllAtomSize?(): number;
}

interface SceneHandle {
    uid: number;
    getObject(uid: number): unknown;
    destroyObject(uid: number): boolean;
    addObject(obj: unknown): void;
}

/** One molecule the dialog offers as a target. */
export interface AttachTarget {
    uid: number;
    name: string;
    /** C++ class name; `Trajectory` gets blocks appended, others are converted. */
    className: string;
    natoms: number;
    /** Why it cannot be chosen; absent when it can. */
    reason?: string;
}

export interface ListAttachTargetsArgs {
    sceneId: number;
    /** The dropped trajectory files; only molecules with their atom count are listed. */
    paths: string[];
}

export interface ListAttachTargetsResult {
    targets: AttachTarget[];
    /**
     * The atom count the files declare, when every file's header could be
     * read and they agree; the list was filtered by it. Absent when the count
     * could not be told (nothing filtered) or the files disagree (-1).
     */
    fileAtoms?: number;
    /** Molecules of the scene the atom count left out. */
    mismatched: number;
}

export interface AttachTrajectoryArgs {
    sceneId: number;
    /** The molecule (or Trajectory) to attach to. */
    objId: number;
    /** Trajectory files, in frame order. */
    trajPaths: string[];
    /** Keep every Nth frame (applied to every file). Default 1. */
    nevery?: number;
}

/**
 * `objId` of the Trajectory the files ended up in (new when converted) and
 * its frame count after the attach.
 */
export type AttachTrajectoryResult = Result<{ objId: number; nframe: number }>;

/** The local structure file a molecule was read from, or '' when there is none. */
function localSourceOf(mol: MolHandle): string {
    const src = safeRead(() => mol.src) ?? '';
    const alt = safeRead(() => mol.alt_src) ?? '';
    for (const p of [src, alt]) {
        if (!p || p.startsWith('datachunk:') || /^[a-z][a-z0-9+.-]*:\/\//i.test(p)) continue;
        if (fs.existsSync(p)) return p;
    }
    return '';
}

/**
 * Why `mol` (a plain molecule, not a Trajectory) cannot be converted, or ''
 * when it can.
 */
function conversionRefusal(mol: MolHandle): string {
    if (!(safeRead(() => mol.xformMat.isIdent()) ?? true)) {
        return 'has a transformation matrix (moved by superpose or similar)';
    }
    if (safeRead(() => mol.modified) ?? false) return 'has been edited';
    if (!(safeRead(() => mol.srctype) ?? '') || !localSourceOf(mol)) {
        return 'has no original file to read its coordinates from';
    }
    return '';
}

/**
 * The one atom count all `paths` declare: undefined when some header cannot
 * be read (no filtering then; the attach itself still checks), -1 when they
 * disagree (no molecule can take them all).
 */
function commonFileAtoms(ctx: WorkerContext, paths: string[]): number | undefined {
    let common: number | undefined;
    for (const p of paths) {
        const n = fileAtomCount(ctx, p);
        if (n <= 0) return undefined;
        if (common === undefined) common = n;
        else if (common !== n) return -1;
    }
    return common;
}

/** Every atom of a molecule, as a trajectory file has to match it. */
function topologyAtoms(mol: MolHandle, className: string): number {
    if (className === 'Trajectory') {
        const n = safeRead(() => mol.getAllAtomSize?.());
        if (n !== undefined && n > 0) return n;
    }
    return safeRead(() => mol.getAtomSize()) ?? 0;
}

/**
 * The molecules of a scene the attach dialog lists: those whose atom count
 * matches the dropped files, each with the reason when it cannot take them.
 */
export function listAttachTargets(
    ctx: WorkerContext,
    args: ListAttachTargetsArgs,
): ListAttachTargetsResult {
    const scene = ctx.sceMgr.getScene(args.sceneId) as unknown as SceneHandle | null;
    if (!scene) return { targets: [], mismatched: 0 };
    const fileAtoms = commonFileAtoms(ctx, args.paths);
    let mismatched = 0;
    const targets: AttachTarget[] = [];
    for (const { uid, className } of listSceneObjects(ctx, { sceneId: args.sceneId }).objects) {
        // MorphMol is left out: its morph frames would be lost.
        if (!isMoleculeClass(className) || className === 'MorphMol') continue;
        const mol = scene.getObject(uid) as MolHandle | null;
        if (!mol) continue;
        const natoms = topologyAtoms(mol, className);
        if (fileAtoms !== undefined && natoms !== fileAtoms) {
            mismatched++;
            continue;
        }
        const reason = className === 'Trajectory' ? '' : conversionRefusal(mol);
        targets.push({
            uid,
            name: safeRead(() => mol.name) ?? '',
            className,
            natoms,
            ...(reason ? { reason } : {}),
        });
    }
    return { targets, mismatched, ...(fileAtoms !== undefined ? { fileAtoms } : {}) };
}

/**
 * Convert `mol` into a Trajectory in place (same name and scene-tree
 * position) and append its structure file as frame 0. Runs inside the
 * caller's txn.
 */
function convertToTrajectory(ctx: WorkerContext, scene: SceneHandle, mol: MolHandle): TrajAppendTarget {
    const name = mol.name;
    const uiOrder = mol.ui_order;
    const srcPath = localSourceOf(mol);
    const srcType = mol.srctype;
    const xml = ctx.strMgr.toXML2(mol as unknown as Parameters<typeof ctx.strMgr.toXML2>[0], 'Trajectory');
    const traj = ctx.strMgr.fromXML(xml, scene.uid) as unknown as (TrajAppendTarget & MolHandle) | null;
    if (!traj) throw new Error('conversion to a trajectory failed');
    traj.name = name;
    scene.destroyObject(mol.uid);
    scene.addObject(traj);
    // ui_order is not persisted, so the round trip gave the new object one of
    // its own (the end of the scene tree); put it back where the molecule was.
    traj.ui_order = uiOrder;
    appendStructFrame(ctx, traj, srcPath, srcType);
    return traj;
}

/** Attach trajectory files to a molecule or Trajectory of the scene (one undo step). */
export function attachTrajectory(
    ctx: WorkerContext,
    args: AttachTrajectoryArgs,
): AttachTrajectoryResult {
    if (!args.trajPaths.length) return fail('no trajectory files given', 'invalid-args');
    const unsupported = unsupportedTrajFormat(args.trajPaths);
    if (unsupported) return fail(unsupported, 'unsupported');
    const scene = ctx.sceMgr.getScene(args.sceneId) as unknown as SceneHandle | null;
    if (!scene) return fail(`scene ${args.sceneId} not found`, 'not-found');
    const mol = scene.getObject(args.objId) as MolHandle | null;
    if (!mol) return fail('molecule not found', 'not-found');
    const className = safeRead(() => mol.getClassName()) ?? '';
    if (!isMoleculeClass(className)) return fail('not a molecule', 'invalid-args');
    if (className === 'MorphMol') {
        return fail('a morph animation cannot take a trajectory', 'unsupported');
    }
    const isTraj = className === 'Trajectory';
    if (!isTraj) {
        const reason = conversionRefusal(mol);
        if (reason) return fail(`"${mol.name}" ${reason}, so a trajectory cannot be attached`, 'unsupported');
    }
    const nevery = args.nevery && args.nevery > 1 ? args.nevery : 1;

    log.info(`[worker] attaching ${args.trajPaths.length} trajectory file(s) to ${mol.name}`);
    // A throw (atom-count mismatch, missing reader) rolls the conversion and
    // every block back and comes out as a Fail.
    return undoTxnResult(scene as unknown as Parameters<typeof undoTxnResult>[0], 'Attach MD trajectory', () => {
        const traj = isTraj ? (mol as unknown as TrajAppendTarget) : convertToTrajectory(ctx, scene, mol);
        for (const p of args.trajPaths) appendTrajFile(ctx, traj, p, nevery);
        const nframe = safeRead(() => (traj as unknown as { nframe: number }).nframe) ?? 0;
        return ok({ objId: traj.uid, nframe });
    });
}
