/**
 * @file plugins/mdtools/renderer/AttachTrajectoryDialogProvider.tsx
 * @description Provider / show hook for the Attach Trajectory dialog.
 */

import React from 'react'
import { createConfirmCancelDialog } from '@renderer/plugin-host/api'
import {
  AttachTrajectoryDialog,
  type AttachTrajectoryArgs,
  type AttachTrajectoryChoice,
} from './AttachTrajectoryDialog'

// React import is required by the JSX runtime used at test time; do not remove.
void React

export const {
  Provider: AttachTrajectoryDialogProvider,
  useShow: useShowAttachTrajectoryDialog,
} = createConfirmCancelDialog<AttachTrajectoryArgs, AttachTrajectoryChoice>({
  name: 'AttachTrajectoryDialog',
  component: AttachTrajectoryDialog,
})
