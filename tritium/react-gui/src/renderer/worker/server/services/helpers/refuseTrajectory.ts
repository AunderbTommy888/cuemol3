/**
 * @file worker/server/services/helpers/refuseTrajectory.ts
 * @description The refusal of molecule tools that cannot work on a
 * Trajectory.
 *
 * A Trajectory (MD trajectory; C++ `mdtools::Trajectory`, a MolCoord) ties its
 * frames' coordinate arrays to a fixed set of atoms. Tools that add or remove
 * atoms (atom deletion, merge into or out of it) would break that tie --
 * `MolCoord::deleteAtoms` goes through `removeAtoms()` and never reaches
 * `Trajectory::removeAtom`'s own refusal -- and superpose / morph have no
 * clear meaning for it. The UI leaves Trajectory out of those pickers
 * (`objectFilters.molCoordNotTraj`); the services refuse it too, for ops and
 * console calls.
 */

import { fail, type Fail } from '@renderer/worker/shared/result';
import { safeRead } from '@renderer/worker/server/services/helpers/safeRead';

/**
 * The failure a tool returns when `obj` is a Trajectory.
 *
 * @param obj - the scene object the tool would act on
 * @param what - the operation, for the message (e.g. "superpose")
 * @returns an `unsupported` failure for a Trajectory, else null
 */
export function refuseTrajectory(obj: unknown, what: string): Fail | null {
    const className =
        safeRead(() => (obj as { getClassName?: () => string }).getClassName?.() ?? '') ?? '';
    return className === 'Trajectory'
        ? fail(`${what} is not supported for a trajectory`, 'unsupported')
        : null;
}
