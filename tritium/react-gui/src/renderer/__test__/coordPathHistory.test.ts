/**
 * Tests for the AMBER prmtop option dialog's coordinate path history:
 * localStorage-backed last-used path round-trip.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
    getLastCoordPath,
    setLastCoordPath,
    STORAGE_KEY as COORD_STORAGE_KEY,
} from '@renderer/dialogs/fopen-opt-dlgs/coordPathHistory'

describe('coordPathHistory (AMBER)', () => {
    beforeEach(() => {
        localStorage.removeItem(COORD_STORAGE_KEY)
    })

    it('returns undefined when nothing stored', () => {
        expect(getLastCoordPath()).toBeUndefined()
    })

    it('round-trips a stored coord path', () => {
        setLastCoordPath('/data/system.rst7')
        expect(getLastCoordPath()).toBe('/data/system.rst7')
    })

    it('ignores an empty set', () => {
        setLastCoordPath('')
        expect(getLastCoordPath()).toBeUndefined()
    })
})
