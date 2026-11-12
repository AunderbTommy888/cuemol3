/**
 * @file features/styles/StyleSetsPane.tsx
 * @description The style sets the active scene can see -- the scene's own,
 * then the global ones, which is the order a name is looked up in -- as a list
 * with its own toolbar.
 *
 * UXP kept them as the last branch of the workspace tree, with every
 * operation behind a right-click. Here they get a pane of their own in the
 * Styles view, and the selected row is the set the Colors and Selections panes
 * below edit. A read-only set shows a lock; one loaded from a file
 * shows a link. Double-click opens the style-entries dialog (the part of a set
 * the panes below do not cover).
 */

import React, { useCallback, useRef } from 'react'
import { Button, ButtonGroup } from '@blueprintjs/core'
import { AppIcon, Tooltip } from '@renderer/h3-kit/primitives'
import { Listbox, ListRow, scrollRowIntoView, useListKeyNav } from '@renderer/h3-kit/list'
import { PaneSectionHeader } from '@renderer/shell/PaneSectionHeader'
import { useCueMol } from '@renderer/hooks/cuemol/useCueMol'
import { useActiveScene } from '@renderer/state/workspace'
import { useCommands } from '@renderer/commands/CommandRegistry'
import { useClipboardScope } from '@renderer/hooks/useClipboardScope'
import { CmdId } from '@renderer/commands/ids'
import type { StyleSetEntry } from '@renderer/worker/shared/styleSetTypes'
import { selectStyleSet, useStyleSets } from './useStyleSets'
import { useStyleCtxMenu } from './useStyleCtxMenu'
import { styleSetLabel } from './styleCtxActionToCommand'

export interface StyleSetsPaneProps {
    collapsed?: boolean
    onToggleCollapse?: () => void
}

/**
 * Whether the set's contents can be edited: its read-only flag alone. The
 * bundled global sets and the dot-directory styles are read-only; the "user"
 * set (global, saved on exit) and the scene's own sets are not.
 */
const isLocked = (s: StyleSetEntry): boolean => s.readonly

export const StyleSetsPane: React.FC<StyleSetsPaneProps> = ({ collapsed, onToggleCollapse }) => {
    const { cm } = useCueMol()
    const { activeSceneId } = useActiveScene()
    const { dispatch } = useCommands()
    const { styleSets, active } = useStyleSets(cm, activeSceneId)
    const bodyRef = useRef<HTMLDivElement | null>(null)
    const openMenu = useStyleCtxMenu()
    const hasScene = activeSceneId !== undefined

    /** Run a command, keeping a rejection out of the render path. */
    const run = useCallback((what: string, p: Promise<unknown>): void => {
        p.catch((err: unknown) => console.warn(`${what} failed:`, err))
    }, [])

    const ref = (s: StyleSetEntry) => ({ id: String(s.uid), scopeId: s.scopeId })

    const deleteSet = useCallback(
        (s: StyleSetEntry) => {
            if (s.scopeId === 0) return
            run('delete style', dispatch(CmdId.StyleDelete, ref(s)))
        },
        [dispatch, run],
    )

    const editSet = useCallback(
        (s: StyleSetEntry) => {
            run('edit style', dispatch(CmdId.StyleEdit, { ...ref(s), name: styleSetLabel(s) }))
        },
        [dispatch, run],
    )

    const newSet = useCallback(() => {
        run(
            'new style',
            dispatch(CmdId.StyleNew).then((uid) => {
                if (uid !== null && uid !== undefined) selectStyleSet(uid)
            }),
        )
    }, [dispatch, run])

    const ids = styleSets.map((s) => String(s.uid))
    const navKeyDown = useListKeyNav({
        items: ids,
        activeId: active ? String(active.uid) : null,
        onSelect: (id) => selectStyleSet(Number(id)),
        onScrollTo: (id) => scrollRowIntoView(bodyRef.current, `[data-style-uid="${CSS.escape(id)}"]`),
    })

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (navKeyDown(e)) return
            if ((e.key === 'Delete' || e.key === 'Backspace') && active) {
                e.preventDefault()
                deleteSet(active)
            }
        },
        [navKeyDown, active, deleteSet],
    )

    // Edit > Cut / Copy / Paste while the pane is where the user is working.
    useClipboardScope('style-list', {
        copy: () => {
            if (active && active.scopeId !== 0) run('copy style', dispatch(CmdId.StyleCopy, ref(active)))
        },
        paste: () => run('paste style', dispatch(CmdId.StylePaste)),
        cut: () => {
            if (!active || active.scopeId === 0) return
            // Delete only once the copy is on the clipboard, so a failed
            // write cannot lose the set (same rule as the tree).
            const target = active
            run(
                'cut style',
                dispatch(CmdId.StyleCopy, ref(target)).then((ok) =>
                    ok ? dispatch(CmdId.StyleDelete, ref(target)) : undefined,
                ),
            )
        },
    })

    return (
        <div className="sp-pane style-sets-pane">
            <PaneSectionHeader
                title="Style Sets"
                icon="node.style"
                collapsed={collapsed}
                onToggleCollapse={onToggleCollapse}
                actions={
                    <ButtonGroup minimal>
                        <Tooltip content="New style set" placement="bottom">
                            <Button
                                minimal
                                small
                                icon={<AppIcon name="ui.add" aria-hidden />}
                                className="section-action-btn"
                                disabled={!hasScene}
                                onClick={newSet}
                            />
                        </Tooltip>
                        <Tooltip content="Load style file" placement="bottom">
                            <Button
                                minimal
                                small
                                icon={<AppIcon name="ui.folder" aria-hidden />}
                                className="section-action-btn"
                                disabled={!hasScene}
                                onClick={() => run('load style', dispatch(CmdId.StyleLoadFromFile))}
                            />
                        </Tooltip>
                        <Tooltip content="Style entries" placement="bottom">
                            <Button
                                minimal
                                small
                                icon={<AppIcon name="ui.edit" aria-hidden />}
                                className="section-action-btn"
                                disabled={!active}
                                onClick={() => active && editSet(active)}
                            />
                        </Tooltip>
                        <Tooltip content="Delete" placement="bottom">
                            <Button
                                minimal
                                small
                                icon={<AppIcon name="ui.trash" aria-hidden />}
                                className="section-action-btn"
                                disabled={!active || active.scopeId === 0}
                                onClick={() => active && deleteSet(active)}
                            />
                        </Tooltip>
                    </ButtonGroup>
                }
            />
            {!collapsed && (
                // tabIndex=-1 keeps the wrapper focusable for the list keys
                // without putting it in the Tab order.
                <div
                    ref={bodyRef}
                    className="sp-pane-scroll style-pane-body"
                    tabIndex={-1}
                    data-clipboard-scope="style-list"
                    onKeyDown={handleKeyDown}
                    onContextMenu={(e) => {
                        // Empty space below the rows: the root menu.
                        if (e.target !== e.currentTarget) return
                        e.preventDefault()
                        void openMenu(null, e.clientX, e.clientY)
                    }}
                    style={{ outline: 'none' }}
                >
                    {styleSets.length === 0 ? (
                        <div className="h3-list-empty">(no style sets)</div>
                    ) : (
                        <Listbox>
                            {styleSets.map((s) => (
                                <ListRow
                                    key={s.uid}
                                    selected={s.uid === active?.uid}
                                    data-style-uid={s.uid}
                                    onClick={() => selectStyleSet(s.uid)}
                                    onDoubleClick={() => editSet(s)}
                                    onContextMenu={(e) => {
                                        e.preventDefault()
                                        selectStyleSet(s.uid)
                                        void openMenu(s, e.clientX, e.clientY)
                                    }}
                                >
                                    <AppIcon name="node.style" aria-hidden />
                                    <span className="style-row-name type-row">{styleSetLabel(s)}</span>
                                    {s.scopeId === 0 && (
                                        <span className="style-row-scope type-caption">global</span>
                                    )}
                                    {isLocked(s) && (
                                        <AppIcon
                                            name="ui.lock"
                                            size="sm"
                                            className="style-row-badge"
                                            title="Read-only"
                                            aria-hidden
                                        />
                                    )}
                                    {s.src !== '' && (
                                        <AppIcon
                                            name="ui.link"
                                            size="sm"
                                            className="style-row-badge"
                                            title={s.src}
                                            aria-hidden
                                        />
                                    )}
                                </ListRow>
                            ))}
                        </Listbox>
                    )}
                </div>
            )}
        </div>
    )
}
