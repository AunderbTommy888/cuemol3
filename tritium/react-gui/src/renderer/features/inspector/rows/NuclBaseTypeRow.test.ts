/**
 * @file features/inspector/rows/NuclBaseTypeRow.test.ts
 * @description The writes the nucl Base type row sends for "None" and for
 * leaving it.
 */

import { describe, it, expect } from 'vitest'
import type { GenericPropEntry } from '@renderer/worker/shared/genericProps'
import { makePropCtx } from '@renderer/features/inspector/schema/types'
import { BASE_NONE, baseTypeWrites, isBaseNone } from './NuclBaseTypeRow'

function entry(over: Partial<GenericPropEntry>): GenericPropEntry {
  return {
    key: '', type: 'real', value: 0, readonly: false, hasdefault: true,
    isdefault: false, isContainer: false, depth: 0, ...over,
  } as GenericPropEntry
}

const ctxOf = (type: string, size: number, sizeDefault = 0.3) =>
  makePropCtx(
    [
      entry({ key: 'base_type', type: 'enum', value: type }),
      entry({ key: 'base_size', value: size, defaultValue: sizeDefault }),
      entry({ key: 'base_thick', value: 0.5 }),
    ],
    'nucl', 1, 2, undefined,
  )

describe('NuclBaseTypeRow writes', () => {
  it('None is basepair + size 0; leaving it resets size and thickness in the same batch', () => {
    // None writes the pair and leaves the thickness alone.
    expect(baseTypeWrites(ctxOf('detail1', 1.0), BASE_NONE)).toEqual([
      { key: 'base_type', valueType: 'enum', value: 'basepair' },
      { key: 'base_size', valueType: 'real', value: 0 },
    ])

    // Only the pair reads back as None: a detail mode at size 0 still draws
    // its rings (old CueMol2 scenes), so it is not None.
    expect(isBaseNone(ctxOf('basepair', 0))).toBe(true)
    expect(isBaseNone(ctxOf('detail1', 0))).toBe(false)

    // Leaving None: the type set plus true resets, one batch (one undo step).
    expect(baseTypeWrites(ctxOf('basepair', 0), 'detail2')).toEqual([
      { key: 'base_type', valueType: 'enum', value: 'detail2' },
      { op: 'reset', key: 'base_size' },
      { op: 'reset', key: 'base_thick' },
    ])
    // A default size that would keep the bases hidden is replaced by a set.
    expect(baseTypeWrites(ctxOf('basepair', 0, 0), 'detail2')[1]).toEqual(
      { key: 'base_size', valueType: 'real', value: 0.5 },
    )

    // Switching between modes outside None writes the type only.
    expect(baseTypeWrites(ctxOf('detail1', 1.0), 'simple1')).toEqual([
      { key: 'base_type', valueType: 'enum', value: 'simple1' },
    ])
  })
})
