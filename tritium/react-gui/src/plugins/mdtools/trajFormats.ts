/**
 * @file plugins/mdtools/trajFormats.ts
 * @description The MD file formats the plugin reads: which extension is a
 * coordinate block (and with which reader), which a topology, and their
 * picker filters and badges. Pure data, shared by the worker and the dialogs.
 */

/** Coordinate file extension -> block reader nickname (mdtools TrajBlockReader). */
export const TRAJ_READER_BY_EXT: Record<string, string> = {
    dcd: 'dcdtraj',
    xtc: 'xtctraj',
    trr: 'trrtraj',
    nc: 'ambnetcdftraj',
    // One frame each (AMBER restart, NAMD binary coordinates).
    rst7: 'amberrst',
    inpcrd: 'amberrst',
    restrt: 'amberrst',
    coor: 'namdcoortraj',
};

/** Block readers whose file holds one frame (no frame sampling). */
export const SINGLE_FRAME_READERS: ReadonlySet<string> = new Set(['amberrst', 'namdcoortraj']);

/**
 * Topology reader nickname -> the block reader of its "coord" sub-stream: the
 * coordinate file a molecule opened as topology + coordinates was read with.
 */
export const COORD_BLOCK_READER_BY_TOPOLOGY: Record<string, string> = {
    amberprm: 'amberrst',
    psf: 'namdcoortraj',
};

/** Topology file extension -> molecule reader nickname (File > Open MD Trajectory). */
export const TOPOLOGY_READER_BY_EXT: Record<string, string> = {
    gro: 'gro',
    prmtop: 'amberprm',
    parm7: 'amberprm',
    psf: 'psf',
};

/** Every coordinate file extension, with the dot (for `contributes.fileOpeners`). */
export const TRAJ_DOT_EXTS: string[] = Object.keys(TRAJ_READER_BY_EXT).map((e) => `.${e}`);

/** Native picker filters for coordinate / trajectory files. */
export const TRAJ_FILTERS = [
    {
        name: 'MD coordinates / trajectory (*.dcd, *.xtc, *.trr, *.nc, *.rst7, *.inpcrd, *.restrt, *.coor)',
        extensions: Object.keys(TRAJ_READER_BY_EXT),
    },
    { name: 'All Files', extensions: ['*'] },
];

/** Native picker filters for topology files. */
export const TOPOLOGY_FILTERS = [
    { name: 'MD topology (*.gro, *.prmtop, *.parm7, *.psf)', extensions: Object.keys(TOPOLOGY_READER_BY_EXT) },
    { name: 'All Files', extensions: ['*'] },
];

/** Coordinate file extension -> short format badge label. */
const TRAJ_BADGE: Record<string, string> = {
    dcd: 'DCD',
    xtc: 'XTC',
    trr: 'TRR',
    nc: 'NetCDF',
    rst7: 'Restart',
    inpcrd: 'Restart',
    restrt: 'Restart',
    coor: 'NAMD coor',
};

/** Lower-cased final extension (without the dot). */
export function fileExt(filePath: string): string {
    const base = filePath.split(/[\\/]/).pop() ?? filePath;
    const dot = base.lastIndexOf('.');
    return dot >= 0 ? base.slice(dot + 1).toLowerCase() : '';
}

/** Short format label of a coordinate file, for the file lists. */
export function trajBadge(filePath: string): string {
    const ext = fileExt(filePath);
    return TRAJ_BADGE[ext] ?? ext.toUpperCase();
}

/** Whether `filePath` is a one-frame coordinate file (by extension). */
export function isSingleFrameFile(filePath: string): boolean {
    const nick = TRAJ_READER_BY_EXT[fileExt(filePath)];
    return nick !== undefined && SINGLE_FRAME_READERS.has(nick);
}

/**
 * `paths` with the one-frame coordinate files first (keeping the order within
 * each group), so a dropped restart becomes frame 0 ahead of the trajectory.
 */
export function singleFrameFirst(paths: readonly string[]): string[] {
    return [...paths.filter(isSingleFrameFile), ...paths.filter((p) => !isSingleFrameFile(p))];
}
