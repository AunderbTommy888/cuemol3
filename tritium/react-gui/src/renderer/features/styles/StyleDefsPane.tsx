/**
 * @file features/styles/StyleDefsPane.tsx
 * @description The frame the Colors and Selections panes share: the named
 * definitions of the style set picked in the Style Sets pane, one row each
 * (name, then an editor for the value), with Add / Delete in the header.
 *
 * Each edit is applied at once (one undo step for a scene's set; an edit to
 * the global "user" set is not undoable, C++ keeps no undo for global sets);
 * the rows follow the `SEM_STYLE` events rather than refetching after a call.
 * A read-only set is shown but cannot be edited.
 */

import React, { useCallback, useRef, useState } from 'react'
import { Button, ButtonGroup } from '@blueprintjs/core'
import { AppIcon, Tooltip } from '@renderer/h3-kit/primitives'
import type { AppIconKey } from '@renderer/h3-kit/primitives'
import { Listbox, ListRow, scrollRowIntoView, useListKeyNav } from '@renderer/h3-kit/list'
import { PaneSectionHeader } from '@renderer/shell/PaneSectionHeader'
import { useShowTextPromptDialog } from '@renderer/dialogs/TextPromptDialogProvider'
import type { StyleSetEntry } from '@renderer/worker/shared/styleSetTypes'
import { styleSetLabel } from './styleCtxActionToCommand'

/** One named definition and the control that edits its value. */
export interface StyleDefRow {
    name: string
    editor: (disabled: boolean) => React.ReactNode
}

export interface StyleDefsPaneProps {
    title: string
    icon: AppIconKey
    /** What one definition is called in prompts and tooltips ("color"). */
    noun: string
    className: string
    /** The set being edited, or null when the scene has none. */
    styleSet: StyleSetEntry | null
    rows: StyleDefRow[]
    /** Create a definition named `name` with its default value. */
    onAdd: (name: string) => Promise<unknown>
    onRemove: (name: string) => Promise<unknown>
    collapsed?: boolean
    onToggleCollapse?: () => void
}

export const StyleDefsPane: React.FC<StyleDefsPaneProps> = ({
    title,
    icon,
    noun,
    className,
    styleSet,
    rows,
    onAdd,
    onRemove,
    collapsed,
    onToggleCollapse,
}) => {
    const showTextPrompt = useShowTextPromptDialog()
    const [selected, setSelected] = useState<string | null>(null)
    const bodyRef = useRef<HTMLDivElement | null>(null)

    const names = rows.map((r) => r.name)
    // A definition can go away under the selection (deleted, set switched).
    const active = selected !== null && names.includes(selected) ? selected : null
    const locked = !styleSet || styleSet.readonly

    const run = useCallback((what: string, p: Promise<unknown>): void => {
        p.catch((err: unknown) => console.warn(`${what} failed:`, err))
    }, [])

    const add = useCallback(async () => {
        const entered = await showTextPrompt({
            title: `New ${noun}`,
            label: `Name for new ${noun}:`,
            defaultValue: '',
            confirmLabel: 'Add',
        })
        const name = entered?.trim()
        if (!name) return
        await onAdd(name)
        setSelected(name)
    }, [showTextPrompt, noun, onAdd])

    const remove = useCallback(
        (name: string) => run(`remove ${noun}`, onRemove(name)),
        [run, noun, onRemove],
    )

    const navKeyDown = useListKeyNav({
        items: names,
        activeId: active,
        onSelect: setSelected,
        onScrollTo: (id) => scrollRowIntoView(bodyRef.current, `[data-def-name="${CSS.escape(id)}"]`),
    })

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            // Keys typed into a row's editor belong to the editor.
            if (e.target !== e.currentTarget) return
            if (navKeyDown(e)) return
            if ((e.key === 'Delete' || e.key === 'Backspace') && active && !locked) {
                e.preventDefault()
                remove(active)
            }
        },
        [navKeyDown, active, locked, remove],
    )

    return (
        <div className={`sp-pane ${className}`}>
            <PaneSectionHeader
                title={title}
                icon={icon}
                collapsed={collapsed}
                onToggleCollapse={onToggleCollapse}
                actions={
                    <ButtonGroup minimal>
                        <Tooltip content={`Add ${noun}`} placement="bottom">
                            <Button
                                minimal
                                small
                                icon={<AppIcon name="ui.add" aria-hidden />}
                                className="section-action-btn"
                                disabled={locked}
                                onClick={() => run(`add ${noun}`, add())}
                            />
                        </Tooltip>
                        <Tooltip content="Delete" placement="bottom">
                            <Button
                                minimal
                                small
                                icon={<AppIcon name="ui.trash" aria-hidden />}
                                className="section-action-btn"
                                disabled={locked || active === null}
                                onClick={() => active && remove(active)}
                            />
                        </Tooltip>
                    </ButtonGroup>
                }
            />
            {!collapsed && (
                <div
                    ref={bodyRef}
                    className="sp-pane-scroll style-pane-body"
                    tabIndex={-1}
                    onKeyDown={handleKeyDown}
                    style={{ outline: 'none' }}
                >
                    {styleSet && (
                        <div className="style-defs-target type-caption">
                            {styleSetLabel(styleSet)}
                            {locked && ' (read-only)'}
                        </div>
                    )}
                    {rows.length === 0 ? (
                        <div className="h3-list-empty">(no named {noun}s)</div>
                    ) : (
                        <Listbox>
                            {rows.map((r) => (
                                <ListRow
                                    key={r.name}
                                    selected={r.name === active}
                                    data-def-name={r.name}
                                    onClick={() => setSelected(r.name)}
                                >
                                    <span className="style-def-name type-row" title={r.name}>
                                        {r.name}
                                    </span>
                                    <span className="style-def-value">{r.editor(locked)}</span>
                                </ListRow>
                            ))}
                        </Listbox>
                    )}
                </div>
            )}
        </div>
    )
}
