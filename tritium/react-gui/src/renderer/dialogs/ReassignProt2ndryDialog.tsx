/**
 * @file dialogs/ReassignProt2ndryDialog.tsx
 * @description Modal that recomputes or manually assigns protein secondary
 * structure. Ports the UXP `tools/prot2ndry-tool` dialog:
 *   - Molecule picker (`ObjectSelect`, MolCoord filter).
 *   - Mode (`SegmentField`): Recalculate / Assign.
 *   - Recalculate: Ignore beta bulge + Helix gap-fill angle (deg).
 *   - Assign: atom selection (`MolSelList`) + secondary-structure type select.
 *   - OK commits via the `reassignProt2ndry` worker service under an undo txn.
 *
 * The caller passes only `{ sceneId }`; the molecule persists in-session
 * (objId is not reset on open).
 */

import React, { useState } from 'react'
import { useCueMol } from '@renderer/hooks/cuemol/useCueMol'
import { useMolEditCommit } from '@renderer/hooks/cuemol/useMolEditCommit'
import { Field, FieldSection, NumericField, SegmentField, SelectField, SwitchField } from '@renderer/h3-kit/form'
import { DialogShell } from './DialogShell'
import { MolPicker } from './MolPicker'
import { MolSelList, pushHistory } from '@renderer/h3-kit/MolSelList'
import { createDialogPrefs, isBool, isNum, isOneOf, isStr } from '@renderer/utils/createDialogPrefs'

export interface ReassignProt2ndryDialogResult {
    ok: boolean
    /** Populated when ok=false. */
    error?: string
}

interface Props {
    visible: boolean
    sceneId: number
    onConfirm: (result: ReassignProt2ndryDialogResult) => void
    onCancel: () => void
}

type Mode = 'recalc' | 'assign'

const MODE_OPTIONS: { label: string; value: Mode }[] = [
    { label: 'Recalculate', value: 'recalc' },
    { label: 'Assign', value: 'assign' },
]

interface RecalcParams {
    ignBulge: boolean
    helixGapFill: boolean
    helixAngle: number
}

interface Prot2ndryPrefs extends RecalcParams {
    mode: Mode
    selStr: string
    secType: string
}

/**
 * Remembered across sessions (UXP `prot2ndry-tool` kept mode, sectype,
 * ign bulge and `tgtsel`; the helix gap fill pair is a tritium addition).
 * The selection is kept with the mode so a restored Assign never targets the
 * whole molecule by accident.
 */
const prefs = createDialogPrefs<Prot2ndryPrefs>({
    key: 'cuemol2.ui.histories.prot2ndry_tool',
    defaults: {
        mode: 'recalc',
        selStr: '',
        secType: '0',
        ignBulge: false,
        helixGapFill: false,
        helixAngle: 120,
    },
    fields: {
        mode: isOneOf(MODE_OPTIONS.map((o) => o.value)),
        selStr: isStr,
        secType: isOneOf(['0', '1', '2', '3', '4']),
        ignBulge: isBool,
        helixGapFill: isBool,
        helixAngle: isNum(0, 180),
    },
})

export function ReassignProt2ndryDialog({
    visible, sceneId, onConfirm, onCancel,
}: Props): React.JSX.Element {
    const { cm } = useCueMol()

    const [objId, setObjId] = useState<number | undefined>(undefined)
    const [mode, setMode] = useState<Mode>('recalc')
    const [ignBulge, setIgnBulge] = useState(false)
    const [helixGapFill, setHelixGapFill] = useState(false)
    const [helixAngle, setHelixAngle] = useState(120)
    const [selStr, setSelStr] = useState('')
    const [secType, setSecType] = useState('0')

    // Defaults puts back the recalculation parameters only, not the target.
    const applyParams = (p: RecalcParams): void => {
        setIgnBulge(p.ignBulge)
        setHelixGapFill(p.helixGapFill)
        setHelixAngle(p.helixAngle)
    }

    const recalcDisabled = mode !== 'recalc'
    const assignDisabled = mode !== 'assign'

    // Commit handler + submitting/errorMsg state + reset-on-open, which starts
    // from the remembered options. objId is intentionally NOT reset
    // (last-picked persists in-session).
    const { submitting, errorMsg, run: handleOk } =
        useMolEditCommit({
            cm,
            visible,
            onReset: () => {
                const p = prefs.load()
                setMode(p.mode)
                setSelStr(p.selStr)
                setSecType(p.secType)
                applyParams(p)
            },
            buildCommit: () => {
                if (objId === undefined) return null
                return {
                    invoke: () => cm!.invokeService('reassignProt2ndry',
                        mode === 'recalc'
                            ? {
                                sceneId, objId, mode,
                                ignBulge,
                                helixGapAngle: helixGapFill ? helixAngle : 0,
                            }
                            : {
                                sceneId, objId, mode,
                                selStr,
                                secType: Number(secType),
                            },
                    ),
                    onSuccess: () => {
                        if (mode === 'assign' && selStr.trim() !== '') pushHistory(selStr.trim())
                        prefs.save({ mode, selStr, secType, ignBulge, helixGapFill, helixAngle })
                        onConfirm({ ok: true })
                    },
                    fallbackError: 'Failed to reassign secondary structure',
                }
            },
        })

    return (
        <DialogShell
            visible={visible}
            title="Reassign secondary structure"
            width="xl"
            onCancel={onCancel}
            onOk={handleOk}
            okDisabled={objId === undefined}
            onDefaults={() => applyParams(prefs.defaults)}
            submitting={submitting}
            errorMsg={errorMsg}
        >
                    <FieldSection title="Molecule">
                        <MolPicker
                            cm={cm}
                            sceneId={sceneId}
                            label="Molecule"
                            selectedId={objId}
                            onChange={setObjId}
                        />
                    </FieldSection>

                    <FieldSection title="Mode">
                        <SegmentField<Mode>
                            value={mode}
                            onValueChange={setMode}
                            options={MODE_OPTIONS}
                        />
                    </FieldSection>

                    <FieldSection title="Recalculate">
                        <Field label="Ignore β bulge" inline>
                            <SwitchField
                                checked={ignBulge}
                                onChange={setIgnBulge}
                                disabled={submitting || recalcDisabled}
                            />
                        </Field>
                        <Field label="Helix gap-fill angle (°)" inline>
                            <SwitchField
                                checked={helixGapFill}
                                onChange={setHelixGapFill}
                                disabled={submitting || recalcDisabled}
                            />
                        </Field>
                        <Field label="Angle">
                            <NumericField
                                value={helixAngle}
                                onChange={setHelixAngle}
                                min={0}
                                max={180}
                                disabled={submitting || recalcDisabled || !helixGapFill}
                            />
                        </Field>
                    </FieldSection>

                    <FieldSection title="Assign">
                        <MolSelList
                            sceneID={sceneId}
                            molID={objId}
                            selectedSel={selStr}
                            onSelectedSelChange={setSelStr}
                            disabled={submitting || assignDisabled || objId === undefined}
                        />
                        <Field label="Type">
                            <SelectField
                                value={secType}
                                onChange={setSecType}
                                disabled={submitting || assignDisabled}
                            >
                                <option value="0">Coil</option>
                                <option value="1">β strand</option>
                                <option value="2">α helix</option>
                                <option value="3">3-10 helix</option>
                                <option value="4">π helix</option>
                            </SelectField>
                        </Field>
                    </FieldSection>
        </DialogShell>
    )
}
