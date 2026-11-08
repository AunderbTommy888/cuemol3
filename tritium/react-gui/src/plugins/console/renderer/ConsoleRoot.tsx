/**
 * @file plugins/console/renderer/ConsoleRoot.tsx
 * @description The plugin's mount point: it owns the command runner.
 *
 * Renders nothing. Runs the startup scripts once per launch
 * (`useStartupScripts`). The runner has to outlive the panel, which the bottom
 * panel unmounts whenever another tab is in front; so does the endpoint the
 * command line client talks to.
 */

import React from 'react'
import { useConsoleEndpoint } from './useConsoleEndpoint'
import { useConsoleRunner } from './useConsoleRunner'
import { useStartupScripts } from './useStartupScripts'

void React

export const ConsoleRoot: React.FC = () => {
  const { runScript } = useConsoleRunner()
  useConsoleEndpoint()
  useStartupScripts(runScript)
  return null
}
ConsoleRoot.displayName = 'ConsoleRoot'
