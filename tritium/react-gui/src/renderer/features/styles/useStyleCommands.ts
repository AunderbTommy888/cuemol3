/**
 * @file features/styles/useStyleCommands.ts
 * @description Handlers for every style-set command, wherever it is raised
 * from (the Style Sets pane's toolbar, keys, and context menu).
 *
 * A style set is addressed by its uid plus the scope it lives in, both carried
 * on the pane's row. Registered app-wide rather than from the scene-tree
 * provider, because the Style Sets pane is their surface now. Every handler
 * acts on the active scene and is a no-op without one.
 */

import { IPC } from '@shared/ipcChannels'
import type { AsyncCueMol } from '@renderer/worker/client/AsyncCueMol'
import type { ActiveSceneCommandDeps } from '@renderer/commands/commandTypes'
import { useShowTextPromptDialog } from '@renderer/dialogs/TextPromptDialogProvider'
import { useShowStyleEditorDialog } from '@renderer/dialogs/StyleEditorDialogProvider'
import { useRegisterCommand } from '@renderer/commands/CommandRegistry'
import { CmdId } from '@renderer/commands/ids'
import * as ops from './styleOps'

export interface StyleCommandsOptions {
  cm: AsyncCueMol | null
  getActiveSceneInfo: ActiveSceneCommandDeps
}

/** A never-saved style set has no name to offer the save dialog. */
const saveName = (name: string): string => (name === '(anonymous)' ? '' : name)

export function useStyleCommands({ cm, getActiveSceneInfo }: StyleCommandsOptions): void {
  const showTextPrompt = useShowTextPromptDialog()
  const showStyleEditor = useShowStyleEditorDialog()

  const sceneId = (): number | undefined => getActiveSceneInfo()?.scene_uid

  useRegisterCommand(CmdId.StyleNew, async () => {
    const sid = sceneId()
    if (sid === undefined) return null
    // UXP `createStyle` walks "style_0", "style_1", ... until it finds a free
    // name then prompts; pre-fetch the same suggestion.
    let suggestion = 'style_0'
    if (cm) {
      try {
        const r = await cm.invokeService('proposeUniqName', {
          kind: 'styleSet', prefix: 'style', sceneId: sid,
        })
        suggestion = r?.name ?? suggestion
      } catch (err) {
        console.warn('proposeUniqName failed:', err)
      }
    }
    const entered = await showTextPrompt({
      title: 'New Style',
      label: 'Name for new style:',
      defaultValue: suggestion,
      confirmLabel: 'Create',
    })
    if (entered == null) return null
    return ops.createStyleSet(cm, sid, entered)
  })

  useRegisterCommand(CmdId.StyleEdit, async ({ id, name }) => {
    const sid = sceneId()
    if (sid === undefined) return
    await showStyleEditor({ styleSetId: Number(id), sceneId: sid, styleName: name })
  })

  useRegisterCommand(CmdId.StyleDelete, async ({ id, scopeId }) => {
    await ops.destroyStyleSet(cm, sceneId(), Number(id), scopeId)
  })

  useRegisterCommand(CmdId.StyleCopy, async ({ id, scopeId }) => {
    return ops.copyStyleSet(cm, sceneId(), Number(id), scopeId)
  })

  useRegisterCommand(CmdId.StylePaste, async () => {
    await ops.pasteStyleSet(cm, sceneId())
  })

  useRegisterCommand(CmdId.StyleToggleReadOnly, async ({ id, scopeId }) => {
    await ops.toggleStyleSetReadOnly(cm, sceneId(), Number(id), scopeId)
  })

  useRegisterCommand(CmdId.StyleLoadFromFile, async () => {
    const sid = sceneId()
    if (sid === undefined) return
    const r = await window.electronAPI.invoke(IPC.DIALOG_STYLE_OPEN)
    if (r.canceled || !r.filePath) return
    await ops.loadStyleSetFromFile(cm, sid, r.filePath)
  })

  useRegisterCommand(CmdId.StyleReload, () => {
    // UXP's own `onStyReloadFile` reports "Not implemented"; mirror that
    // rather than inventing behaviour it never had.
    console.info('styleReload not implemented yet (matches UXP onStyReloadFile)')
  })

  useRegisterCommand(CmdId.StyleSave, async ({ id, scopeId, name }) => {
    const sid = sceneId()
    if (sid === undefined) return
    const r = await ops.saveStyleSetToCurrentSrc(cm, sid, Number(id), scopeId)
    // A style set with no source file falls through to Save As, as in UXP.
    if (!r.ok || r.saved) return
    const save = await window.electronAPI.invoke(IPC.DIALOG_STYLE_SAVE, {
      defaultName: saveName(name),
    })
    if (save.canceled || !save.filePath) return
    await ops.saveStyleSetToFile(cm, sid, Number(id), scopeId, save.filePath)
  })

  useRegisterCommand(CmdId.StyleSaveAs, async ({ id, scopeId, name }) => {
    const sid = sceneId()
    if (sid === undefined) return
    const save = await window.electronAPI.invoke(IPC.DIALOG_STYLE_SAVE, {
      defaultName: saveName(name),
    })
    if (save.canceled || !save.filePath) return
    await ops.saveStyleSetToFile(cm, sid, Number(id), scopeId, save.filePath)
  })
}
