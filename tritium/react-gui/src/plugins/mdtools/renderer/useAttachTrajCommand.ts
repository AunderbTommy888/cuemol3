/**
 * @file plugins/mdtools/renderer/useAttachTrajCommand.ts
 * @description The file opener for dropped trajectory files: asks which
 * molecule to attach them to, then attaches them.
 *
 * Registered as the command the manifest's `fileOpeners` entry names. The
 * returned promise settles only when the dialog is closed and the attach is
 * done, because the drop batch waits for it before taking another drop.
 */

import {
  revealBottomTab,
  useCueMol,
  useRegisterPluginCommand,
  useShowErrorAlert,
  type FileOpenerArgs,
} from '@renderer/plugin-host/api'
import { mdtoolsServices } from '../calls'
import { ATTACH_TRAJ_COMMAND, TRAJECTORY_TAB_ID } from '../manifest'
import { useShowAttachTrajectoryDialog } from './AttachTrajectoryDialogProvider'
import { requestTrajFocus } from './trajFocus'

const TITLE = 'Attach trajectory'

/** Why nothing can be attached to: no molecule at all, or none with the files' atom count. */
function noTargetMessage(listed: { fileAtoms?: number; mismatched: number } | undefined): string {
  if (listed && listed.mismatched > 0) {
    if (listed.fileAtoms === -1) {
      return 'The dropped trajectory files have different atom counts, so no molecule can take them all.'
    }
    if (listed.fileAtoms !== undefined) {
      return (
        `No molecule in this scene has ${listed.fileAtoms} atoms, the atom count of the ` +
        'trajectory. Open the topology it was written for, then drop the trajectory again.'
      )
    }
  }
  return (
    'A trajectory file needs a molecule to attach to. Open its topology first ' +
    '(for example a .gro or .pdb file), then drop the trajectory again.'
  )
}

export function useAttachTrajCommand(): void {
  const { cm } = useCueMol()
  const showAttachDialog = useShowAttachTrajectoryDialog()
  const showErrorAlert = useShowErrorAlert()

  useRegisterPluginCommand<FileOpenerArgs>(ATTACH_TRAJ_COMMAND, async ({ paths, sceneId }) => {
    if (!cm || paths.length === 0) return
    try {
      const listed =
        sceneId === undefined
          ? undefined
          : await mdtoolsServices.invoke(cm, 'listAttachTargets', { sceneId, paths })
      if (sceneId === undefined || !listed || listed.targets.length === 0) {
        await showErrorAlert({ title: TITLE, message: noTargetMessage(listed) })
        return
      }
      const { targets } = listed
      const choice = await showAttachDialog({ targets, paths })
      if (!choice) return
      const res = await mdtoolsServices.invoke(cm, 'attachTrajectory', {
        sceneId,
        objId: choice.objId,
        trajPaths: choice.trajPaths,
        nevery: choice.nevery,
      })
      if (!res.ok) {
        await showErrorAlert({ title: TITLE, message: `Failed to attach the trajectory:\n${res.error}` })
        return
      }
      // Show the result: select it in the Trajectory tab, fitted, in front.
      requestTrajFocus({ objId: res.objId, nframe: res.nframe })
      revealBottomTab(TRAJECTORY_TAB_ID)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('AttachTraj failed:', e)
      await showErrorAlert({ title: TITLE, message: `Failed to attach the trajectory:\n${msg}` })
    }
  })
}
