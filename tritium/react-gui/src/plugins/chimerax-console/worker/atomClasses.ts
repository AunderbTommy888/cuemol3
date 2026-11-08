/**
 * @file plugins/chimerax-console/worker/atomClasses.ts
 * @description CueMol expressions for atom classes ChimeraX tells by
 * structure (metals, ions, hydrogens on carbon), approximated by element
 * and name. Shared by the auto style (`autoStyle.ts`) and the selectors
 * (`spec/selectors.ts`); no imports, so either can use it.
 */

/** Metal elements found in structures. */
const METALS = [
  'Li', 'Na', 'K', 'Rb', 'Cs', 'Be', 'Mg', 'Ca', 'Sr', 'Ba', 'Al', 'Ga', 'In', 'Tl', 'Sn', 'Pb', 'Bi',
  'Sc', 'Ti', 'V', 'Cr', 'Mn', 'Fe', 'Co', 'Ni', 'Cu', 'Zn', 'Y', 'Zr', 'Mo', 'Ru', 'Rh', 'Pd', 'Ag', 'Cd',
  'W', 'Re', 'Os', 'Ir', 'Pt', 'Au', 'Hg', 'La', 'Ce', 'Eu', 'Gd', 'Tb', 'Yb', 'Lu', 'U',
]

/** Metal atoms. */
export const METAL = `elem ${METALS.join(',')}`

/** Ions that are not metals (halides), as ligands. */
export const HALIDE_ION = 'ligand and elem F,Cl,Br,I'

/** Ligands, metals included, ions that are not metals left out (`ligand_like_atoms` with the metals). */
export const LIGAND = `ligand and not (${HALIDE_ION})`

/** Hydrogens on N, O or S in the standard residues, by name. */
const POLAR_H = [
  'name H,H1,H2,H3,HN',
  'resn ARG and name HE,HH11,HH12,HH21,HH22',
  'resn ASN and name HD21,HD22',
  'resn GLN and name HE21,HE22',
  'resn HIS and name HD1,HE2',
  'resn TRP and name HE1',
  'resn LYS and name HZ1,HZ2,HZ3',
  'resn SER,CYS and name HG',
  'resn THR and name HG1',
  'resn TYR and name HH',
].map((s) => `(${s})`).join(' or ')

/** Hydrogens on carbon in proteins (ChimeraX's IDATM type HC), told by name. */
export const NONPOLAR_H = `protein and hydrogen and not (${POLAR_H})`

/**
 * ChimeraX's `ions` (one-atom residues categorised as ions), approximated
 * as the metal and halide atoms of ligand residues (CueMol has no structure
 * category).
 */
export const IONS = `ligand and (${METAL} or elem F,Cl,Br,I)`
