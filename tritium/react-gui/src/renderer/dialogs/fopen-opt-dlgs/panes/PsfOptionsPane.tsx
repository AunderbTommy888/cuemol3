/**
 * @file dialogs/fopen-opt-dlgs/panes/PsfOptionsPane.tsx
 * @description Option pane for PSF topology files, the same shape as the
 * AMBER prmtop pane: the PSF is the main stream (topology) and an optional
 * NAMD binary coordinate file (.coor) is attached as the reader's "coord"
 * sub-stream. Leaving the path empty performs a topology-only load (atoms at
 * the origin), ready for coordinates or a trajectory to be attached.
 */
import React, { useCallback } from 'react';
import { Field, FieldSection, FormButton, TextField } from '@renderer/h3-kit/form';
import type { PsfOptions } from '@renderer/dialogs/fopen-opt-dlgs/types';
import { IPC } from '@shared/ipcChannels';

interface PsfOptionsPaneProps {
  options: PsfOptions;
  onChange: (updated: PsfOptions) => void;
}

export const PsfOptionsPane: React.FC<PsfOptionsPaneProps> = ({ options, onChange }) => {
  const handleBrowse = useCallback(async () => {
    try {
      const res = await window.electronAPI?.invoke(IPC.DIALOG_PICK_PATH, {
        title: 'Select NAMD coordinate file',
        filters: [
          { name: 'NAMD coordinates', extensions: ['coor'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });
      if (res && !res.canceled && res.filePath) onChange({ coordFilePath: res.filePath });
    } catch {
      /* dialog unavailable (e.g. Vite dev server) -- ignore */
    }
  }, [onChange]);

  return (
    <div className="fod-section">
      <FieldSection title="Coordinates">
        <Field label="Coordinate file (.coor)">
          <div className="fod-path-row">
            <TextField
              value={options.coordFilePath}
              placeholder="/path/to/system.coor"
              onChange={(v) => onChange({ coordFilePath: v })}
            />
            <FormButton text="Change..." onClick={handleBrowse} />
          </div>
        </Field>
        <div className="fod-hint">Optional. Leave empty to load topology only (atoms at zero).</div>
      </FieldSection>
    </div>
  );
};
