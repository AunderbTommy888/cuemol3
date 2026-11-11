/**
 * @file features/inspector/rows/NuclBaseTypeRow.tsx
 * @description The nucl renderer's Base type dropdown, with a "None" choice
 * that leaves only the tube.
 *
 * None is not a C++ enum value: it is the existing pair `base_type =
 * basepair` + `base_size = 0`, so a scene saved with it reads the same in
 * older CueMol versions (a zero-radius base pair draws nothing). The pair is
 * the only thing read back as None -- a detail mode at size 0 still draws its
 * filled rings (old CueMol2 scenes use that look), so it shows as that mode.
 * Leaving None restores the default size and thickness rather than the ones
 * before None, which are not kept.
 */

import React from 'react'
import { PropertyField, SelectField } from '@renderer/h3-kit/form'
import { isModified, isResettable } from '@renderer/features/inspector/propModel'
import type { PropMultiWrite } from '@renderer/features/inspector/rendererPropSections'
import type { CustomRowProps, PropCtx } from '@renderer/features/inspector/schema/types'

/** The dropdown value standing for "no bases". */
export const BASE_NONE = 'none'

/** The base mode None writes (zero-radius base pairs draw nothing). */
const NONE_TYPE = 'basepair'

/** `base_size` when its default would itself hide the bases (qif default). */
const FALLBACK_SIZE = 0.5

/** The properties a None state is made of, which its reset restores. */
const NONE_KEYS = ['base_type', 'base_size', 'base_thick']

/** True when the renderer is in the None state (see the file comment). */
export function isBaseNone(ctx: PropCtx): boolean {
  return ctx.value('base_type') === NONE_TYPE && Number(ctx.value('base_size')) === 0
}

/**
 * The writes that pick `choice` (a `base_type` id or {@link BASE_NONE}), sent
 * as one batch so they make one undo step.
 *
 * @returns the writes, empty when nothing changes
 */
export function baseTypeWrites(ctx: PropCtx, choice: string): PropMultiWrite[] {
  const type = ctx.get('base_type')
  const size = ctx.get('base_size')
  if (!type || !size) return []
  if (choice === BASE_NONE) {
    // The thickness is left alone: it only matters to the detail modes.
    return [
      { key: type.key, valueType: type.type, value: NONE_TYPE },
      { key: size.key, valueType: size.type, value: 0 },
    ]
  }
  const writes: PropMultiWrite[] = [{ key: type.key, valueType: type.type, value: choice }]
  if (isBaseNone(ctx)) {
    // Back to the default size and thickness. A style whose default size is
    // not positive would keep the bases hidden, so the size is set instead.
    const sizeDefault = Number(size.defaultValue)
    writes.push(
      sizeDefault > 0
        ? { op: 'reset', key: size.key }
        : { key: size.key, valueType: size.type, value: FALLBACK_SIZE },
    )
    const thick = ctx.get('base_thick')
    if (thick) writes.push({ op: 'reset', key: thick.key })
  }
  return writes
}

/**
 * Base type dropdown for the nucl renderer page. Its reset follows the state:
 * the base type alone normally, the whole None pair (and thickness) when in
 * None -- the style's defaults decide where that lands.
 */
export const NuclBaseTypeRow: React.FC<CustomRowProps> = ({ ctx, onSetMany, disabled }) => {
  const type = ctx.get('base_type')
  if (!type) return null
  const none = isBaseNone(ctx)
  const resetEntries = (none ? NONE_KEYS : ['base_type'])
    .map((k) => ctx.get(k))
    .filter((e) => e !== undefined && isResettable(e))
  const modes = type.enumdef ?? [String(type.value)]

  const send = (writes: PropMultiWrite[]): void => {
    if (writes.length > 0) onSetMany?.(writes)
  }
  return (
    <PropertyField
      label="Base type"
      resettable={resetEntries.length > 0}
      modified={resetEntries.some((e) => isModified(e!))}
      onReset={() => send(resetEntries.map((e) => ({ op: 'reset' as const, key: e!.key })))}
    >
      <SelectField
        value={none ? BASE_NONE : String(type.value)}
        disabled={disabled || type.readonly}
        onChange={(v) => send(baseTypeWrites(ctx, v))}
      >
        <option value={BASE_NONE}>None</option>
        {modes.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </SelectField>
    </PropertyField>
  )
}
