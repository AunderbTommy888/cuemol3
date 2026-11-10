/**
 * @file dialogs/InteractionAnalysisDialog.tsx
 * @description Modal that finds atom-atom interactions (contacts / hydrogen
 * bonds) within a distance range and labels them with an `atomintr` renderer.
 * Ports the UXP `tools/intr-tool-dlg.xul` + `intr-tool.js` dialog:
 *   - Molecule 1 (`ObjectSelect`) + selection 1 (`MolSelList`).
 *   - Optional molecule 2 (`SwitchField` gate + `ObjectSelect`).
 *   - Optional selection 2 (`SwitchField` gate + `MolSelList`).
 *   - Min / Max distance, Max labels, "Hydrogen bond (N, O) only".
 *   - Target label-set name (defaults to "measure").
 *   - OK commits via the `analyzeInteractions` worker service under one undo
 *     txn; a zero-result analysis reports inline instead of closing.
 *
 * The caller passes only `{ sceneId }`. The last-picked molecules persist
 * within the session because the ids are not reset on open.
 */

import React, { useState } from 'react'
import { useCueMol } from '@renderer/hooks/cuemol/useCueMol'
import { useMolEditCommit } from '@renderer/hooks/cuemol/useMolEditCommit'
import { Field, FieldSection, NumericField, SwitchField, TextField } from '@renderer/h3-kit/form'
import { DialogShell } from './DialogShell'
import { MolPicker } from './MolPicker'
import { MolSelList, pushHistory } from '@renderer/h3-kit/MolSelList'
import { createDialogPrefs, isBool, isNum, isStr } from '@renderer/utils/createDialogPrefs'

export interface InteractionAnalysisDialogResult {
    ok: boolean
    /** Number of labels created. */
    count?: number
    /** Populated when ok=false. */
    error?: string
}

interface Props {
    visible: boolean
    sceneId: number
    onConfirm: (result: InteractionAnalysisDialogResult) => void
    onCancel: () => void
}

const DEFAULT_MIN_DIST = 2.5
const DEFAULT_MAX_DIST = 3.5
const DEFAULT_MAX_LABELS = 30
const DEFAULT_REND_NAME = 'measure'

interface InteractionPrefs {
    selStr: string
    useSel2: boolean
    selStr2: string
    minDist: number
    maxDist: number
    maxLabels: number
    hbondOnly: boolean
}

/**
 * The selections and search parameters, remembered across sessions (UXP
 * persisted only `chk_hbond`; the rest is a tritium addition). The ranges are
 * the ones the numeric fields enforce. The second selection string is kept
 * together with its "use selection" switch; the second-molecule switch is
 * not, since its molecule is only remembered within the session.
 */
const prefs = createDialogPrefs<InteractionPrefs>({
    key: 'cuemol2.ui.histories.intr_tool',
    defaults: {
        selStr: '',
        useSel2: false,
        selStr2: '',
        minDist: DEFAULT_MIN_DIST,
        maxDist: DEFAULT_MAX_DIST,
        maxLabels: DEFAULT_MAX_LABELS,
        hbondOnly: false,
    },
    fields: {
        selStr: isStr,
        useSel2: isBool,
        selStr2: isStr,
        minDist: isNum(0, 20),
        maxDist: isNum(0, 20),
        maxLabels: isNum(1, 1000),
        hbondOnly: isBool,
    },
})

export function InteractionAnalysisDialog({
    visible, sceneId, onConfirm, onCancel,
}: Props): React.JSX.Element {
    const { cm } = useCueMol()

    const [objId, setObjId] = useState<number | undefined>(undefined)
    const [selStr, setSelStr] = useState<string>('')
    const [useMol2, setUseMol2] = useState<boolean>(false)
    const [objId2, setObjId2] = useState<number | undefined>(undefined)
    const [useSel2, setUseSel2] = useState<boolean>(false)
    const [selStr2, setSelStr2] = useState<string>('')
    const [minDist, setMinDist] = useState<number>(DEFAULT_MIN_DIST)
    const [maxDist, setMaxDist] = useState<number>(DEFAULT_MAX_DIST)
    const [maxLabels, setMaxLabels] = useState<number>(DEFAULT_MAX_LABELS)
    const [hbondOnly, setHbondOnly] = useState<boolean>(false)
    const [rendName, setRendName] = useState<string>(DEFAULT_REND_NAME)

    const distInvalid = minDist >= maxDist

    // Search parameters only: the Defaults button leaves the selections alone.
    const applyParams = (p: InteractionPrefs): void => {
        setMinDist(p.minDist)
        setMaxDist(p.maxDist)
        setMaxLabels(p.maxLabels)
        setHbondOnly(p.hbondOnly)
    }

    // Commit handler + submitting/errorMsg state + reset-on-open. Molecule ids
    // are intentionally NOT reset (last-picked persists in-session).
    const { submitting, errorMsg, run: handleOk } =
        useMolEditCommit({
            cm,
            visible,
            onReset: () => {
                const p = prefs.load()
                setSelStr(p.selStr)
                setUseMol2(false)
                setUseSel2(p.useSel2)
                setSelStr2(p.selStr2)
                applyParams(p)
                setRendName(DEFAULT_REND_NAME)
            },
            buildCommit: () => {
                if (objId === undefined) return null
                return {
                    invoke: () => cm!.invokeService('analyzeInteractions', {
                        sceneId,
                        objId,
                        selStr,
                        useMol2,
                        objId2,
                        useSel2,
                        selStr2,
                        minDist,
                        maxDist,
                        maxLabels,
                        hbondOnly,
                        rendName,
                    }),
                    onSuccess: (res) => {
                        if (selStr.trim() !== '') pushHistory(selStr.trim())
                        if ((useMol2 || useSel2) && selStr2.trim() !== '') {
                            pushHistory(selStr2.trim())
                        }
                        prefs.save({
                            selStr, useSel2, selStr2, minDist, maxDist, maxLabels, hbondOnly,
                        })
                        onConfirm({ ok: true, count: res.count })
                    },
                    fallbackError: 'Failed to analyze interactions',
                }
            },
        })

    const okDisabled =
        submitting ||
        objId === undefined ||
        distInvalid ||
        maxLabels <= 0 ||
        (useMol2 && objId2 === undefined)

    return (
        <DialogShell
            visible={visible}
            title="Interaction analysis"
            width="xl"
            onCancel={onCancel}
            onOk={handleOk}
            okDisabled={okDisabled}
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
                        <MolSelList
                            sceneID={sceneId}
                            molID={objId}
                            selectedSel={selStr}
                            onSelectedSelChange={setSelStr}
                            disabled={submitting || objId === undefined}
                        />
                        <Field label="Second molecule" inline>
                            <SwitchField
                                checked={useMol2}
                                onChange={setUseMol2}
                                disabled={submitting || objId === undefined}
                            />
                        </Field>
                        {useMol2 && (
                            <MolPicker
                                cm={cm}
                                sceneId={sceneId}
                                label="Second molecule"
                                selectedId={objId2}
                                onChange={setObjId2}
                            />
                        )}
                        <Field label="Second selection" inline>
                            <SwitchField
                                checked={useSel2}
                                onChange={setUseSel2}
                                disabled={submitting || objId === undefined}
                            />
                        </Field>
                        {(useSel2 || useMol2) && (
                            <MolSelList
                                sceneID={sceneId}
                                molID={useMol2 ? objId2 : objId}
                                selectedSel={selStr2}
                                onSelectedSelChange={setSelStr2}
                                disabled={submitting}
                            />
                        )}
                    </FieldSection>

                    <FieldSection title="Parameters">
                        <Field label="Min distance (A)">
                            <NumericField
                                value={minDist}
                                onChange={setMinDist}
                                min={0}
                                max={20}
                                step={0.1}
                                slider={false}
                                disabled={submitting}
                            />
                        </Field>
                        <Field label="Max distance (A)">
                            <NumericField
                                value={maxDist}
                                onChange={setMaxDist}
                                min={0}
                                max={20}
                                step={0.1}
                                slider={false}
                                disabled={submitting}
                            />
                        </Field>
                        <Field label="Max labels">
                            <NumericField
                                value={maxLabels}
                                onChange={setMaxLabels}
                                min={1}
                                max={1000}
                                step={1}
                                slider={false}
                                disabled={submitting}
                            />
                        </Field>
                        <Field label="Hydrogen bond (N, O) only" inline>
                            <SwitchField
                                checked={hbondOnly}
                                onChange={setHbondOnly}
                                disabled={submitting}
                            />
                        </Field>
                        <Field label="Label set name">
                            <TextField
                                value={rendName}
                                onChange={setRendName}
                                placeholder={DEFAULT_REND_NAME}
                                disabled={submitting}
                            />
                        </Field>
                    </FieldSection>

                    {distInvalid && (
                        <div className="h3-dialog-hint">
                            Min distance must be smaller than max distance.
                        </div>
                    )}
        </DialogShell>
    )
}
