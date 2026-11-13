/**
 * StyleEditorDialog wiring contract (the style-entries part of UXP
 * `style/style_editor.xul`).
 *
 * Pins: fetches the style-set contents on open, and a row's Delete routes to
 * the `removeStyleSetStyle` worker service.
 */

import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'

void React

vi.mock('@cuemol/core/src/wrappers/wrapper-loader', () => ({ wrapper_map: {} }))
vi.mock('@cuemol/core/src/BaseWrapper', () => ({ BaseWrapper: class {} }))
vi.mock('@renderer/contexts/ThemeContext', () => ({
    useTheme: () => ({ theme: 'light', toggleTheme: () => undefined, setTheme: () => undefined }),
}))

const cmHolder = vi.hoisted(() => ({ cm: null as unknown }))
vi.mock('@renderer/hooks/cuemol/useCueMol', () => ({
    useCueMol: () => ({ cm: cmHolder.cm, cueMolReady: !!cmHolder.cm }),
}))

import { StyleEditorDialog } from '@renderer/dialogs/StyleEditorDialog'
import { mountTree, flushPromises } from '@renderer/__test__/helpers/testHarness'

const CONTENTS = {
    ok: true,
    name: 'myStyle',
    readonly: false,
    colors: [],
    selections: [],
    styles: [{ name: 'st1', type: 'renderer' }],
}

let invokeService: ReturnType<typeof vi.fn>

beforeEach(() => {
    invokeService = vi.fn((name: string) =>
        name === 'getStyleSetContents' ? Promise.resolve(CONTENTS) : Promise.resolve({ ok: true }),
    )
    cmHolder.cm = { invokeService }
})
afterEach(() => {
    document.body.innerHTML = ''
})

describe('StyleEditorDialog', () => {
    it('fetches the set on open and deletes a style entry through removeStyleSetStyle', async () => {
        const view = mountTree(
            <StyleEditorDialog visible styleSetId={5} sceneId={1} styleName="myStyle" onClose={vi.fn()} />,
        )
        await flushPromises()
        expect(invokeService).toHaveBeenCalledWith('getStyleSetContents', { styleSetId: 5 })

        const del = document.body.querySelector('[aria-label="Delete style st1"]') as HTMLButtonElement
        act(() => del.click())
        expect(invokeService).toHaveBeenCalledWith('removeStyleSetStyle', {
            sceneId: 1, styleSetId: 5, name: 'st1',
        })
        view.unmount()
    })
})
