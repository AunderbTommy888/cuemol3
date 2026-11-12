/**
 * @file worker/server/services/helpers/hasNoCoords.ts
 * @description Whether a molecule was read without coordinates.
 *
 * A topology-only file (an AMBER prmtop without its coord file, a PSF) gives a
 * molecule whose atoms all sit at the origin. Told by the bounding box rather
 * than by the reader, so it holds for any reader that leaves positions unset.
 * Runs in the Web Worker thread; wrappers are sync.
 */
import { safeRead } from './safeRead';

interface VecLike {
    x: number;
    y: number;
    z: number;
}

interface MolLike {
    getAtomSize(): number;
    getBoundBoxMin(fsel: boolean): VecLike;
    getBoundBoxMax(fsel: boolean): VecLike;
}

const atOrigin = (v: VecLike | undefined): boolean => !!v && v.x === 0 && v.y === 0 && v.z === 0;

/**
 * True when `obj` is a molecule of two or more atoms that all sit at the
 * origin (a single atom at the origin is a real position). False for anything
 * that is not a molecule.
 */
export function hasNoCoords(obj: unknown): boolean {
    const mol = obj as Partial<MolLike> | null;
    if (!mol || typeof mol.getBoundBoxMin !== 'function' || typeof mol.getBoundBoxMax !== 'function') {
        return false;
    }
    const natoms = safeRead(() => (mol as MolLike).getAtomSize()) ?? 0;
    if (natoms < 2) return false;
    return (
        atOrigin(safeRead(() => (mol as MolLike).getBoundBoxMin(false))) &&
        atOrigin(safeRead(() => (mol as MolLike).getBoundBoxMax(false)))
    );
}
