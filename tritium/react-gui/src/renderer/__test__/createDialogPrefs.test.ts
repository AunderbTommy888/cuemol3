import { describe, it, expect, beforeEach } from 'vitest'
import {
    createDialogPrefs, isBool, isNum, isOneOf, isOptNum, isStr,
} from '@renderer/utils/createDialogPrefs'

const KEY = 'test.createDialogPrefs'

interface P {
    uid?: number
    flag: boolean
    dist: number
    mode: 'a' | 'b'
    sel: string
}

const prefs = createDialogPrefs<P>({
    key: KEY,
    defaults: { flag: true, dist: 3, mode: 'a', sel: '' },
    fields: { uid: isOptNum, flag: isBool, dist: isNum(0, 10), mode: isOneOf(['a', 'b']), sel: isStr },
})

describe('createDialogPrefs', () => {
    beforeEach(() => globalThis.localStorage.clear())

    it('round-trips a saved record', () => {
        prefs.save({ uid: 7, flag: false, dist: 5, mode: 'b', sel: 'chain A' })
        expect(prefs.load()).toEqual({ uid: 7, flag: false, dist: 5, mode: 'b', sel: 'chain A' })
    })

    it('falls back per field: invalid or missing values take the default, unknown keys drop', () => {
        globalThis.localStorage.setItem(KEY, JSON.stringify({
            uid: 'x', flag: false, dist: 99, mode: 'c', extra: 1,
        }))
        // Only `flag` survives; the absent optional uid stays absent.
        expect(prefs.load()).toEqual({ flag: false, dist: 3, mode: 'a', sel: '' })
        globalThis.localStorage.setItem(KEY, '[1,2]')
        expect(prefs.load()).toEqual(prefs.defaults)
    })
})
