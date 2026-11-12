/**
 * @file plugins/mdtools/renderer/AttachTrajectoryDialog.tsx
 * @description "Attach Trajectory" dialog: picks the molecule dropped
 * trajectory files go onto, and lets the file list and frame sampling be
 * adjusted. It only collects the choice; the command runs the attach.
 *
 * A plain molecule is converted to a Trajectory (its own coordinates stay as
 * frame 0); a Trajectory gets the files appended. Molecules that cannot be
 * converted are listed greyed with the reason, so the user sees why the one
 * they expected is not pickable.
 */

import React, { useEffect, useState } from 'react'
import { DialogShell } from '@renderer/plugin-host/api'
import { FieldSection, SliderField } from '@renderer/h3-kit/form'
import { Listbox, ListRow } from '@renderer/h3-kit/list'
import type { AttachTarget } from '../worker/attachTrajectory'
import { TrajFileListSection } from './TrajFileListSection'

export interface AttachTrajectoryArgs {
  /** The molecules of the scene, as the worker listed them. */
  targets: AttachTarget[]
  /** The dropped files, in drop order. */
  paths: string[]
}

export interface AttachTrajectoryChoice {
  objId: number
  trajPaths: string[]
  nevery: number
}

interface Props extends AttachTrajectoryArgs {
  visible: boolean
  onConfirm: (result: AttachTrajectoryChoice) => void
  onCancel: () => void
}

// Stable empties for the hidden dialog, which is mounted with no show-args;
// fresh literals would re-run the seeding effect on every render.
const NO_TARGETS: AttachTarget[] = []
const NO_PATHS: string[] = []

/** The only pickable target, preselected; with several the user chooses. */
function initialTarget(targets: AttachTarget[]): number | undefined {
  const pickable = targets.filter((t) => !t.reason)
  return pickable.length === 1 ? pickable[0].uid : undefined
}

export function AttachTrajectoryDialog({
  visible,
  targets = NO_TARGETS,
  paths = NO_PATHS,
  onConfirm,
  onCancel,
}: Props): React.JSX.Element {
  const [objId, setObjId] = useState<number | undefined>(undefined)
  const [trajPaths, setTrajPaths] = useState<string[]>([])
  const [nevery, setNevery] = useState(1)

  useEffect(() => {
    if (!visible) return
    setObjId(initialTarget(targets))
    setTrajPaths(paths)
    setNevery(1)
  }, [visible, targets, paths])

  const chosen = targets.find((t) => t.uid === objId)
  const canAttach = chosen !== undefined && !chosen.reason && trajPaths.length > 0

  const handleOk = (): void => {
    if (!canAttach || objId === undefined) return
    onConfirm({ objId, trajPaths, nevery })
  }

  return (
    <DialogShell
      visible={visible}
      title="Attach Trajectory"
      width="2xl"
      okLabel="Attach"
      okDisabled={!canAttach}
      onOk={handleOk}
      onCancel={onCancel}
    >
      <div className="omt-traj-sections">
        <FieldSection title="Attach to">
          <Listbox framed>
            {targets.map((t) => (
              <ListRow
                key={t.uid}
                selected={t.uid === objId}
                disabled={!!t.reason}
                onClick={() => setObjId(t.uid)}
              >
                <span className="type-row">{t.name || `Object ${t.uid}`}</span>
                <span className="type-caption" title={t.reason}>
                  {t.reason
                    ? `Cannot attach: ${t.reason}`
                    : `${t.natoms} atoms${t.className === 'Trajectory' ? ', trajectory' : ''}`}
                </span>
              </ListRow>
            ))}
          </Listbox>
          {chosen && !chosen.reason && chosen.className !== 'Trajectory' && (
            <span className="type-caption">
              This molecule is converted to a trajectory; its coordinates stay as the first frame.
            </span>
          )}
        </FieldSection>

        <TrajFileListSection paths={trajPaths} onChange={setTrajPaths} />

        <FieldSection title="Frame sampling">
          <SliderField
            label="Load every N-th frame"
            value={nevery}
            min={1}
            max={9999}
            step={1}
            onCommit={setNevery}
            slider={false}
          />
        </FieldSection>
      </div>
    </DialogShell>
  )
}
