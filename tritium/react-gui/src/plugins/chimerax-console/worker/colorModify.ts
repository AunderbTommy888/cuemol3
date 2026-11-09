/**
 * @file plugins/chimerax-console/worker/colorModify.ts
 * @description The colour changes of ChimeraX's `color modify`
 * (`std_commands/color.py` `_change_hue` ... `_change_component`), on one
 * colour: hue, saturation and lightness in HLS (as Python's `colorsys`),
 * whiteness and blackness in HWB (CSS Color 4), red / green / blue on the
 * component. Each result is rounded to 0-255 per component (ChimeraX works
 * in float32, so a component near a half may differ by 1).
 */

/** What `color modify` changes. `contrast` is not done (not supported yet). */
export type Adjuster = 'hue' | 'saturation' | 'lightness' | 'whiteness' | 'blackness' | 'red' | 'green' | 'blue'

/** How: add (`+`, `-` with the amount negated), multiply (`*`) or set (no operator). */
export type ModifyOp = 'add' | 'mul' | 'set'

type Rgb = [number, number, number]

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x))

/** RGB (0-1) to HLS, as `colorsys.rgb_to_hls`. */
function rgbToHls([r, g, b]: Rgb): [number, number, number] {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (min + max) / 2
  if (min === max) return [0, l, 0]
  const d = max - min
  const s = l <= 0.5 ? d / (max + min) : d / (2 - max - min)
  const rc = (max - r) / d
  const gc = (max - g) / d
  const bc = (max - b) / d
  let h = r === max ? bc - gc : g === max ? 2 + rc - bc : 4 + gc - rc
  h = ((h / 6) % 1 + 1) % 1
  return [h, l, s]
}

function hlsValue(m1: number, m2: number, hue: number): number {
  const h = ((hue % 1) + 1) % 1
  if (h < 1 / 6) return m1 + (m2 - m1) * h * 6
  if (h < 0.5) return m2
  if (h < 2 / 3) return m1 + (m2 - m1) * (2 / 3 - h) * 6
  return m1
}

/** HLS to RGB (0-1), as `colorsys.hls_to_rgb`. */
function hlsToRgb([h, l, s]: [number, number, number]): Rgb {
  if (s === 0) return [l, l, l]
  const m2 = l <= 0.5 ? l * (1 + s) : l + s - l * s
  const m1 = 2 * l - m2
  return [hlsValue(m1, m2, h + 1 / 3), hlsValue(m1, m2, h), hlsValue(m1, m2, h - 1 / 3)]
}

/** RGB (0-1) to HWB, the hue from HLS (ChimeraX `rgb_to_hwb`). */
function rgbToHwb(rgb: Rgb): [number, number, number] {
  return [rgbToHls(rgb)[0], Math.min(...rgb), 1 - Math.max(...rgb)]
}

/** HWB to RGB (0-1), whiteness + blackness over 1 scaled down first (CSS Color 4; ChimeraX `hwb_to_rgb`). */
function hwbToRgb([h, w0, b0]: [number, number, number]): Rgb {
  const sum = w0 + b0
  const [w, b] = sum > 1 ? [w0 / sum, b0 / sum] : [w0, b0]
  const pure = hlsToRgb([h, 0.5, 1])
  return pure.map((c) => c * (1 - w - b) + w) as Rgb
}

/** Apply one change to a value in 0-1. */
function change(x: number, amount: number, op: ModifyOp): number {
  return clamp01(op === 'add' ? x + amount : op === 'mul' ? x * amount : amount)
}

/**
 * One colour (`#rrggbb`) changed as `color modify` changes it. `amount` is
 * the number given over 100 (over 360 for hue), negated for `-`. Hue and
 * saturation leave grays as they are (ChimeraX's chromatic mask); hue cannot
 * be multiplied.
 */
export function modifyColor(hex: string, adjuster: Adjuster, op: ModifyOp, amount: number): string {
  const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as Rgb
  const chromatic = Math.min(...rgb) !== Math.max(...rgb)
  let out: Rgb = rgb
  if (adjuster === 'hue' || adjuster === 'saturation' || adjuster === 'lightness') {
    if (adjuster !== 'lightness' && !chromatic) return hex
    const hls = rgbToHls(rgb)
    if (adjuster === 'hue') hls[0] = op === 'add' ? ((hls[0] + amount) % 1 + 1) % 1 : clamp01(amount)
    else if (adjuster === 'saturation') hls[2] = change(hls[2], amount, op)
    else hls[1] = change(hls[1], amount, op)
    out = hlsToRgb(hls)
  } else if (adjuster === 'whiteness' || adjuster === 'blackness') {
    const hwb = rgbToHwb(rgb)
    const i = adjuster === 'whiteness' ? 1 : 2
    hwb[i] = change(hwb[i], amount, op)
    out = hwbToRgb(hwb)
  } else {
    const i = adjuster === 'red' ? 0 : adjuster === 'green' ? 1 : 2
    out = [...rgb] as Rgb
    out[i] = change(rgb[i], amount, op)
  }
  return `#${out.map((c) => Math.round(Math.min(255, Math.max(0, c * 255))).toString(16).padStart(2, '0')).join('')}`
}
