/**
 * @file plugins/chimerax-console/worker/commands/mapCommands.ts
 * @description `volume` (how a density map is drawn), `volume zone` /
 * `volume unzone`, and ChimeraX's map operations, refused.
 *
 * A map is drawn by the renderers File > Open gave it (`contour` for a mesh,
 * `isosurf` for a surface); the console makes no `chx:` renderer for maps
 * and writes the settings onto those (`map/volumecommand.py`):
 *
 * - `level`: the renderer's `level`, in the map's own values as ChimeraX's;
 *   one level per renderer, so several are refused.
 * - `style mesh|surface`: `set_renderer_type` between `contour` and
 *   `isosurf` (it keeps the renderer's settings). `image` is refused.
 * - `step`: the renderer's `lod`. It thins an `isosurf`, and a `contour`
 *   only when it draws the whole map (`region_mode` full): over a box a
 *   contour is always drawn at step 1, so a larger step there is refused
 *   rather than written for nothing.
 * - `region all`: `region_mode` full. Grid index ranges are refused.
 * - `volume zone`: the renderer's molecule boundary (`bndry_molname`,
 *   `bndry_sel`, `bndry_rng`), which is one molecule's atoms. `unzone`
 *   empties the molecule name -- an empty selection would mean every atom
 *   of the molecule -- and draws the whole map again.
 */

import type { WorkerContext } from '@renderer/worker/server/types/WorkerContext'
import { objectNodes, rendererNodesOf } from '@renderer/worker/server/catalog/refs'
import { getGenericProps } from '@renderer/worker/server/services/props/read'
import { getSceneOrNull } from '@renderer/worker/server/services/helpers/sceneResolver'
import type { CmdContext, CmdOutcome } from '@plugins/console/worker/dialect-api'
import { BoolArg, ColorArg, EnumOf, FloatArg, NoArg, RestOfLine, SpecArg, StringArg } from '../cli/argTypes'
import { chxCommand } from '../cli/command'
import type { ChxCommand } from '../cli/command'
import { splitColorArg } from '../colors'
import { runOp, targetsOf } from '../display'
import type { NumberedObject } from '../models'
import { objectsOf } from './fileCommands'
import { unsupported, warnIgnored } from './warn'

/** The map renderer types `volume` acts on, and the style each draws. */
const MAP_STYLES: Readonly<Record<string, 'mesh' | 'surface'>> = { contour: 'mesh', gpu_mapmesh: 'mesh', isosurf: 'surface' }

/** The renderer type for a ChimeraX style. */
const STYLE_TYPES = { mesh: 'contour', surface: 'isosurf' } as const

/** The steps CueMol's `lod` has. */
const LOD_STEPS = ['1', '2', '4', '8']

/** One map renderer, with what `volume` reads of it. */
interface MapRend {
  id: number
  type: string
  /** The region it draws now (`box` or `full`). */
  region: string
}

/** A renderer property read as text. */
function propOf(ctx: WorkerContext, sceneId: number, rendId: number, key: string): string {
  const props = getGenericProps(ctx, { sceneId, nodeId: rendId, nodeType: 'renderer' })
  const v = props.ok ? props.entries.find((e) => e.key === key)?.value : undefined
  return v === null || v === undefined ? '' : String(v)
}

/** The map renderers of an object (none for a molecule). */
function mapRenderers(ctx: WorkerContext, sceneId: number, objUid: number): MapRend[] {
  const obj = objectNodes(ctx, sceneId).find((o) => o.id === objUid)
  if (!obj) return []
  const out: MapRend[] = []
  for (const n of rendererNodesOf(obj)) {
    if (n.type !== 'renderer') continue
    const type = propOf(ctx, sceneId, n.id, 'type_name')
    if (type in MAP_STYLES) out.push({ id: n.id, type, region: propOf(ctx, sceneId, n.id, 'region_mode_resolved') })
  }
  return out
}

/** The maps a specification names (every map for none), each with its renderers. */
function mapsOf(ctx: WorkerContext, sceneId: number, spec: string): { ok: true; maps: { obj: NumberedObject; rends: MapRend[] }[] } | { ok: false; error: string } {
  const found = objectsOf(ctx, sceneId, spec)
  if (!found.ok) return found
  const maps = found.objs.map((obj) => ({ obj, rends: mapRenderers(ctx, sceneId, obj.uid) })).filter((m) => m.rends.length > 0)
  if (maps.length === 0) return { ok: false, error: `Error: volume: no map${spec.trim() === '' ? '' : ` in "${spec}"`}` }
  return { ok: true, maps }
}

/** Set one renderer property. */
function setProp(ctx: WorkerContext, cc: CmdContext, rendId: number, prop: string, value: string) {
  return runOp(ctx, cc, 'set_node_prop', { nodeType: 'renderer', nodeId: rendId, prop, value })
}

/** ChimeraX's first map colour (`map/defaultsettings.py`, 0.7 grey). */
const XRAY_MAP_COLOR = '#b2b2b2'

/**
 * The line width of an X-ray map's mesh (pixels; CueMol's default is 1).
 * CueMol's mesh lines are unlit and uniform, so at 1 pixel the whole-map
 * mesh ChimeraX shows reads as a solid block; thinner lines keep it legible.
 * ChimeraX's lit, tube-like mesh is not copied.
 */
const XRAY_MESH_WIDTH = 0.5

/** The fraction of grid points ChimeraX's initial level encloses (`volume.py` `initial_surface_levels`). */
const XRAY_TOP_FRACTION = 0.01

/**
 * Draw a map just opened as ChimeraX draws an X-ray map it fetches
 * (`eds_fetch.py`: a mesh in the first map colour over the whole map, at the
 * level enclosing the top 1% of the grid points), instead of CueMol's
 * crystallographic default (a blue box about the view centre at 1 sigma).
 */
export async function applyXrayMapDefaults(ctx: WorkerContext, cc: CmdContext, obj: NumberedObject): Promise<CmdOutcome> {
  const map = getSceneOrNull(ctx, cc.sceneId)?.getObject(obj.uid) as unknown as { getLevelAtTopFraction?: (f: number) => number } | null
  let level: number | null = null
  try {
    const v = map?.getLevelAtTopFraction?.(XRAY_TOP_FRACTION)
    level = typeof v === 'number' && Number.isFinite(v) ? v : null
  } catch {
    level = null
  }
  for (const r of mapRenderers(ctx, cc.sceneId, obj.uid)) {
    const region = await setProp(ctx, cc, r.id, 'region_mode', 'full')
    if (!region.ok) return region
    if (MAP_STYLES[r.type] === 'mesh') {
      const width = await setProp(ctx, cc, r.id, 'width', String(XRAY_MESH_WIDTH))
      if (!width.ok) return width
    }
    if (level !== null) {
      const lv = await setProp(ctx, cc, r.id, 'level', String(level))
      if (!lv.ok) return lv
    }
    const colored = await runOp(ctx, cc, 'set_map_contour', { rendId: r.id, level: null, extent: null, color: XRAY_MAP_COLOR, alpha: null })
    if (!colored.ok) return colored
  }
  return { ok: true }
}

/** The keywords `volume` reads but does not act on. */
const VOLUME_IGNORED = ['subdivide', 'subdivisionLevels', 'smoothLines', 'squareMesh', 'capFaces', 'meshLighting', 'brightness', 'dimTransparency']

/**
 * The keywords `volume` does not do, with the reason. Each is display
 * settings of its own, so it is skipped with a warning and the rest of the
 * command (colour, step, level...) is applied.
 */
const VOLUME_REFUSED: Readonly<Record<string, string>> = {
  surfaceLevels: 'a CueMol map renderer draws one level; give level once',
  meshLevels: 'a CueMol map renderer draws one level; give level once',
  imageLevels: 'image style is not supported',
  sdLevel: 'give the level in the map\'s values (level)',
  rmsLevel: 'give the level in the map\'s values (level)',
  encloseVolume: 'a level from an enclosed volume is not supported',
  fastEncloseVolume: 'a level from an enclosed volume is not supported',
  showOutlineBox: 'CueMol does not draw a map\'s outline box',
}

/** `volume [spec] level / style / color / transparency / step / region / show / hide`. */
const volume = chxCommand({
  words: ['volume'],
  args: [
    { name: 'volumes', type: SpecArg, role: 'optional' },
    { name: 'level', type: FloatArg, role: 'keyword' },
    { name: 'style', type: EnumOf(['mesh', 'surface', 'image']), role: 'keyword' },
    { name: 'color', type: ColorArg, role: 'keyword' },
    { name: 'transparency', type: FloatArg, role: 'keyword' },
    { name: 'step', type: StringArg, role: 'keyword' },
    { name: 'region', type: StringArg, role: 'keyword' },
    { name: 'show', type: NoArg, role: 'keyword' },
    { name: 'hide', type: NoArg, role: 'keyword' },
    ...Object.keys(VOLUME_REFUSED).map((name) => ({ name, type: StringArg, role: 'keyword' as const })),
    ...VOLUME_IGNORED.map((name) => ({ name, type: StringArg, role: 'keyword' as const, ignored: true })),
  ],
  mutates: true,
  summary: 'Set how density maps are drawn: level, style mesh/surface, color, transparency, step, region all, show / hide.',
  async run(ctx, args, cc): Promise<CmdOutcome> {
    warnIgnored(cc, 'volume', args, VOLUME_IGNORED)
    for (const k of Object.keys(VOLUME_REFUSED)) {
      if (args[k] !== '' && !(k === 'showOutlineBox' && args[k] === 'false')) cc.warn(`volume: ${k} is not supported (${VOLUME_REFUSED[k]}); skipped`)
    }
    if (args.style === 'image') return unsupported('Error: volume: style image is not supported (CueMol draws a map as a mesh or a surface)')
    if (args.region !== '' && args.region !== 'all') {
      cc.warn('volume: a region other than all is not supported (CueMol draws a box about the centre or the whole map); skipped')
    }
    let step: string | null = null
    if (args.step !== '') {
      const parts = args.step.split(',')
      if (parts.some((p) => p !== parts[0]) || !LOD_STEPS.includes(parts[0])) {
        return { ok: false, error: 'Error: volume: step is 1, 2, 4 or 8, the same along every axis' }
      }
      step = parts[0]
    }
    if (args.transparency !== '' && !(Number(args.transparency) >= 0 && Number(args.transparency) <= 1)) {
      return { ok: false, error: 'Error: volume: transparency is 0 to 1' }
    }
    const color = args.color === '' ? null : splitColorArg(args.color)
    if (color && color.alpha !== null && color.alpha < 1) cc.warn('volume: transparency in a colour is not supported; give transparency')
    const found = mapsOf(ctx, cc.sceneId, args.volumes)
    if (!found.ok) return found
    // Checked over every renderer before anything is written.
    if (step !== null && step !== '1' && args.region !== 'all') {
      const boxed = found.maps.flatMap((m) => m.rends).find((r) => MAP_STYLES[r.type] === 'mesh' && args.style !== 'surface' && r.region !== 'full')
      if (boxed) {
        return { ok: false, error: 'Error: volume: a mesh over a box is always drawn at step 1 in CueMol; give region all (or style surface) to use a larger step' }
      }
    }
    for (const m of found.maps) {
      for (const r0 of m.rends) {
        let id = r0.id
        const style = args.style as '' | 'mesh' | 'surface'
        if (style !== '' && MAP_STYLES[r0.type] !== style) {
          const res = await runOp(ctx, cc, 'set_renderer_type', { rendId: id, rendererType: STYLE_TYPES[style] })
          if (!res.ok) return res
          id = (res.data as { rendererId: number }).rendererId
        }
        if (args.region === 'all') {
          const res = await setProp(ctx, cc, id, 'region_mode', 'full')
          if (!res.ok) return res
        }
        if (args.level !== '') {
          const res = await setProp(ctx, cc, id, 'level', args.level)
          if (!res.ok) return res
        }
        if (step !== null) {
          const res = await setProp(ctx, cc, id, 'lod', `step${step}`)
          if (!res.ok) return res
        }
        if (color || args.transparency !== '') {
          const res = await runOp(ctx, cc, 'set_map_contour', {
            rendId: id, level: null, extent: null,
            color: color ? color.hex : null,
            alpha: args.transparency === '' ? null : 1 - Number(args.transparency),
          })
          if (!res.ok) return res
        }
        if (args.show === 'true' || args.hide === 'true') {
          const res = await runOp(ctx, cc, 'set_visible', { nodeId: id, nodeType: 'renderer', visible: args.show === 'true' })
          if (!res.ok) return res
        }
      }
    }
    return { ok: true }
  },
})

/** `volume zone <maps> nearAtoms <atoms> [range r] [newMap false]`. */
const volumeZone = chxCommand({
  words: ['volume', 'zone'],
  args: [
    { name: 'volumes', type: SpecArg, role: 'required' },
    { name: 'nearAtoms', type: SpecArg, role: 'keyword' },
    { name: 'range', type: FloatArg, role: 'keyword', default: '3' },
    { name: 'newMap', type: BoolArg, role: 'keyword' },
    { name: 'invert', type: BoolArg, role: 'keyword' },
    { name: 'minimalBounds', type: StringArg, role: 'keyword', ignored: true },
  ],
  mutates: true,
  summary: 'Draw only the part of maps near some atoms (atoms of one model).',
  async run(ctx, args, cc): Promise<CmdOutcome> {
    warnIgnored(cc, 'volume zone', args, ['minimalBounds'])
    if (args.nearAtoms === '') return { ok: false, error: 'Error: volume zone: give nearAtoms' }
    if (args.newMap === 'true') return unsupported('Error: volume zone: newMap true is not supported (CueMol does not cut out a new map)')
    if (args.invert === 'true') return unsupported('Error: volume zone: invert is not supported')
    const near = targetsOf(ctx, cc.sceneId, args.nearAtoms)
    if (!near.ok) return near
    if (near.targets.length === 0) return { ok: false, error: 'Error: volume zone: no atoms specified' }
    if (near.targets.length > 1) {
      return { ok: false, error: 'Error: volume zone: the atoms must be in one model (a CueMol map boundary is one molecule\'s atoms)' }
    }
    const found = mapsOf(ctx, cc.sceneId, args.volumes)
    if (!found.ok) return found
    // The boundary names its molecule; C++ takes the molecule of that name,
    // passing over a map of the same name (`Scene::getObjectByNameAs`).
    const t = near.targets[0]
    for (const r of found.maps.flatMap((m) => m.rends)) {
      for (const [prop, value] of [['bndry_molname', t.obj.name], ['bndry_sel', t.sel], ['bndry_rng', args.range]] as const) {
        const res = await setProp(ctx, cc, r.id, prop, value)
        if (!res.ok) return res
      }
    }
    return { ok: true }
  },
})

/** `volume unzone [maps]`: the whole map again. */
const volumeUnzone = chxCommand({
  words: ['volume', 'unzone'],
  args: [{ name: 'volumes', type: SpecArg, role: 'optional' }],
  mutates: true,
  summary: 'Draw the whole of maps again after volume zone.',
  async run(ctx, args, cc): Promise<CmdOutcome> {
    const found = mapsOf(ctx, cc.sceneId, args.volumes)
    if (!found.ok) return found
    for (const r of found.maps.flatMap((m) => m.rends)) {
      // The boundary is off only with no molecule name (an empty selection is every atom).
      for (const [prop, value] of [['bndry_molname', ''], ['region_mode', 'full']] as const) {
        const res = await setProp(ctx, cc, r.id, prop, value)
        if (!res.ok) return res
      }
    }
    return { ok: true }
  },
})

/** ChimeraX's map operations (`map_filter`), which make new maps: refused. */
const MAP_OPERATIONS = [
  'add', 'subtract', 'multiply', 'scale', 'gaussian', 'laplacian', 'median', 'sharpen', 'bin', 'box', 'cover',
  'flatten', 'flip', 'zflip', 'fourier', 'maximum', 'minimum', 'morph', 'new', 'octant', 'permute', 'resample',
  'threshold', 'tile', 'unbend', 'copy', 'mask', 'onesmask', 'falloff', 'splitbyzone',
]

function refusedOperation(op: string): ChxCommand {
  return chxCommand({
    words: ['volume', op],
    args: [{ name: 'rest', type: RestOfLine, role: 'optional' }],
    mutates: false,
    summary: `Not supported: makes a new map (${op}).`,
    run: () => unsupported(`Error: volume ${op} is not supported (map operations that make a new map are not available)`),
  })
}

export const MAP_COMMANDS: Record<string, ChxCommand> = {
  volume,
  volumeZone,
  volumeUnzone,
  ...Object.fromEntries(MAP_OPERATIONS.map((op) => [`volume_${op}`, refusedOperation(op)])),
}

/** The map operation commands, in registration order. */
export const MAP_OPERATION_COMMANDS: readonly ChxCommand[] = MAP_OPERATIONS.map((op) => MAP_COMMANDS[`volume_${op}`])
