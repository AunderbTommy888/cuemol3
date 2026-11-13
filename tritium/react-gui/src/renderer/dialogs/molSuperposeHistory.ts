/**
 * @file dialogs/molSuperposeHistory.ts
 * @description localStorage-backed history for the Molecular superposition
 * dialog. Mirrors UXP `ssm_sup.js` preference persistence
 * (`cuemol2.ui.histories.mol_superpose_*`): the last-used reference / moving
 * molecule uids and selection strings, the chosen algorithm and US-align
 * pivot, and the two checkbox states are saved on a successful superposition
 * and restored when the dialog reopens.
 *
 * The selection-string dropdown history is separate: it is the shared
 * MolSelList `selHistory` store, common to every selection input.
 */

import { createDialogPrefs, isBool, isOneOf, isOptNum, isStr } from '@renderer/utils/createDialogPrefs';
import {
    DEFAULT_SUPERPOSE_ALGO,
    USALIGN_PIVOTS,
    type SuperposeAlgo,
} from '@renderer/worker/shared/superposeTypes';

export const STORAGE_KEY = 'cuemol2.ui.histories.mol_superpose';

export interface MolSuperposeHistory {
    refObjId?: number;
    movObjId?: number;
    refSel: string;
    movSel: string;
    algo: SuperposeAlgo;
    pivot: string;
    autoRecenter: boolean;
    useprop: boolean;
}

export const DEFAULT_HISTORY: MolSuperposeHistory = {
    refSel: '',
    movSel: '',
    algo: DEFAULT_SUPERPOSE_ALGO,
    pivot: 'auto',
    autoRecenter: true,
    useprop: false,
};

const SUPERPOSE_ALGOS: readonly SuperposeAlgo[] = ['USalign', 'SSM', 'LSQ'];

const prefs = createDialogPrefs<MolSuperposeHistory>({
    key: STORAGE_KEY,
    defaults: DEFAULT_HISTORY,
    fields: {
        refObjId: isOptNum,
        movObjId: isOptNum,
        refSel: isStr,
        movSel: isStr,
        algo: isOneOf(SUPERPOSE_ALGOS),
        pivot: isOneOf(USALIGN_PIVOTS),
        autoRecenter: isBool,
        useprop: isBool,
    },
});

export function loadMolSuperposeHistory(): MolSuperposeHistory {
    return prefs.load();
}

export function saveMolSuperposeHistory(hist: MolSuperposeHistory): void {
    prefs.save(hist);
}

/**
 * The reference and moving molecules the dialog opens with: the saved ones
 * when they are still in the scene, else the first molecule for the
 * reference. The moving one differs from the reference whenever the scene
 * has two or more molecules (UXP `ssm_sup.js` picks the second item when no
 * moving molecule is saved): a saved moving molecule equal to the reference,
 * or one no longer present, gives way to the first other molecule.
 *
 * @param uids - the molecules that can be picked, in list order
 * @param hist - the saved history
 * @returns the reference and moving uids (undefined when there is none)
 */
export function defaultSuperposePair(
    uids: readonly number[],
    hist: Pick<MolSuperposeHistory, 'refObjId' | 'movObjId'>,
): { refObjId: number | undefined; movObjId: number | undefined } {
    const has = (id: number | undefined): id is number => id !== undefined && uids.includes(id);
    const refObjId = has(hist.refObjId) ? hist.refObjId : uids[0];
    const movObjId = has(hist.movObjId) && hist.movObjId !== refObjId
        ? hist.movObjId
        : (uids.find((id) => id !== refObjId) ?? refObjId);
    return { refObjId, movObjId };
}
