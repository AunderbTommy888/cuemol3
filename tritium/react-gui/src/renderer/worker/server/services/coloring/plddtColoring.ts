/**
 * @file worker/server/services/coloring/plddtColoring.ts
 * @description The pLDDT colouring an AlphaFold DB model starts with.
 *
 * A model fetched from AlphaFold DB is coloured by pLDDT (its B-factors),
 * as ChimeraX colours it. The colouring goes on the molecule
 * (`mol.coloring`), replacing the default Paint colouring `molPostProc`
 * gave it: the default renderers colour from the molecule (`$molcol`), so
 * they show it, and so does a renderer made later. Nothing else puts a
 * B-factor colouring on a molecule by itself.
 *
 * Runs in the Web Worker thread; C++ wrappers are called synchronously.
 */

import type { WorkerContext } from '@renderer/worker/server/types/WorkerContext';
import { PLDDT_NODES } from '@renderer/worker/shared/multiGradPresets';

const log = console;

/**
 * Put the pLDDT colouring on a molecule: a `BfacColoring` (B-factor mode,
 * no auto range) whose gradient is ChimeraX's `alphafold` colormap, the same
 * as the `AlphaFoldPlddtColoring` style.
 *
 * @param mol - the molecule (a MolCoord wrapper)
 * @returns whether it was set
 */
export function setPlddtMolColoring(ctx: WorkerContext, mol: unknown): boolean {
    try {
        const coloring = ctx.svc.createObj('BfacColoring') as unknown as {
            mode: string;
            auto: string;
            multi_grad?: { setNodesJSON: (json: string) => void };
        };
        coloring.mode = 'bfac';
        coloring.auto = 'none';
        coloring.multi_grad?.setNodesJSON(JSON.stringify(PLDDT_NODES.map((n) => ({ value: n.value, color: n.color }))));
        (mol as { coloring: unknown }).coloring = coloring;
        return true;
    } catch (e) {
        log.warn('setting the pLDDT coloring failed:', e);
        return false;
    }
}
