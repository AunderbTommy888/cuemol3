/**
 * @file features/styles/SelValueField.tsx
 * @description A named selection's expression, edited with `MolSelList` (the
 * same field the Color pane's paint table uses: free text plus the
 * Named / History / builder picker), for the Selections pane rows.
 *
 * Keystrokes only change the draft; the value is committed when the field
 * blurs or a picker entry is chosen (`MolSelList.onCommit`), and Enter blurs
 * to commit. An unchanged commit is dropped so the worker and the selection
 * history are touched only by real edits.
 */

import React, { useCallback, useEffect, useState } from 'react'
import { MolSelList, pushHistory } from '@renderer/h3-kit/MolSelList'
import { isImeKey } from '@renderer/h3-kit/form'

export interface SelValueFieldProps {
    sceneId: number
    value: string
    disabled?: boolean
    onCommit: (value: string) => void
}

export const SelValueField: React.FC<SelValueFieldProps> = ({ sceneId, value, disabled, onCommit }) => {
    const [draft, setDraft] = useState(value)
    // An edit from elsewhere (undo, another surface) replaces the draft.
    useEffect(() => {
        setDraft(value)
    }, [value])

    const commit = useCallback(
        (next: string): void => {
            if (next === value) return
            onCommit(next)
            pushHistory(next)
        },
        [onCommit, value],
    )

    // Enter commits through the blur; Escape abandons the draft first so the
    // blur has nothing to commit. Delete / Backspace stay with the text, not
    // the list row that would delete the definition.
    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLInputElement>): void => {
            if (e.key === 'Enter' && !isImeKey(e.nativeEvent)) {
                e.preventDefault()
                e.currentTarget.blur()
            } else if (e.key === 'Escape') {
                e.preventDefault()
                setDraft(value)
            } else if (e.key === 'Backspace' || e.key === 'Delete') {
                e.stopPropagation()
            }
        },
        [value],
    )

    return (
        <MolSelList
            sceneID={sceneId}
            selectedSel={draft}
            onSelectedSelChange={setDraft}
            onCommit={commit}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            showSelectionIcon={false}
            fill
        />
    )
}
