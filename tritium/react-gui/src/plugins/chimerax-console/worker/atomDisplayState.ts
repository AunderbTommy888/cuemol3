/**
 * @file plugins/chimerax-console/worker/atomDisplayState.ts
 * @description ChimeraX's per-atom display flag and draw mode, kept by the
 * console for each molecule (pure: reads and writes nothing in CueMol).
 *
 * The state is a sorted array of atom ids with one code per atom (shown or
 * not, and the style). It is encoded as the atom id ranges of each of the six
 * (shown or hidden) x (stick, ball, sphere) sets, the form the console keeps
 * for undo (`display.ts`). Ids of atoms deleted since are kept (an undo of the
 * deletion brings the same ids back) but are never drawn: everything drawn
 * or compared goes through `shownIds` with the ids there are now.
 */

/** ChimeraX's atom draw modes the console draws (stick, ball, sphere). */
export type AtomStyle = 'stick' | 'ball' | 'sphere'

/** The styles, in code order. */
export const STYLE_KEYS: readonly AtomStyle[] = ['stick', 'ball', 'sphere']

const SHOWN = 4

/** The code of an atom: its style's index, plus 4 when shown. */
export function codeOf(style: AtomStyle, shown: boolean): number {
  return STYLE_KEYS.indexOf(style) | (shown ? SHOWN : 0)
}

/** Whether a code is shown. */
export function isShown(code: number): boolean {
  return (code & SHOWN) !== 0
}

/** The style of a code. */
export function styleOf(code: number): AtomStyle {
  return STYLE_KEYS[code & 3]
}

/** One molecule's atom states: `ids` ascending, `code[i]` for `ids[i]`. */
export interface DisplayState {
  ids: Int32Array
  code: Uint8Array
}

/** Ascending ids as ranges, `1:3,5` (empty for none). */
export function rangesOf(ids: ArrayLike<number>): string {
  const out: string[] = []
  for (let i = 0; i < ids.length; ) {
    let j = i
    while (j + 1 < ids.length && ids[j + 1] === ids[j] + 1) j++
    out.push(i === j ? String(ids[i]) : `${ids[i]}:${ids[j]}`)
    i = j + 1
  }
  return out.join(',')
}

/** The ids of ranges `1:3,5`. */
export function parseRanges(s: string): number[] {
  const out: number[] = []
  for (const part of s.split(',')) {
    if (part.trim() === '') continue
    const [a, b] = part.split(':').map(Number)
    for (let k = a; k <= (b ?? a); k++) out.push(k)
  }
  return out
}

/** The state of the atoms `ids` (ascending) with codes from `codeAt(id)`. */
export function stateOf(ids: Int32Array, codeAt: (id: number) => number): DisplayState {
  const code = new Uint8Array(ids.length)
  for (let i = 0; i < ids.length; i++) code[i] = codeAt(ids[i])
  return { ids, code }
}

interface Encoded {
  v: 1
  shown: Record<AtomStyle, string>
  hidden: Record<AtomStyle, string>
}

/** The state as the console keeps it (six id range sets, JSON). */
export function encode(s: DisplayState): string {
  const set = (shown: boolean): Record<AtomStyle, string> => {
    const r = {} as Record<AtomStyle, string>
    for (const style of STYLE_KEYS) {
      const want = codeOf(style, shown)
      r[style] = rangesOf(s.ids.filter((_, i) => s.code[i] === want))
    }
    return r
  }
  const e: Encoded = { v: 1, shown: set(true), hidden: set(false) }
  return JSON.stringify(e)
}

/** The state `encode` wrote; null for anything else. */
export function decode(text: string): DisplayState | null {
  let e: Encoded
  try {
    e = JSON.parse(text) as Encoded
  } catch {
    return null
  }
  if (e?.v !== 1 || !e.shown || !e.hidden) return null
  const pairs: [number, number][] = []
  for (const shown of [true, false]) {
    for (const style of STYLE_KEYS) {
      for (const id of parseRanges((shown ? e.shown : e.hidden)[style] ?? '')) pairs.push([id, codeOf(style, shown)])
    }
  }
  pairs.sort((a, b) => a[0] - b[0])
  return { ids: Int32Array.from(pairs, (p) => p[0]), code: Uint8Array.from(pairs, (p) => p[1]) }
}

/**
 * `s` with the atoms of `present` it does not know added, coded by `fill`.
 * Known ids keep their code, gone ones included.
 */
export function withAtoms(s: DisplayState, present: Int32Array, fill: (id: number) => number): DisplayState {
  const ids: number[] = []
  const code: number[] = []
  let i = 0
  let j = 0
  while (i < s.ids.length || j < present.length) {
    if (j >= present.length || (i < s.ids.length && s.ids[i] < present[j])) {
      ids.push(s.ids[i])
      code.push(s.code[i++])
    } else if (i >= s.ids.length || present[j] < s.ids[i]) {
      ids.push(present[j])
      code.push(fill(present[j++]))
    } else {
      ids.push(s.ids[i])
      code.push(s.code[i++])
      j++
    }
  }
  return { ids: Int32Array.from(ids), code: Uint8Array.from(code) }
}

/** A copy of `s` with `f(code, inTarget)` applied to every atom (`target` ascending). */
function mapCodes(s: DisplayState, target: Int32Array, f: (code: number, inTarget: boolean) => number): DisplayState {
  const code = new Uint8Array(s.code.length)
  let j = 0
  for (let i = 0; i < s.ids.length; i++) {
    while (j < target.length && target[j] < s.ids[i]) j++
    code[i] = f(s.code[i], j < target.length && target[j] === s.ids[i])
  }
  return { ids: s.ids, code }
}

/** `show S atoms`: the atoms of `target` shown, in their own style. */
export function show(s: DisplayState, target: Int32Array): DisplayState {
  return mapCodes(s, target, (c, t) => (t ? c | SHOWN : c))
}

/** `hide S atoms`: the atoms of `target` hidden; each keeps its style. */
export function hide(s: DisplayState, target: Int32Array): DisplayState {
  return mapCodes(s, target, (c, t) => (t ? c & ~SHOWN : c))
}

/** `show S atoms only`: in this molecule, the atoms of `target` shown and every other one hidden. */
export function showOnly(s: DisplayState, target: Int32Array): DisplayState {
  return mapCodes(s, target, (c, t) => (t ? c | SHOWN : c & ~SHOWN))
}

/**
 * `style S X`: the atoms of `target` get style `to`, shown or not.
 *
 * @param from - only atoms of this style change (`nospheres`: spheres only)
 */
export function restyle(s: DisplayState, target: Int32Array, to: AtomStyle, from?: AtomStyle): DisplayState {
  return mapCodes(s, target, (c, t) => (t && (from === undefined || styleOf(c) === from) ? codeOf(to, isShown(c)) : c))
}

/** Whether two states hold the same atoms with the same codes. */
export function sameState(a: DisplayState, b: DisplayState): boolean {
  if (a.ids.length !== b.ids.length) return false
  for (let i = 0; i < a.ids.length; i++) if (a.ids[i] !== b.ids[i] || a.code[i] !== b.code[i]) return false
  return true
}

/** The shown atoms of each style, among the ids `present` (ascending) there are now. */
export function shownIds(s: DisplayState, present: Int32Array): Record<AtomStyle, Int32Array> {
  const out: Record<AtomStyle, number[]> = { stick: [], ball: [], sphere: [] }
  let j = 0
  for (let i = 0; i < s.ids.length; i++) {
    while (j < present.length && present[j] < s.ids[i]) j++
    if (j >= present.length || present[j] !== s.ids[i] || !isShown(s.code[i])) continue
    out[styleOf(s.code[i])].push(s.ids[i])
  }
  return { stick: Int32Array.from(out.stick), ball: Int32Array.from(out.ball), sphere: Int32Array.from(out.sphere) }
}

/** Whether two ascending id arrays are the same. */
export function sameIds(a: Int32Array, b: Int32Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}
