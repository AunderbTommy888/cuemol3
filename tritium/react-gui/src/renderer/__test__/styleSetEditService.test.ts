/**
 * Degrade-detection tests for `styleSetEdit` (worker service backing the style
 * editor, UXP `style/style_editor.xul`).
 *
 * Pins the wire contract:
 *   - getStyleSetContents parses colors (name + hex), selections (name + value
 *     from the "sel" str-data category), and style entries (name + type);
 *   - the colour / selection writers go through the StyleManager methods with
 *     the set's scope (they queue the event that redraws the named colour's
 *     users; the StyleSet's own setters queue none) and fire pending events;
 *   - a read-only set is refused; a global set (the "user" set) is written
 *     outside the scene's undo txn, as C++ keeps no undo for it;
 *   - missing manager / set -> { ok: false }.
 */

import { describe, it, expect, vi } from 'vitest'
import type { WorkerContext } from '@renderer/worker/server/types/WorkerContext'

vi.mock('@renderer/worker/server/services/helpers/sceneResolver', () => ({
    getSceneOrNull: (ctx: { __scene?: unknown }) => ctx.__scene ?? null,
}))
const txn = vi.hoisted(() => ({ labels: [] as string[] }))
vi.mock('@renderer/worker/server/services/withUndoTxn', () => ({
    withUndoTxn: (_scene: unknown, label: string, fn: () => void) => {
        txn.labels.push(label)
        fn()
    },
}))

import { services } from '@renderer/worker/server/services/style/style.service'

const {
    getStyleSetContents,
    setStyleSetColor,
    removeStyleSetColor,
    setStyleSetSelection,
    removeStyleSetSelection,
    removeStyleSetStyle,
} = services

function makeSet(readonly = false) {
    return {
        name: 'myStyle',
        readonly,
        getColorDefsJSON: () => '["red","blue"]',
        getColor: () => ({ r: () => 255, g: () => 0, b: () => 0 }),
        getStrDataNamesJSON: (cat: string) => (cat === 'sel' ? '["sel1"]' : '[]'),
        getStrData: () => 'A.10',
        getStyleNamesJSON: () => '[{"name":"st1","type":"renderer"}]',
        removeStyle: vi.fn(() => true),
    }
}

/** A manager holding `set` as uid 5 in scope `scopeId` (1 = the scene, 0 = global). */
function makeCtx(set: unknown, scopeId = 1) {
    const entry = JSON.stringify([{ name: 'myStyle', uid: 5, scene_id: scopeId }])
    const mgr = {
        getStyleSet: () => set,
        getStyleSetsJSON: (scope: number) => (scope === scopeId ? entry : '[]'),
        compileColor: vi.fn((s: string) => ({ __color: s })),
        setColor: vi.fn(() => true),
        removeColor: vi.fn(() => true),
        setStrData: vi.fn(() => true),
        removeStrData: vi.fn(() => true),
        firePendingEvents: vi.fn(),
    }
    const ctx = {
        __scene: {},
        styleMgr: mgr,
        svc: { getService: (n: string) => (n === 'StyleManager' ? mgr : null) },
    } as unknown as WorkerContext
    txn.labels = []
    return { ctx, mgr }
}

describe('styleSetEdit.getStyleSetContents', () => {
    it('parses colors / selections / styles', () => {
        const { ctx } = makeCtx(makeSet())
        const res = getStyleSetContents(ctx, { styleSetId: 5 })
        expect(res.ok).toBe(true)
        expect(res.name).toBe('myStyle')
        expect(res.colors).toEqual([
            { name: 'red', hex: '#ff0000' },
            { name: 'blue', hex: '#ff0000' },
        ])
        expect(res.selections).toEqual([{ name: 'sel1', value: 'A.10' }])
        expect(res.styles).toEqual([{ name: 'st1', type: 'renderer' }])
    })

    it('returns ok:false when the set is missing', () => {
        const { ctx } = makeCtx(null)
        expect(getStyleSetContents(ctx, { styleSetId: 5 }).ok).toBe(false)
    })
})

describe('styleSetEdit writers', () => {
    it('writes colours and selections through the StyleManager with the set scope, then fires events', () => {
        const set = makeSet()
        const { ctx, mgr } = makeCtx(set)
        const res = setStyleSetColor(ctx, {
            sceneId: 1, styleSetId: 5, scopeId: 1, name: 'green', colorStr: '#00ff00',
        })
        expect(res.ok).toBe(true)
        expect(mgr.setColor).toHaveBeenCalledWith('green', { __color: '#00ff00' }, 1, 5)
        removeStyleSetColor(ctx, { sceneId: 1, styleSetId: 5, name: 'red' })
        setStyleSetSelection(ctx, { sceneId: 1, styleSetId: 5, name: 'sel2', value: 'A.20' })
        removeStyleSetSelection(ctx, { sceneId: 1, styleSetId: 5, name: 'sel1' })
        removeStyleSetStyle(ctx, { sceneId: 1, styleSetId: 5, name: 'st1' })
        expect(mgr.removeColor).toHaveBeenCalledWith('red', 1, 5)
        expect(mgr.setStrData).toHaveBeenCalledWith('sel', 'sel2', 'A.20', 1, 5)
        expect(mgr.removeStrData).toHaveBeenCalledWith('sel', 'sel1', 1, 5)
        expect(set.removeStyle).toHaveBeenCalledWith('st1')
        expect(mgr.firePendingEvents).toHaveBeenCalledTimes(5)
        expect(txn.labels).toHaveLength(5)
    })

    it('refuses a read-only set without writing', () => {
        const { ctx, mgr } = makeCtx(makeSet(true))
        expect(removeStyleSetColor(ctx, { sceneId: 1, styleSetId: 5, name: 'red' }).ok).toBe(false)
        expect(mgr.removeColor).not.toHaveBeenCalled()
    })

    it('writes a global set outside the scene undo txn', () => {
        const { ctx, mgr } = makeCtx(makeSet(), 0)
        expect(removeStyleSetColor(ctx, { sceneId: 1, styleSetId: 5, name: 'red' }).ok).toBe(true)
        expect(mgr.removeColor).toHaveBeenCalledWith('red', 0, 5)
        expect(txn.labels).toEqual([])
    })

    it('rejects an empty colour name without touching the set', () => {
        const { ctx, mgr } = makeCtx(makeSet())
        expect(setStyleSetColor(ctx, { sceneId: 1, styleSetId: 5, scopeId: 1, name: '  ', colorStr: '#fff' }).ok).toBe(false)
        expect(mgr.setColor).not.toHaveBeenCalled()
    })
})
