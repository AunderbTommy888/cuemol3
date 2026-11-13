/**
 * @file features/styles/useStyleCtxMenu.ts
 * @description The Style Sets pane's right-click menu.
 *
 * Reuses the shared style menu templates: `SceneCtxMenuPayload` describes a
 * style set by its flags only (`styleInfo`), so the pane raises the same menu
 * the scene tree used to, on both the native macOS path and the React one. A
 * right-click on empty space raises the root menu (New / Paste / Load).
 */

import { useCallback } from 'react'
import type { SceneCtxMenuPayload } from '@shared/types/sceneCtxMenu'
import type { StyleSetEntry } from '@renderer/worker/shared/styleSetTypes'
import {
    peekClipboardKind,
    useShowSceneCtxMenu,
} from '@renderer/hooks/sceneContextMenu/useShowSceneCtxMenu'
import { useCommands } from '@renderer/commands/CommandRegistry'
import { styleCtxActionToCommand, styleSetLabel } from './styleCtxActionToCommand'

export function useStyleCtxMenu(): (
    set: StyleSetEntry | null,
    x: number,
    y: number,
) => Promise<void> {
    const showMenu = useShowSceneCtxMenu()
    const { dispatch } = useCommands()

    return useCallback(
        async (set: StyleSetEntry | null, x: number, y: number): Promise<void> => {
            const payload: SceneCtxMenuPayload = {
                x,
                y,
                nodeType: set ? 'style' : 'styleRoot',
                nodeLabel: set ? styleSetLabel(set) : 'Styles',
                isVisible: true,
                hasVisibility: false,
                clipboardKind: await peekClipboardKind(),
                styleInfo: set
                    ? { scopeId: set.scopeId, src: set.src, readonly: set.readonly, modified: set.modified }
                    : undefined,
            }
            const action = await showMenu(payload)
            if (!action) return
            const invocation = styleCtxActionToCommand(set, action)
            if (!invocation) return
            await dispatch(
                invocation.id,
                ...((invocation.args === undefined ? [] : [invocation.args]) as [never]),
            )
        },
        [showMenu, dispatch],
    )
}
