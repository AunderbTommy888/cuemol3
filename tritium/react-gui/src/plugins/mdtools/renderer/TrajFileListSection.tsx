/**
 * @file plugins/mdtools/renderer/TrajFileListSection.tsx
 * @description The ordered trajectory-file list with Add / Remove / Up / Down,
 * shared by the Open MD Trajectory and Attach Trajectory dialogs.
 *
 * Order is significant: frames concatenate in list order. Add opens a native
 * multi-select picker and appends to the end.
 */

import React, { useEffect, useState } from 'react'
import { AppIcon } from '@renderer/h3-kit/primitives'
import { FieldSection, ButtonRow, FormButton } from '@renderer/h3-kit/form'
import { Listbox, ListRow } from '@renderer/h3-kit/list'
import { IPC } from '@shared/ipcChannels'
import { setLastTrajPath } from './trajPathHistory'

const TRAJ_FILTERS = [
  { name: 'MD trajectory (*.dcd, *.xtc, *.trr, *.nc)', extensions: ['dcd', 'xtc', 'trr', 'nc'] },
  { name: 'All Files', extensions: ['*'] },
]

/** Trajectory extension -> short format badge label. */
const TRAJ_BADGE: Record<string, string> = { dcd: 'DCD', xtc: 'XTC', trr: 'TRR', nc: 'NetCDF' }

function basename(p: string): string {
  return p.split(/[\\/]/).pop() ?? p
}

function trajBadge(p: string): string {
  const base = basename(p)
  const dot = base.lastIndexOf('.')
  const ext = dot >= 0 ? base.slice(dot + 1).toLowerCase() : ''
  return TRAJ_BADGE[ext] ?? ext.toUpperCase()
}

interface Props {
  /** The files, in frame order. */
  paths: string[]
  onChange: (paths: string[]) => void
}

/**
 * Trajectory files section of an MD dialog.
 *
 * @param paths - the files, in frame order (controlled)
 * @param onChange - called with the new list after add / remove / move
 */
export function TrajFileListSection({ paths, onChange }: Props): React.JSX.Element {
  const [selectedIdx, setSelectedIdx] = useState(-1)

  // Drop a selection the list no longer has (the caller replaced the list).
  useEffect(() => {
    if (selectedIdx >= paths.length) setSelectedIdx(paths.length - 1)
  }, [paths.length, selectedIdx])

  const add = async (): Promise<void> => {
    try {
      const res = await window.electronAPI?.invoke(IPC.DIALOG_PICK_PATH, {
        title: 'Add trajectory files',
        filters: TRAJ_FILTERS,
        multi: true,
      })
      if (res && !res.canceled) {
        const added = res.filePaths ?? (res.filePath ? [res.filePath] : [])
        if (added.length > 0) {
          onChange([...paths, ...added])
          setLastTrajPath(added[added.length - 1])
        }
      }
    } catch {
      /* dialog unavailable (e.g. Vite dev server) -- ignore */
    }
  }

  const remove = (): void => {
    if (selectedIdx < 0) return
    const next = paths.slice()
    next.splice(selectedIdx, 1)
    onChange(next)
    setSelectedIdx(next.length === 0 ? -1 : Math.min(selectedIdx, next.length - 1))
  }

  const move = (delta: -1 | 1): void => {
    if (selectedIdx < 0) return
    const target = selectedIdx + delta
    if (target < 0 || target >= paths.length) return
    const next = paths.slice()
    const [moved] = next.splice(selectedIdx, 1)
    next.splice(target, 0, moved)
    onChange(next)
    setSelectedIdx(target)
  }

  return (
    <FieldSection
      title="Trajectory files"
      titleActions={
        <span className="type-caption">
          {paths.length} file{paths.length === 1 ? '' : 's'}
        </span>
      }
    >
      <Listbox framed>
        {paths.length === 0 ? (
          <div className="h3-list-empty">(no trajectory files added)</div>
        ) : (
          paths.map((p, idx) => (
            <ListRow key={`${p}-${idx}`} selected={idx === selectedIdx} onClick={() => setSelectedIdx(idx)}>
              <span className="type-row" title={p}>{basename(p)}</span>
              <span className="type-caption">{trajBadge(p)}</span>
            </ListRow>
          ))
        )}
      </Listbox>
      <ButtonRow>
        <FormButton icon={<AppIcon name="ui.add" aria-hidden />} text="Add..." onClick={add} />
        <FormButton icon={<AppIcon name="ui.trash" aria-hidden />} text="Remove" disabled={selectedIdx < 0} onClick={remove} />
        <FormButton icon={<AppIcon name="ui.caretUp" aria-hidden />} text="Up" disabled={selectedIdx <= 0} onClick={() => move(-1)} />
        <FormButton
          icon={<AppIcon name="ui.caretDown" aria-hidden />}
          text="Down"
          disabled={selectedIdx < 0 || selectedIdx >= paths.length - 1}
          onClick={() => move(1)}
        />
      </ButtonRow>
    </FieldSection>
  )
}
