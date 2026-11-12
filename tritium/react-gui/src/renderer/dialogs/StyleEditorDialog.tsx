/**
 * @file dialogs/StyleEditorDialog.tsx
 * @description Style entries of one style set (what is left of UXP
 * `style/style_editor.xul`): the list of styles the set defines, each with a
 * Delete button.
 *
 * UXP's editor had three tabs. The named colours and named selections are
 * edited in the Colors and Selections panes of the Styles view now, so only
 * the style entries remain here. A delete is applied at once (one undo step,
 * through `removeStyleSetStyle`) and the list is refetched after it; the
 * dialog has only a Close button. A read-only set is view-only.
 */

import React, { useCallback, useEffect, useState } from 'react'
import { Button } from '@blueprintjs/core'
import { DialogShell } from './DialogShell';
import { useCueMol } from '@renderer/hooks/cuemol/useCueMol'
import { AppIcon } from '@renderer/h3-kit/primitives'
import { Listbox, ListRow } from '@renderer/h3-kit/list'
import type { GetStyleSetContentsResult } from '@renderer/worker/server/services/style/styleSetEdit'

interface Props {
    visible: boolean
    styleSetId: number
    sceneId: number
    styleName: string
    onClose: () => void
}

export function StyleEditorDialog({
    visible,
    styleSetId,
    sceneId,
    styleName,
    onClose,
}: Props): React.JSX.Element {
    const { cm } = useCueMol()
    const [contents, setContents] = useState<GetStyleSetContentsResult | null>(null)

    const refetch = useCallback(() => {
        if (!cm) return
        cm.invokeService('getStyleSetContents', { styleSetId })
            .then((r) => setContents(r?.ok ? r : null))
            .catch(() => setContents(null))
    }, [cm, styleSetId])

    useEffect(() => {
        if (visible) refetch()
    }, [visible, refetch])

    const ro = contents?.readonly ?? false
    const styles = contents?.styles ?? []

    const removeStyle = (name: string): void => {
        if (!cm) return
        cm.invokeService('removeStyleSetStyle', { sceneId, styleSetId, name })
            .then(refetch)
            .catch(() => undefined)
    }

    return (
        <DialogShell
            visible={visible}
            title={`Style entries: ${styleName}`}
            width="xl"
            onCancel={onClose}
            // Nothing to commit: a delete applies at once, so the one button
            // dismisses rather than confirming.
            footerActions={
                <Button intent="primary" onClick={onClose}>
                    Close
                </Button>
            }
        >
            {ro && <div className="type-caption">(read-only style set)</div>}
            {styles.length === 0 ? (
                <div className="h3-list-empty">(no style entries)</div>
            ) : (
                <Listbox framed>
                    {styles.map((s) => (
                        <ListRow key={s.name}>
                            <span className="style-entry-name type-row">{s.name}</span>
                            <span className="style-entry-type type-caption">{s.type}</span>
                            <Button
                                minimal
                                small
                                aria-label={`Delete style ${s.name}`}
                                disabled={ro}
                                icon={<AppIcon name="ui.trash" aria-hidden />}
                                onClick={() => removeStyle(s.name)}
                            />
                        </ListRow>
                    ))}
                </Listbox>
            )}
        </DialogShell>
    )
}
