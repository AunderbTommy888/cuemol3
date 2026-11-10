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
