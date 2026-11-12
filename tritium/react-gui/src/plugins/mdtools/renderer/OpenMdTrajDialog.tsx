/**
 * @file plugins/mdtools/renderer/OpenMdTrajDialog.tsx
 * @description "Open MD Trajectory" dialog -- step 1 of the two-step trajectory
 * open flow. It COLLECTS a topology file (GROMACS .gro) plus an ordered list of
 * trajectory files (.dcd/.xtc/.trr); it does NOT load anything. The command
 * runs the actual (deferred) load only after the follow-up renderer dialog is
 * confirmed, so cancelling either dialog loads nothing (matching the normal
 * load-object flow).
 *
 * Files are collected in-dialog via native pickers (topology = single-select,
 * trajectory = multi-select) because the input is a set, not a single path.
 * Trajectory order is significant (frames concatenate in list order), hence the
 * Up/Down reordering controls (add/remove/move logic mirrors ApplyRendStyleDialog).
 */

import React, { useEffect, useMemo, useState } from 'react';
import { DialogShell } from '@renderer/plugin-host/api';
import { Field, FieldSection, ComboBoxField, SliderField, ButtonRow, FormButton } from '@renderer/h3-kit/form';
import { IPC } from '@shared/ipcChannels';
import { getLastTopologyPath, setLastTopologyPath } from './trajPathHistory';
import { TrajFileListSection } from './TrajFileListSection';

export interface OpenMdTrajResult {
    /** Topology file (GROMACS .gro). */
    topologyPath: string;
    /** Trajectory files (.dcd/.xtc/.trr) in frame-concatenation order. */
    trajPaths: string[];
    /** Load every Nth frame (1 = every frame). */
    nevery: number;
}

interface Props {
    visible: boolean;
    onConfirm: (result: OpenMdTrajResult) => void;
    onCancel: () => void;
}

const TOPOLOGY_FILTERS = [
    { name: 'GROMACS topology (*.gro)', extensions: ['gro'] },
    { name: 'All Files', extensions: ['*'] },
];

export function OpenMdTrajDialog({ visible, onConfirm, onCancel }: Props): React.JSX.Element {
    const [topologyPath, setTopologyPath] = useState('');
    const [trajPaths, setTrajPaths] = useState<string[]>([]);
    const [nevery, setNevery] = useState(1);

    // Seed state each time the dialog opens: topology from history, an empty
    // trajectory list, stride reset to 1.
    useEffect(() => {
        if (!visible) return;
        setTopologyPath(getLastTopologyPath() ?? '');
        setTrajPaths([]);
        setNevery(1);
    }, [visible]);

    const topoOptions = useMemo(() => {
        const last = getLastTopologyPath();
        return last ? [last] : [];
    }, [visible]);

    const browseTopology = async (): Promise<void> => {
        try {
            const res = await window.electronAPI?.invoke(IPC.DIALOG_PICK_PATH, {
                title: 'Select topology file',
                filters: TOPOLOGY_FILTERS,
            });
            if (res && !res.canceled && res.filePath) {
                setTopologyPath(res.filePath);
                setLastTopologyPath(res.filePath);
            }
        } catch {
            /* dialog unavailable (e.g. Vite dev server) -- ignore */
        }
    };

    const canOpen = topologyPath.trim().length > 0 && trajPaths.length > 0;

    const handleOk = (): void => {
        if (!canOpen) return;
        onConfirm({ topologyPath: topologyPath.trim(), trajPaths, nevery });
    };

    return (
        <DialogShell
            visible={visible}
            title="Open MD Trajectory"
            width="2xl"
            okLabel="Open"
            okDisabled={!canOpen}
            onOk={handleOk}
            onCancel={onCancel}
        >
            {/* Wider inter-section gap than the default form-section-gap so the
                three meaning-units (topology / files / sampling) read apart. */}
            <div className="omt-traj-sections">
            <FieldSection title="Topology">
                <Field label="Topology file (.gro)">
                    <ComboBoxField
                        value={topologyPath}
                        onChange={setTopologyPath}
                        options={topoOptions}
                        placeholder="/path/to/system.gro"
                        emptyText="No recent files"
                    />
                </Field>
                <ButtonRow>
                    <FormButton text="Browse..." onClick={browseTopology} />
                </ButtonRow>
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
    );
}
