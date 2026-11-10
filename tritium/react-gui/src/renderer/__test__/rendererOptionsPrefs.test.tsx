import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act } from 'react'
void React

vi.mock('@cuemol/core/src/wrappers/wrapper-loader', () => ({ wrapper_map: {} }))
vi.mock('@cuemol/core/src/BaseWrapper', () => ({ BaseWrapper: class {} }))
vi.mock('@renderer/hooks/cuemol/useCueMol', () => ({
    useCueMol: () => ({ cueMolReady: false, cm: null }),
}))

import { makeRenderHook } from './helpers/testHarness'
import {
    useRendererOptions, type RendererOptionsHost,
} from '@renderer/dialogs/fopen-opt-dlgs/useRendererOptions'

function open(host: RendererOptionsHost) {
    return makeRenderHook(() => useRendererOptions({
        visible: true,
        prefsHost: host,
        sceneId: 1,
        objClassName: 'DensityMap',
        rendererTypes: ['contour'],
        objectName: 'map1',
    }))
}

describe('useRendererOptions view-option memory', () => {
    beforeEach(() => globalThis.localStorage.clear())

    it('restores the confirmed centerView / mapCenterPolicy in the same host only', () => {
        const first = open('newRenderer')
        act(() => {
            first.result.setOptions((o) => ({ ...o, centerView: false, mapCenterPolicy: 'setMapCenter' }))
        })
        act(() => first.result.commitHistory())
        first.unmount()

        const again = open('newRenderer')
        expect(again.result.options.centerView).toBe(false)
        expect(again.result.options.mapCenterPolicy).toBe('setMapCenter')
        again.unmount()

        const other = open('fileOpen')
        expect(other.result.options.centerView).toBe(true)
        expect(other.result.options.mapCenterPolicy).toBe('auto')
        other.unmount()
    })
})
