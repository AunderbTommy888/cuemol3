/**
 * @file plugins/console/renderer/StartupStatusItem.tsx
 * @description The startup scripts' item in the status bar, and its popover.
 *
 * Shown only while the scripts run, and after a failure or Stop until the
 * popover has been opened and closed: the status bar is in view whatever
 * tab the bottom panel shows, so this is where a launch's scripts are seen
 * running and stopped. The popover lists the scripts with where each is,
 * and holds Stop (the same one as the Console's).
 */

import React, { useState } from 'react'
import { Popover } from '@blueprintjs/core'
import { AppIcon, useDarkPortalClass } from '@renderer/h3-kit/primitives'
import type { AppIconKey } from '@renderer/h3-kit/primitives'
import { FormButton } from '@renderer/h3-kit/form'
import { useConsoleSession } from './consoleSessionStore'
import { dismissStartup, useStartupActivity } from './startupActivity'
import type { StartupFileStatus, StartupPhase } from './startupActivity'

void React

const FILE_LABELS: Record<StartupFileStatus, string> = {
  waiting: 'Waiting',
  running: 'Running',
  done: 'Done',
  failed: 'Failed',
  stopped: 'Stopped',
  skipped: 'Skipped',
  'not-run': 'Not run',
}

/** The status-pop colour class of a file's status (the CLI item's states). */
const FILE_STATES: Record<StartupFileStatus, string> = {
  waiting: 'off',
  running: 'running',
  done: 'idle',
  failed: 'error',
  stopped: 'running',
  skipped: 'off',
  'not-run': 'off',
}

const ITEM: Record<Exclude<StartupPhase, 'idle'>, { state: string; icon: AppIconKey; title: string }> = {
  running: { state: 'running', icon: 'ui.refresh', title: 'Running the startup scripts' },
  failed: { state: 'error', icon: 'ui.error', title: 'A startup script failed' },
  stopped: { state: 'off', icon: 'ui.stop', title: 'The startup scripts were stopped' },
}

/** The file name of a path (either separator). */
function baseName(filePath: string): string {
  return filePath.slice(Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\')) + 1)
}

export const StartupStatusItem: React.FC = () => {
  const { phase, files } = useStartupActivity()
  const { stopper } = useConsoleSession()
  const portalClassName = useDarkPortalClass()
  const [open, setOpen] = useState(false)

  if (phase === 'idle') return null
  const item = ITEM[phase]
  const current = files.findIndex((f) => f.status === 'running')
  const label = phase === 'running' && current >= 0 ? `Startup ${current + 1}/${files.length}` : 'Startup'

  const close = () => {
    setOpen(false)
    // Seen: an ended run's item goes with its popover.
    dismissStartup()
  }

  const content = (
    <div className="status-pop">
      <div className="status-pop-header">
        <span className="type-title">Startup Scripts</span>
        {phase === 'running' && (
          <FormButton
            icon={<AppIcon name="ui.stop" className="console-stop-icon" aria-hidden />}
            text="Stop"
            onClick={() => { stopper?.() }}
            disabled={!stopper}
            aria-label="Stop the startup scripts"
          />
        )}
      </div>
      <div className="status-pop-section">
        {files.map((f) => (
          <div key={f.path} className="status-pop-row" title={f.path}>
            <span className="type-body">{baseName(f.path)}</span>
            <span className={`type-body status-pop-value status-pop-value--${FILE_STATES[f.status]}`}>
              {FILE_LABELS[f.status]}
            </span>
          </div>
        ))}
        <span className="type-caption status-pop-detail">What they printed is in the Console.</span>
      </div>
    </div>
  )

  return (
    <Popover
      isOpen={open}
      onClose={close}
      placement="top-end"
      portalClassName={portalClassName}
      content={content}
      renderTarget={({ isOpen: _o, ref, ...targetProps }) => (
        <button
          {...targetProps}
          ref={ref}
          type="button"
          className={`status-item status-button status-button--${item.state}`}
          title={item.title}
          onClick={() => (open ? close() : setOpen(true))}
        >
          <AppIcon
            name={item.icon}
            size="sm"
            className={phase === 'running' ? 'status-spinner' : undefined}
            aria-hidden
          />
          <span>{label}</span>
        </button>
      )}
    />
  )
}
StartupStatusItem.displayName = 'StartupStatusItem'
