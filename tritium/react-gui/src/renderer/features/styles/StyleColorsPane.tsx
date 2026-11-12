/**
 * @file features/styles/StyleColorsPane.tsx
 * @description Named colours of the style set picked in the Style Sets pane.
 *
 * The same definitions the colour picker's Named list offers, edited in
 * place: each row's colour field writes through `setStyleSetColor` (compiled
 * in the set's scope), so anything painted with the name changes with it.
 */

import React, { useMemo } from 'react'
import { ColorField } from '@renderer/h3-kit/form'
import { ColorPickerProvider } from '@renderer/h3-kit/colorpicker'
import { useCueMol } from '@renderer/hooks/cuemol/useCueMol'
import { useActiveScene } from '@renderer/state/workspace'
import { StyleDefsPane, type StyleDefRow } from './StyleDefsPane'
import { useStyleSetContents, useStyleSets } from './useStyleSets'
import { removeStyleColor, setStyleColor } from './styleOps'

export interface StyleColorsPaneProps {
    collapsed?: boolean
    onToggleCollapse?: () => void
}

/** New colours start white, as in the Style Editor. */
const NEW_COLOR = '#ffffff'

export const StyleColorsPane: React.FC<StyleColorsPaneProps> = ({ collapsed, onToggleCollapse }) => {
    const { cm } = useCueMol()
    const { activeSceneId } = useActiveScene()
    const { active } = useStyleSets(cm, activeSceneId)
    const contents = useStyleSetContents(cm, activeSceneId, active?.uid ?? null)

    const rows = useMemo<StyleDefRow[]>(
        () =>
            (contents?.colors ?? []).map((c) => ({
                name: c.name,
                editor: (disabled: boolean) => (
                    <ColorField
                        value={c.hex}
                        disabled={disabled}
                        onCommit={(v) => {
                            if (active) void setStyleColor(cm, activeSceneId, active, c.name, v)
                        }}
                    />
                ),
            })),
        [contents, cm, activeSceneId, active],
    )

    return (
        <ColorPickerProvider cm={cm} sceneId={activeSceneId}>
            <StyleDefsPane
                title="Colors"
                icon="ui.namedColor"
                noun="color"
                className="style-colors-pane"
                styleSet={active}
                rows={rows}
                onAdd={async (name) => {
                    if (active) await setStyleColor(cm, activeSceneId, active, name, NEW_COLOR)
                }}
                onRemove={async (name) => {
                    if (active) await removeStyleColor(cm, activeSceneId, active, name)
                }}
                collapsed={collapsed}
                onToggleCollapse={onToggleCollapse}
            />
        </ColorPickerProvider>
    )
}
