/**
 * @file features/styles/styleCtxActionToCommand.ts
 * @description Turn a style-set context-menu action into a command.
 *
 * The Style Sets pane raises the shared style menu templates
 * (`buildStyleNodeMenu` / `buildStyleRootMenu`) the scene tree used to raise,
 * but its rows are style sets, not tree nodes -- so the action resolves
 * against the set here. Pure and synchronous; an action that needs a row
 * returns null when the menu was raised on empty space.
 */

import type { SceneCtxAction } from '@shared/types/sceneCtxMenu'
import type { StyleSetEntry } from '@renderer/worker/shared/styleSetTypes'
import type { CommandInvocation } from '@renderer/state/sceneTree/commands/sceneCtxActionToCommand'
import { CmdId } from '@renderer/commands/ids'

/** Row label of a set; an anonymous set reads "(anonymous)", as in UXP. */
export function styleSetLabel(set: StyleSetEntry): string {
    return set.name === '' ? '(anonymous)' : set.name
}

/**
 * Build the invocation for `action`, or null when it does not apply.
 *
 * @param set - the set the menu was raised on, or null for empty space.
 */
export function styleCtxActionToCommand(
    set: StyleSetEntry | null,
    action: SceneCtxAction,
): CommandInvocation | null {
    const ref = set ? { id: String(set.uid), scopeId: set.scopeId, name: styleSetLabel(set) } : null
    switch (action.kind) {
        case 'newStyle':
            return { id: CmdId.StyleNew }
        case 'styleLoad':
            return { id: CmdId.StyleLoadFromFile }
        case 'styleReload':
            return { id: CmdId.StyleReload }
        case 'paste':
            return { id: CmdId.StylePaste }
        case 'copy':
            return ref ? { id: CmdId.StyleCopy, args: { id: ref.id, scopeId: ref.scopeId } } : null
        case 'delete':
            return ref ? { id: CmdId.StyleDelete, args: { id: ref.id, scopeId: ref.scopeId } } : null
        case 'editStyle':
            return ref ? { id: CmdId.StyleEdit, args: ref } : null
        case 'styleToggleReadOnly':
            return ref ? { id: CmdId.StyleToggleReadOnly, args: { id: ref.id, scopeId: ref.scopeId } } : null
        case 'styleSave':
            return ref ? { id: CmdId.StyleSave, args: ref } : null
        case 'styleSaveAs':
            return ref ? { id: CmdId.StyleSaveAs, args: ref } : null
        default:
            return null
    }
}
