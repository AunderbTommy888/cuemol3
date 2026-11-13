/**
 * @file features/styles/StyleSelectionsPane.tsx
 * @description Named selections of the style set picked in the Style Sets
 * pane.
 *
 * The same definitions the Selection pane's Named list offers, edited in
 * place with `MolSelList`: each row's expression is committed on blur, Enter or
 * a picker choice through `setStyleSetSelection`.
 */

import React, { useMemo } from 'react'
import { useCueMol } from '@renderer/hooks/cuemol/useCueMol'
import { useActiveScene } from '@renderer/state/workspace'
import { StyleDefsPane, type StyleDefRow } from './StyleDefsPane'
import { SelValueField } from './SelValueField'
import { useStyleSetContents, useStyleSets } from './useStyleSets'
import { removeStyleSelection, setStyleSelection } from './styleOps'

export interface StyleSelectionsPaneProps {
    collapsed?: boolean
    onToggleCollapse?: () => void
}

/** New selections start as "everything", as in the Style Editor. */
const NEW_SELECTION = '*'

export const StyleSelectionsPane: React.FC<StyleSelectionsPaneProps> = ({
    collapsed,
    onToggleCollapse,
}) => {
    const { cm } = useCueMol()
    const { activeSceneId } = useActiveScene()
    const { active } = useStyleSets(cm, activeSceneId)
    const contents = useStyleSetContents(cm, activeSceneId, active?.uid ?? null)

    const rows = useMemo<StyleDefRow[]>(
        () =>
            (contents?.selections ?? []).map((s) => ({
                name: s.name,
                editor: (disabled: boolean) => (
                    <SelValueField
                        sceneId={activeSceneId ?? 0}
                        value={s.value}
                        disabled={disabled}
                        onCommit={(v) => {
                            if (active) void setStyleSelection(cm, activeSceneId, active, s.name, v)
                        }}
                    />
                ),
            })),
        [contents, cm, activeSceneId, active],
    )

    return (
        <StyleDefsPane
            title="Selections"
            icon="ui.namedSel"
            noun="selection"
            className="style-sels-pane"
            styleSet={active}
            rows={rows}
            onAdd={async (name) => {
                if (active) await setStyleSelection(cm, activeSceneId, active, name, NEW_SELECTION)
            }}
            onRemove={async (name) => {
                if (active) await removeStyleSelection(cm, activeSceneId, active, name)
            }}
            collapsed={collapsed}
            onToggleCollapse={onToggleCollapse}
        />
    )
}
