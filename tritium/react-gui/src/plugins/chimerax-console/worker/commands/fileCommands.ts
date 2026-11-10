/**
 * @file plugins/chimerax-console/worker/commands/fileCommands.ts
 * @description `open`, `close` and `delete`.
 *
 * `open` reads a file, a `.cxc` script, or fetches an entry from a database:
 * a bare PDB id (mmCIF from the RCSB, as ChimeraX does), `db:id` (`pdbe:`,
 * `pdbj:`, `redo:`, `alphafold:`, `pubchem:`, `emdb:`), `id fromDatabase db`,
 * or an http(s) URL (`openTarget.ts`). A molecule opens with the console's
 * renderers, styled as ChimeraX's automatic styling would style it
 * (`autoStyle.ts`); an AlphaFold model is then coloured by pLDDT, as
 * ChimeraX colours it. Anything else (a map) opens as File > Open would.
 * The first models of an empty scene set the camera as ChimeraX's first
 * models do (`initialView`); later opens leave it where it is.
 *
 * `save` writes an image (`.png`), the scene (`.qsc`, CueMol's session) or
 * one molecule (`.pdb`). A ChimeraX session (`.cxs`) cannot be written.
 */

import * as fs from 'fs'
import type { WorkerContext } from '@renderer/worker/server/types/WorkerContext'
// Read only: which renderers a file's reader can feed, to tell a molecule.
import { getCompatibleRendererNames } from '@renderer/worker/server/services/file/getCompatibleRendererNames'
import type { CmdContext, CmdOutcome } from '@plugins/console/worker/dialect-api'
import { resolvePath } from '@plugins/console/worker/dialect-api'
import { BoolArg, FileNameArg, FileNamesArg, IntArg, SpecArg, splitRepeated, StringArg } from '../cli/argTypes'
import { chxCommand } from '../cli/command'
import type { ChxCommand } from '../cli/command'
import { CARTOONS, displayedAtoms, emitContext, intersect, runOp, targetsOf } from '../display'
import { isMolecule, numberedObjects } from '../models'
import type { NumberedObject } from '../models'
import { emitFor, NONE } from '../spec/emit'
import { parseSpec, SpecError } from '../spec/parse'
import { isSelector, withSceneSelectors } from '../spec/selectors'
import { readCamera } from '../camera'
import { applyAutoStyle } from '../autoStyle'
import { openTarget } from '../openTarget'
import { assemblyFetch } from '@renderer/worker/shared/dbSources'
import { colorByPlddt } from './colorCommands'
import { applyXrayMapDefaults } from './mapCommands'
import { inheritSilhouettes } from './viewCommands'
import { unsupported, warnIgnored } from './warn'

/** The ribbon renderer a molecule is opened with, by the load itself. */
const OPEN_CARTOON = { rendererType: 'ribbon', rendererName: CARTOONS[0].name, selection: CARTOONS[0].scope ?? 'protein' }

/**
 * Style each newly opened molecule as ChimeraX would (`autoStyle.ts`), and say its number.
 *
 * @param plddt - colour the molecules by pLDDT after styling (an AlphaFold model)
 */
async function adopt(ctx: WorkerContext, cc: CmdContext, before: Set<number>, plddt = false): Promise<CmdOutcome> {
  const added = numberedObjects(ctx, cc.sceneId).filter((o) => !before.has(o.uid))
  for (const obj of added) {
    cc.print(`Opened ${obj.name} as #${obj.model}`)
    if (!isMolecule(obj)) continue
    const styled = await applyAutoStyle(ctx, cc, obj)
    if (!styled.ok) return styled
    if (plddt) {
      const colored = await colorByPlddt(ctx, cc, obj)
      if (!colored.ok) return colored
    }
  }
  if (added.length === 0) return { ok: true }
  // The view's silhouettes reach the new models' renderers too.
  const addedUids = new Set(added.map((o) => o.uid))
  const outlined = await inheritSilhouettes(ctx, cc, (r) => addedUids.has(r.objUid))
  if (!outlined.ok) return outlined
  if (before.size > 0) return { ok: true }
  return initialView(ctx, cc, added)
}

/**
 * The first models of an empty scene are viewed as ChimeraX views them
 * (`models.py` `add` -> `View.initial_camera_view`): the camera turned back
 * to look down -z, then fitted to them as the scene pane's Focus button fits
 * (`focus_nodes`: a molecule's displayed atoms, a map's data block). Later
 * opens leave the camera where it is, so the console opens with
 * `centerView: false`.
 */
async function initialView(ctx: WorkerContext, cc: CmdContext, objs: readonly NumberedObject[]): Promise<CmdOutcome> {
  // Every argument of set_view is given: one left out reaches the op as undefined, not null.
  const turned = await runOp(ctx, cc, 'set_view', {
    zoom: null, slab: null, distance: null, center: null, rotation: [1, 0, 0, 0], fitSlab: null, objId: null,
  })
  if (!turned.ok) return turned
  const fitted = await runOp(ctx, cc, 'focus_nodes', { nodeIds: objs.map((o) => o.uid) })
  return fitted.ok ? { ok: true } : fitted
}

/** Open one name (`openTarget.ts` says what it is). */
async function openOne(ctx: WorkerContext, cc: CmdContext, name: string, args: Record<string, string>): Promise<CmdOutcome> {
  const objectName = args.name === '' ? null : args.name
  const before = new Set(numberedObjects(ctx, cc.sceneId).map((o) => o.uid))
  const target = openTarget(name, args.fromDatabase, args.format, (n) => fs.existsSync(resolvePath(cc.cwd, n)))
  if ((args.maxAssemblies ?? '') !== '' && target.kind !== 'assemblies') cc.warn('open: maxAssemblies is used with rcsb_bio and pdbe_bio only; ignored')
  switch (target.kind) {
    case 'error':
      return target.unsupported ? unsupported(target.error) : { ok: false, error: target.error }
    case 'entry': {
      const res = await runOp(ctx, cc, 'fetch_entry', {
        source: target.source, id: target.id, format: target.format, ...OPEN_CARTOON, name: objectName, preset: null, centerView: false,
      })
      if (!res.ok) return res
      return adopt(ctx, cc, before, target.source === 'alphafold')
    }
    case 'url': {
      if (args.format !== '') cc.warn('open: format is not used for a URL (its extension says it)')
      const res = await runOp(ctx, cc, 'fetch_url', {
        url: target.spec.url, reader: target.spec.readerName, name: objectName ?? target.spec.name,
        gzip: target.spec.gzip ? true : null, ...OPEN_CARTOON, preset: null, centerView: false,
      })
      if (!res.ok) return res
      return adopt(ctx, cc, before)
    }
    case 'mapUrl': {
      if (args.format !== '') cc.warn('open: format is not used for a URL (its extension says it)')
      const res = await runOp(ctx, cc, 'fetch_map_url', { url: target.spec.url, name: objectName ?? target.name ?? null, gzip: null })
      if (!res.ok) return res
      if (target.xrayDefaults) {
        for (const obj of numberedObjects(ctx, cc.sceneId).filter((o) => !before.has(o.uid))) {
          const styled = await applyXrayMapDefaults(ctx, cc, obj)
          if (!styled.ok) return styled
        }
      }
      return adopt(ctx, cc, before)
    }
    case 'assemblies':
      return openAssemblies(ctx, cc, target.site, target.id, args, before)
    case 'emdb': {
      if (args.format !== '') cc.warn('open: format is not used for an EMDB map')
      const res = await runOp(ctx, cc, 'fetch_emdb', { id: target.id, name: objectName, source: target.mirror, level: null })
      if (!res.ok) return res
      return adopt(ctx, cc, before)
    }
  }
  warnIgnored(cc, 'open', args, ['format'])
  if (/\.cxc$/i.test(name)) return cc.runScript(name)
  const path = resolvePath(cc.cwd, name)
  if (/\.qsc$/i.test(path)) {
    return runOp(ctx, cc, 'load_file', {
      path, rendererType: null, selection: null, name: null, rendererName: null, preset: null, centerView: null, mapCenterPolicy: null,
    })
  }
  const molecule = getCompatibleRendererNames(ctx, { filePath: path }).types.includes('ribbon')
  const res = await runOp(ctx, cc, 'load_file', {
    path,
    ...(molecule ? OPEN_CARTOON : { rendererType: null, selection: null, rendererName: null }),
    name: objectName, preset: null, centerView: false, mapCenterPolicy: null,
  })
  if (!res.ok) return res
  return adopt(ctx, cc, before)
}

/**
 * The biological assemblies of an entry, 1, 2, ... until one is missing or
 * `maxAssemblies` is reached, each a model (ChimeraX `fetch_pdb_bio.py`).
 * The first missing is an error; a later one ends the list.
 */
async function openAssemblies(
  ctx: WorkerContext, cc: CmdContext, site: 'rcsb' | 'pdbe', id: string, args: Record<string, string>, before: Set<number>,
): Promise<CmdOutcome> {
  if (args.format !== '') cc.warn('open: format is not used for assemblies (mmCIF)')
  const max = (args.maxAssemblies ?? '') === '' ? Infinity : Number(args.maxAssemblies)
  for (let n = 1; n <= max; n++) {
    const spec = assemblyFetch(site, id, n)
    if (!spec) return { ok: false, error: `Error: open: "${id}" is not a PDB id` }
    const res = await runOp(ctx, cc, 'fetch_url', {
      url: spec.url, reader: spec.readerName, name: args.name !== '' && n === 1 ? args.name : spec.name,
      gzip: spec.gzip ? true : null, ...OPEN_CARTOON, preset: null, centerView: false,
    })
    if (!res.ok) {
      if (n === 1) return { ok: false, error: `Error: open: no biological assembly of ${id} could be fetched (${res.error.replace(/^Error: /, '')})` }
      break
    }
  }
  return adopt(ctx, cc, before)
}

const open = chxCommand({
  words: ['open'],
  args: [
    { name: 'names', type: FileNamesArg, role: 'required' },
    { name: 'name', type: StringArg, role: 'keyword' },
    { name: 'format', type: StringArg, role: 'keyword' },
    { name: 'fromDatabase', type: StringArg, role: 'keyword' },
    { name: 'maxAssemblies', type: IntArg, role: 'keyword' },
  ],
  mutates: true,
  summary: 'Open files, .cxc scripts, or fetch entries: PDB ids, db:id (pdbe, pdbj, redo, alphafold, pubchem, emdb, eds), or URLs.',
  completions: [{ source: 'files', description: 'file', files: 'openable' }],
  // A scene file replaces the scene: it cannot run inside the submission's transaction.
  outsideTxn: (args) => /\.qsc$/i.test(args.names ?? ''),
  async run(ctx, args, cc) {
    // Each name in turn (ChimeraX opens them in order); the first failure stops the rest.
    const names = splitRepeated(args.names)
    if (names.length > 1) {
      if (args.name !== '') return { ok: false, error: 'Error: open: name can be given for one file only' }
      if (names.some((n) => /\.qsc$/i.test(n))) return { ok: false, error: 'Error: open: a scene (.qsc) is opened on its own' }
    }
    for (const n of names) {
      const res = await openOne(ctx, cc, n, args)
      if (!res.ok) return res
    }
    return { ok: true }
  },
})

/**
 * The UniProt accession of a UniProt entry name (`O51E2_HUMAN` -> `Q9H255`),
 * from the UniProt REST search, as ChimeraX looks a name up
 * (`uniprot/fetch_uniprot.py` `map_uniprot_ident`).
 */
async function uniprotAccession(name: string): Promise<{ ok: true; accession: string } | { ok: false; error: string }> {
  const url = `https://rest.uniprot.org/uniprotkb/search?query=id:${encodeURIComponent(name)}&fields=accession&format=tsv`
  try {
    const resp = await fetch(url)
    if (!resp.ok) return { ok: false, error: `Error: alphafold fetch: could not look up "${name}" at UniProt (HTTP ${resp.status})` }
    // A header line ("Entry"), then one accession per line.
    const accession = (await resp.text()).split(/\r?\n/).slice(1).map((l) => l.trim()).find((l) => l !== '')
    return accession ? { ok: true, accession } : { ok: false, error: `Error: alphafold fetch: UniProt has no entry named "${name}"` }
  } catch (e) {
    return { ok: false, error: `Error: alphafold fetch: could not look up "${name}" at UniProt (${e instanceof Error ? e.message : String(e)})` }
  }
}

/**
 * `alphafold fetch <UniProt>`: the AlphaFold DB model, as `open
 * alphafold:<UniProt>` opens it (coloured by pLDDT). A UniProt entry name
 * (`NOS3_HUMAN`) is looked up to its accession first, and names the model.
 */
const alphafoldFetch = chxCommand({
  words: ['alphafold', 'fetch'],
  args: [
    { name: 'uniprotId', type: StringArg, role: 'required' },
    { name: 'pae', type: BoolArg, role: 'keyword' },
    ...['alignTo', 'trim', 'ignoreCache', 'version'].map((name) => ({ name, type: StringArg, role: 'keyword' as const, ignored: true })),
  ],
  mutates: true,
  summary: 'Fetch an AlphaFold DB model by UniProt accession or entry name, coloured by pLDDT.',
  async run(ctx, args, cc) {
    warnIgnored(cc, 'alphafold fetch', args, ['alignTo', 'trim', 'ignoreCache', 'version'])
    if (args.pae === 'true') cc.warn('alphafold fetch: pae is not supported (predicted aligned error); ignored')
    if (!args.uniprotId.includes('_')) return openOne(ctx, cc, `alphafold:${args.uniprotId}`, { name: '', format: '', fromDatabase: '' })
    const looked = await uniprotAccession(args.uniprotId)
    if (!looked.ok) return looked
    return openOne(ctx, cc, `alphafold:${looked.accession}`, { name: `AlphaFold ${args.uniprotId}`, format: '', fromDatabase: '' })
  },
})

/** The objects a model specification names (every object for none). */
export function objectsOf(ctx: WorkerContext, sceneId: number, spec: string): { ok: true; objs: NumberedObject[] } | { ok: false; error: string; unsupported?: true } {
  const all = numberedObjects(ctx, sceneId)
  if (spec.trim() === '') return { ok: true, objs: all }
  try {
    const ec = emitContext(ctx, sceneId)
    const read = withSceneSelectors(ec.namedSelections, () => parseSpec(spec, isSelector))
    if (!read) return { ok: false, error: `Error: "${spec}" is not a model specification` }
    return { ok: true, objs: all.filter((o) => emitFor(read.node, o.model, ec) !== NONE) }
  } catch (e) {
    if (e instanceof SpecError) return { ok: false, error: `${spec}\n${' '.repeat(e.pos)}^ ${e.message}`, ...(e.unsupported ? { unsupported: true as const } : {}) }
    throw e
  }
}

const close = chxCommand({
  words: ['close'],
  args: [{ name: 'models', type: SpecArg, role: 'optional' }],
  mutates: true,
  summary: 'Close models (all of them when none are named).',
  async run(ctx, args, cc) {
    const found = objectsOf(ctx, cc.sceneId, args.models)
    if (!found.ok) return found
    for (const o of found.objs) {
      const res = await runOp(ctx, cc, 'delete_node', { nodeId: o.uid, nodeType: 'object' })
      if (!res.ok) return res
    }
    return { ok: true }
  },
})

/**
 * `close session`: every object closed. ChimeraX also resets its settings
 * here; CueMol keeps no settings per session, so they stay as they are.
 */
const closeSession = chxCommand({
  words: ['close', 'session'],
  args: [],
  mutates: true,
  summary: 'Close every model (the settings are kept: CueMol has none per session).',
  async run(ctx, _args, cc) {
    for (const o of numberedObjects(ctx, cc.sceneId)) {
      const res = await runOp(ctx, cc, 'delete_node', { nodeId: o.uid, nodeType: 'object' })
      if (!res.ok) return res
    }
    return { ok: true }
  },
})

const deleteAtoms = chxCommand({
  words: ['delete'],
  args: [
    { name: 'atoms', type: SpecArg, role: 'required' },
    { name: 'attachedHyds', type: StringArg, role: 'keyword', ignored: true },
  ],
  mutates: true,
  summary: 'Delete atoms.',
  async run(ctx, args, cc) {
    warnIgnored(cc, 'delete', args, ['attachedHyds'])
    const found = targetsOf(ctx, cc.sceneId, args.atoms)
    if (!found.ok) return found
    for (const t of found.targets) {
      const res = await runOp(ctx, cc, 'delete_atoms', { objId: t.obj.uid, selection: t.sel })
      if (!res.ok) return res
    }
    return { ok: true }
  },
})

const SAVE_IGNORED = ['pixelSize', 'quality']
const SAVE_REFUSED = ['relModel', 'allCoordsets']

const save = chxCommand({
  words: ['save'],
  args: [
    { name: 'filename', type: FileNameArg, role: 'required' },
    { name: 'format', type: StringArg, role: 'keyword' },
    { name: 'models', type: SpecArg, role: 'keyword' },
    { name: 'width', type: IntArg, role: 'keyword' },
    { name: 'height', type: IntArg, role: 'keyword' },
    { name: 'transparentBackground', type: BoolArg, role: 'keyword' },
    { name: 'supersample', type: IntArg, role: 'keyword' },
    { name: 'selectedOnly', type: BoolArg, role: 'keyword' },
    { name: 'displayedOnly', type: BoolArg, role: 'keyword' },
    ...SAVE_IGNORED.map((name) => ({ name, type: StringArg, role: 'keyword' as const, ignored: true })),
    ...SAVE_REFUSED.map((name) => ({ name, type: StringArg, role: 'keyword' as const })),
  ],
  mutates: false,
  summary: 'Save an image (.png), the scene (.qsc), a model (.pdb) or the shapes (.stl).',
  completions: [{ source: 'files', description: 'file' }],
  // Saving the scene resets the undo stack: it cannot run inside the submission's transaction.
  outsideTxn: (args) => /\.qsc$/i.test(args.filename ?? '') || /^(qsc|session)$/i.test(args.format ?? ''),
  async run(ctx, args, cc) {
    warnIgnored(cc, 'save', args, SAVE_IGNORED)
    // CueMol's image export always antialiases by jitter supersampling (OffScreenView: 32 samples),
    // more than ChimeraX's usual supersample 3; only asking for none differs.
    if (args.supersample !== '' && Number(args.supersample) <= 1) cc.warn('save: supersample 1 is not supported (CueMol always antialiases the exported image); ignored')
    const refused = SAVE_REFUSED.find((k) => args[k] !== '')
    if (refused) return unsupported(`Error: save: ${refused} is not supported`)
    const path = resolvePath(cc.cwd, args.filename)
    const ext = (args.format !== '' ? args.format : path.match(/\.([^./\\]+)$/)?.[1] ?? '').toLowerCase()
    if (ext === 'cxs' || ext === 'session') {
      return { ok: false, error: 'Error: save: a ChimeraX session (.cxs) cannot be written; save the scene as .qsc' }
    }
    if (ext === 'png') {
      const size = imageSize(ctx, cc, args.width, args.height)
      return runOp(ctx, cc, 'export_scene', {
        path, format: 'png', width: size.width, height: size.height,
        transparent: args.transparentBackground === '' ? null : args.transparentBackground === 'true', dpi: null,
      })
    }
    if (ext === 'qsc') return runOp(ctx, cc, 'save_scene', { path })
    if (ext === 'stl') return runOp(ctx, cc, 'export_scene', { path, format: 'stl', width: null, height: null, transparent: null, dpi: null })
    if (ext === 'pdb') {
      const found = objectsOf(ctx, cc.sceneId, args.models)
      if (!found.ok) return found
      const mols = found.objs.filter(isMolecule)
      if (mols.length !== 1) return { ok: false, error: `Error: save: a .pdb file holds one model here; name it with models (${mols.length} given)` }
      // selectedOnly / displayedOnly: the selected atoms, the displayed ones (`displayedAtoms`), or both.
      let selection: string | null = null
      if (args.selectedOnly === 'true') selection = emitContext(ctx, cc.sceneId).currentSelection(mols[0].model)
      if (args.displayedOnly === 'true') {
        const shown = displayedAtoms(ctx, cc.sceneId, mols[0].uid)
        selection = selection === null ? shown : intersect(selection, shown)
      }
      if (selection === NONE) return { ok: false, error: 'Error: save: no atoms to save' }
      return runOp(ctx, cc, 'save_object', { objId: mols[0].uid, fileName: path, selection, format: null, link: false })
    }
    return unsupported(`Error: save: "${ext}" files are not supported (png, qsc, pdb, stl)`)
  },
})

/**
 * The image size: the view's when neither is given, the other side in the
 * view's aspect ratio when one is (ChimeraX's rule).
 */
function imageSize(ctx: WorkerContext, cc: CmdContext, width: string, height: string): { width: number | null; height: number | null } {
  if (width !== '' && height !== '') return { width: Number(width), height: Number(height) }
  if (width === '' && height === '') return { width: null, height: null }
  const view = readCamera(ctx, cc.viewId)
  if (!view) return { width: width === '' ? null : Number(width), height: height === '' ? null : Number(height) }
  return width !== ''
    ? { width: Number(width), height: Math.round((Number(width) * view.height) / view.width) }
    : { width: Math.round((Number(height) * view.width) / view.height), height: Number(height) }
}

export const FILE_COMMANDS: Record<string, ChxCommand> = { open, close, closeSession, delete: deleteAtoms, save, alphafoldFetch }
