import { describe, it, expect, vi } from 'vitest'
import { listStyleSets } from '@renderer/worker/server/services/style/styleSetList'
import type { WorkerContext } from '@renderer/worker/server/types/WorkerContext'

describe('listStyleSets', () => {
    it('lists the scene sets before the global ones (lookup order), with scope and flags', () => {
        const json: Record<number, string> = {
            0: JSON.stringify([
                { name: 'user', uid: 11, scene_id: 0, src: '/u.xml', readonly: false, modified: false },
                { name: 'system', uid: 12, scene_id: 0, src: '', readonly: true, modified: false },
            ]),
            7: JSON.stringify([
                { name: 'default', uid: 21, scene_id: 7, src: '', readonly: false, modified: true },
            ]),
        }
        const getStyleSetsJSON = vi.fn((scope: number) => json[scope] ?? '[]')
        const ctx = { svc: { getService: () => ({ getStyleSetsJSON }) } } as unknown as WorkerContext

        const res = listStyleSets(ctx, { sceneId: 7 })

        expect(res.ok).toBe(true)
        expect(res.styleSets).toEqual([
            { uid: 21, name: 'default', scopeId: 7, src: '', readonly: false, modified: true },
            { uid: 11, name: 'user', scopeId: 0, src: '/u.xml', readonly: false, modified: false },
            { uid: 12, name: 'system', scopeId: 0, src: '', readonly: true, modified: false },
        ])
    })
})
