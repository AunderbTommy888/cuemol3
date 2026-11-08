/**
 * @file plugins/chimerax-console/worker/chimeraxCommands.ts
 * @description ChimeraX's command names, to tell a ChimeraX command the
 * console does not have (skipped, so a script goes on) from a misspelling
 * (an error).
 *
 * Generated from the ChimeraX 1.12 source: every
 * `<ChimeraXClassifier>Command :: <name> :: ...` in the bundles'
 * `bundle_info.xml` and every `[tool.chimerax.command."<name>"]` in their
 * `pyproject.toml` (the test-only `bogus` left out): the first words
 * (203) and the names of more than one word (233).
 */

/** The first word of every ChimeraX command. */
const COMMAND_WORDS: readonly string[] = [
  '~alias', '~aniso', '~bond', '~cartoon', '~clashes', '~clip', '~cofr', '~colordef', '~colourdef', '~contacts',
  '~display', '~distance', '~hbonds', '~key', '~label', '~nucleotides', '~pbond', '~perframe', '~ribbon', '~select',
  '~set', '~show', '~struts', '~surface', '~tile', '~worm', '2dlabels', 'addcharge', 'addh', 'alias', 'align',
  'alphafold', 'altlocs', 'angle', 'animations', 'aniso', 'axis', 'blastpdb', 'blastprotein', 'boltz', 'bond',
  'build', 'bumps', 'buttonpanel', 'cage', 'camera', 'cartoon', 'cbumps', 'cd', 'changechains', 'chirality',
  'clashes', 'clip', 'close', 'cofr', 'color', 'colordef', 'colour', 'colourdef', 'combine', 'contacts', 'coordset',
  'coulombic', 'crossfade', 'crosslinks', 'crystalcontacts', 'debug', 'defattr', 'define', 'delete', 'device',
  'diffplot', 'display', 'distance', 'dockprep', 'dssp', 'echo', 'esmfold', 'exit', 'findclash', 'fitmap', 'fly',
  'foldseek', 'functionkey', 'getcrd', 'graphics', 'hbonds', 'help', 'hide', 'hkcage', 'info', 'interfaces', 'key',
  'ks', 'kvfinder', 'label', 'leapmotion', 'lighting', 'linux', 'log', 'lookingglass', 'marker', 'matchmaker',
  'material', 'mcopy', 'mcp', 'md', 'measure', 'meeting', 'minimize', 'mlp', 'mmaker', 'modelcif', 'modeller',
  'molmap', 'morph', 'mousemode', 'move', 'movie', 'msa3d', 'mseries', 'mutationscores', 'name', 'nucleotides',
  'open', 'openfold', 'palette', 'pbond', 'pdbimages', 'perframe', 'phenix', 'preset', 'pwd', 'quit', 'rainbow',
  'realsense', 'redo', 'register', 'registration', 'remotecontrol', 'rename', 'renumber', 'resfit', 'ribbon', 'rmsd',
  'rna', 'rock', 'roll', 'runscript', 'save', 'scalebar', 'scenes', 'segmentation', 'segmentations', 'select',
  'sequence', 'set', 'setattr', 'shape', 'show', 'signal', 'similarstructures', 'size', 'smoothlines', 'snapshot',
  'snfg', 'sop', 'speech', 'split', 'stop', 'struts', 'style', 'surface', 'swapaa', 'swapna', 'sym', 'taskman',
  'tile', 'time', 'tool', 'topography', 'torsion', 'transparency', 'tug', 'turn', 'ui', 'undo', 'unitcell', 'usage',
  'version', 'view', 'volume', 'vop', 'vr', 'vseries', 'wait', 'webcam', 'windowsize', 'wobble', 'worm', 'xr', 'zone',
  'zoom',
]

/** The ChimeraX commands of more than one word, lower case (`alphafold match`). */
const MULTI_WORD_COMMANDS: readonly string[] = [
  'addcharge nonstd', 'alias delete', 'alias list', 'alphafold contacts', 'alphafold covariation', 'alphafold dimers',
  'alphafold fetch', 'alphafold interfaces', 'alphafold match', 'alphafold monomers', 'alphafold msa',
  'alphafold pae', 'alphafold predict', 'alphafold search', 'animations clear', 'animations play',
  'animations preview', 'animations record', 'animations setlength', 'animations stop', 'animations stoprecording',
  'animations timeline', 'axis align', 'blastprotein pull', 'boltz install', 'boltz ligandtable', 'boltz predict',
  'boltz server fetch', 'boltz server list', 'boltz server start', 'bond length', 'color cylindrical', 'color delete',
  'color electrostatic', 'color gradient', 'color height', 'color image', 'color list', 'color name', 'color radial',
  'color sample', 'color show', 'debug dumpspec', 'debug exectest', 'debug expectfail', 'debug parser', 'debug test',
  'define axis', 'define centroid', 'define plane', 'device leapmotion', 'device lookingglass', 'device realsense',
  'device snav', 'device vr', 'device webcam', 'esmfold contacts', 'esmfold fetch', 'esmfold match', 'esmfold pae',
  'esmfold predict', 'esmfold search', 'label missing', 'lighting model', 'linux flatpak-files', 'linux xdg-install',
  'linux xdg-uninstall', 'log chains', 'mcp info', 'mcp setup', 'mcp start', 'mcp stop', 'md cluster', 'measure area',
  'measure blob', 'measure buriedarea', 'measure center', 'measure contactarea', 'measure convexity',
  'measure correlation', 'measure inertia', 'measure length', 'measure mapstats', 'measure mapvalues',
  'measure motion', 'measure rotation', 'measure sasa', 'measure symmetry', 'measure volume', 'measure weight',
  'meeting close', 'meeting info', 'meeting join', 'meeting send', 'meeting server', 'meeting settings',
  'meeting start', 'meeting unname', 'modelcif pae', 'modeller comparative', 'modeller loops', 'modeller refine',
  'modeller scores', 'move cofr', 'mutationscores alphafold', 'mutationscores close', 'mutationscores color',
  'mutationscores define', 'mutationscores heatmap', 'mutationscores histogram', 'mutationscores label',
  'mutationscores list', 'mutationscores merge', 'mutationscores scatterplot', 'mutationscores statistics',
  'mutationscores structure', 'mutationscores umap', 'mutationscores undefine', 'name delete', 'name frozen',
  'name list', 'nucleotides style', 'nucleotides style delete', 'nucleotides style list', 'openfold install',
  'openfold ligandtable', 'openfold predict', 'openfold server fetch', 'openfold server list',
  'openfold server start', 'phenix barbedwire', 'phenix douse', 'phenix emplacelocal', 'phenix findreference',
  'phenix fitloops', 'phenix ligandfit', 'phenix location', 'registration file', 'registration status',
  'remotecontrol rest', 'remotecontrol xmlrpc', 'ribbon hide', 'rna model', 'rna path', 'scenes delete',
  'scenes list', 'scenes rename', 'scenes restore', 'scenes save', 'select zone', 'sequence search', 'shape boxpath',
  'shape cone', 'shape cylinder', 'shape ellipsoid', 'shape icosahedron', 'shape rectangle', 'shape ribbon',
  'shape sphere', 'shape triangle', 'shape tube', 'similarstructures blast', 'similarstructures close',
  'similarstructures cluster', 'similarstructures fetchcoords', 'similarstructures fromblast',
  'similarstructures ligands', 'similarstructures list', 'similarstructures open', 'similarstructures pairing',
  'similarstructures scrollto', 'similarstructures seqalign', 'similarstructures sequences',
  'similarstructures traces', 'speech alias', 'surface cap', 'surface check', 'surface close', 'surface dust',
  'surface hidefarblobs', 'surface hidepatches', 'surface invertshown', 'surface showall', 'surface showpatches',
  'surface splitbycolor', 'surface squaremesh', 'surface style', 'surface transform', 'surface undust',
  'surface unzone', 'surface zone', 'swapaa mousemode', 'ui functionkey', 'ui mousemode', 'ui view', 'usage open',
  'usage save', 'volume add', 'volume bin', 'volume boxes', 'volume copy', 'volume cover', 'volume erase',
  'volume falloff', 'volume flatten', 'volume flip', 'volume fourier', 'volume gaussian', 'volume laplacian',
  'volume localcorrelation', 'volume mask', 'volume maximum', 'volume median', 'volume minimum', 'volume morph',
  'volume multiply', 'volume new', 'volume octant', 'volume onesmask', 'volume permuteaxes', 'volume resample',
  'volume ridges', 'volume scale', 'volume sharpen', 'volume splitbyzone', 'volume subtract', 'volume threshold',
  'volume tile', 'volume unbend', 'volume unroll', 'volume unzone', 'volume zone', 'volume ~octant',
]

/**
 * The ChimeraX command word `word` names: itself, or the one word it is an
 * unambiguous prefix of (ChimeraX takes `vol` for `volume`). Null when it
 * names none, or more than one.
 */
export function chimeraxCommandWord(word: string): string | null {
  const w = word.toLowerCase()
  if (w === '') return null
  if (COMMAND_WORDS.includes(w)) return w
  const hits = COMMAND_WORDS.filter((c) => c.startsWith(w))
  return hits.length === 1 ? hits[0] : null
}

/** Whether `first second` is a ChimeraX command of two words or more (`alphafold match`). */
export function isChimeraxSubcommand(first: string, second: string): boolean {
  const name = `${first} ${second}`.toLowerCase()
  return MULTI_WORD_COMMANDS.some((c) => c === name || c.startsWith(`${name} `))
}
