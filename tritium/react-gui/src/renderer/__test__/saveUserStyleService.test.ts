/**
 * Degrade-detection tests for `saveUserStyle` (worker lifecycle).
 *
 * Pins the UXP `Qm2Main.onUnLoad` (cuemol2.js:297-304) mirror:
 *   - resolve the user set uid via hasStyleSet("user", 0)
 *   - write it with saveStyleSetToFile(0, uid, path)
 *   - when no user set exists (uid < 0) nothing is written and it returns false
 */

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { loadDotStyles, loadUserStyle, markBundledStylesReadOnly, saveUserStyle } from '@renderer/worker/server/workerLifecycle'
import type { CueMol } from '@cuemol/core/src/cuemol'

// Temp dirs a test makes, removed after it.
const tmpDirs: string[] = []
function makeTmpDir(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
    tmpDirs.push(dir)
    return dir
}
afterEach(() => {
    for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function makeCm(opts: { uid?: number; saveResult?: boolean; noStyleMgr?: boolean } = {}) {
    const hasStyleSet = vi.fn(() => opts.uid ?? 3)
    const saveStyleSetToFile = vi.fn(() => opts.saveResult ?? true)
    const stylem = { hasStyleSet, saveStyleSetToFile }
    const getService = vi.fn((name: string) =>
        opts.noStyleMgr ? null : name === 'StyleManager' ? stylem : null,
    )
    const cm = { getService } as unknown as CueMol
    return { cm, hasStyleSet, saveStyleSetToFile, getService }
}

describe('saveUserStyle (worker lifecycle)', () => {
    it('resolves the user set uid and writes it to the given path', () => {
        const { cm, hasStyleSet, saveStyleSetToFile } = makeCm({ uid: 7 })
        expect(saveUserStyle(cm, '/tmp/user_styles.xml')).toBe(true)
        expect(hasStyleSet).toHaveBeenCalledWith('user', 0)
        expect(saveStyleSetToFile).toHaveBeenCalledWith(0, 7, '/tmp/user_styles.xml')
    })

    it('does not write and returns false when no "user" set exists (uid < 0)', () => {
        const { cm, saveStyleSetToFile } = makeCm({ uid: -1 })
        expect(saveUserStyle(cm, '/tmp/user_styles.xml')).toBe(false)
        expect(saveStyleSetToFile).not.toHaveBeenCalled()
    })

    it('returns false when StyleManager is unavailable', () => {
        const { cm } = makeCm({ noStyleMgr: true })
        expect(saveUserStyle(cm, '/tmp/user_styles.xml')).toBe(false)
    })

    it('propagates the saveStyleSetToFile result', () => {
        const { cm } = makeCm({ uid: 2, saveResult: false })
        expect(saveUserStyle(cm, '/tmp/user_styles.xml')).toBe(false)
    })
})

/**
 * The dot directory's style files (~/.cuemol/styles/*.xml) and the user set
 * that must stay above them: a style set is looked up front to back, so the
 * GUI settings lose to every other set if the user set is appended.
 */
describe('loadDotStyles / loadUserStyle (worker lifecycle)', () => {
    beforeEach(() => {
        vi.spyOn(console, 'info').mockImplementation(() => undefined)
        vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    })
    afterEach(() => { vi.restoreAllMocks() })

    /** A StyleManager whose global sets are a list of uids; a failing load leaves its set behind, as C++ does. */
    function makeStyleCm(failOn: string) {
        const sets: number[] = []
        let next = 10
        const stylem = {
            getStyleSetsJSON: vi.fn(() => JSON.stringify(sets.map((uid) => ({ uid, name: `s${uid}` })))),
            loadStyleSetFromFile: vi.fn((_scope: number, p: string, _readOnly: boolean) => {
                sets.unshift(next++)
                if (p.endsWith(failOn)) throw new Error('bad style')
            }),
            destroyStyleSet: vi.fn((_scope: number, uid: number) => { sets.splice(sets.indexOf(uid), 1) }),
            registerStyleSet: vi.fn(() => true),
            createStyleSet: vi.fn(),
        }
        const set = { name: '' }
        const cm = {
            getService: (name: string) => (name === 'StyleManager' ? stylem : null),
            createObj: () => set,
        } as unknown as CueMol
        return { cm, stylem, sets, set }
    }

    it('loads each file read-only, skips the reserved id "user" and an id-less root, and leaves nothing of a file that fails', () => {
        const dir = makeTmpDir('dotstyles-')
        const file = (name: string, root: string) => {
            const p = path.join(dir, name)
            fs.writeFileSync(p, `<?xml version="1.0"?>\n${root}\n<style id="X"/>\n</styles>\n`)
            return p
        }
        const good = file('good.xml', '<styles id="mydot">')
        const broken = file('broken.xml', '<styles id="broken">')
        const reserved = file('reserved.xml', "<styles id='user'>")
        const noId = file('noid.xml', '<styles>')
        const { cm, stylem, sets } = makeStyleCm('broken.xml')

        expect(loadDotStyles(cm, [broken, good, reserved, noId])).toBe(1)
        expect(stylem.loadStyleSetFromFile.mock.calls.map((c) => [c[1], c[2]])).toEqual([[broken, true], [good, true]])
        // The broken file's set went with its error; the good one stays.
        expect(sets).toEqual([11])
    })

    it('puts an empty user set first, above the sets already loaded', () => {
        const { cm, stylem, set } = makeStyleCm('')
        expect(loadUserStyle(cm)).toBe(true)
        expect(set.name).toBe('user')
        expect(stylem.registerStyleSet).toHaveBeenCalledWith(set, 0, 0)
        expect(stylem.createStyleSet).not.toHaveBeenCalled()
    })
})

describe('markBundledStylesReadOnly (worker lifecycle)', () => {
    it('marks every global set loaded at init read-only (nothing saves them)', () => {
        const sets: Record<number, { readonly: boolean }> = { 11: { readonly: false }, 12: { readonly: false } }
        const stylem = {
            getStyleSetsJSON: () => '[{"name":"system","uid":11},{"name":"cuemol3","uid":12}]',
            getStyleSet: (uid: number) => sets[uid] ?? null,
        }
        const cm = { getService: () => stylem } as unknown as CueMol
        expect(markBundledStylesReadOnly(cm)).toBe(2)
        expect(sets[11].readonly).toBe(true)
        expect(sets[12].readonly).toBe(true)
    })
})
