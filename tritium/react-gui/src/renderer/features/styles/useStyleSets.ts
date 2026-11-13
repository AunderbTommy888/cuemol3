/**
 * @file features/styles/useStyleSets.ts
 * @description Data hooks of the Styles view: the style sets the active
 * scene can see, the one the view is working on, and that set's contents.
 *
 * The three panes are mounted separately by the sidebar, so the choice of set
 * lives in a module store (`selectedStyleSet`) rather than in a provider. Each
 * hook keeps itself current from `SEM_STYLE` events, so a set created, loaded,
 * edited or undone by any path shows up without a manual refetch.
 */

import { useMemo, useSyncExternalStore } from 'react'
import type { AsyncCueMol } from '@renderer/worker/client/AsyncCueMol'
import type { StyleSetEntry } from '@renderer/worker/shared/styleSetTypes'
import type { GetStyleSetContentsResult } from '@renderer/worker/server/services/style/styleSetEdit'
import { SEM_ANY, SEM_CHANGED, SEM_SCENE, SEM_STYLE } from '@renderer/event'
import { useLiveFetch, type LiveFetchListener } from '@renderer/hooks/cuemol/useLiveFetch'
import { useLatestRef } from '@renderer/hooks/react/useLatestRef'
import { EVENT_BURST_DEBOUNCE_MS } from '@renderer/utils/timing'
import { getStyleSetContents, listStyleSets } from './styleOps'

// --- The set the view works on (shared by the three panes) ---

let selectedUid: number | null = null
const subscribers = new Set<() => void>()

/** Make `uid` the set the Colors / Selections panes show. */
export function selectStyleSet(uid: number | null): void {
    if (uid === selectedUid) return
    selectedUid = uid
    for (const fn of subscribers) fn()
}

function subscribeSelected(fn: () => void): () => void {
    subscribers.add(fn)
    return () => subscribers.delete(fn)
}

const getSelected = (): number | null => selectedUid

/**
 * The set to show when the user has not picked one that still exists: the
 * scene's first writable set, else its first set, else the first global one.
 */
export function defaultStyleSet(sets: readonly StyleSetEntry[]): StyleSetEntry | null {
    const local = sets.filter((s) => s.scopeId !== 0)
    return local.find((s) => !s.readonly) ?? local[0] ?? sets[0] ?? null
}

function styleListeners(sceneId: number | undefined): LiveFetchListener[] {
    return [
        {
            enabled: sceneId !== undefined,
            srcMask: SEM_STYLE,
            evtMask: SEM_ANY,
            scopeId: sceneId ?? -1,
            debounceMs: EVENT_BURST_DEBOUNCE_MS,
        },
        // A loaded or cleared scene replaces its local sets.
        {
            enabled: sceneId !== undefined,
            srcMask: SEM_SCENE,
            evtMask: SEM_CHANGED,
            scopeId: sceneId ?? -1,
            debounceMs: EVENT_BURST_DEBOUNCE_MS,
        },
    ]
}

const NO_SETS: StyleSetEntry[] = []

export interface UseStyleSetsResult {
    styleSets: StyleSetEntry[]
    /** The set the view works on (the picked one, or the default). */
    active: StyleSetEntry | null
}

/** The style sets visible from `sceneId`, and which one the view is on. */
export function useStyleSets(cm: AsyncCueMol | null, sceneId: number | undefined): UseStyleSetsResult {
    const sceneIdRef = useLatestRef(sceneId)
    const { state: styleSets } = useLiveFetch<StyleSetEntry[]>({
        cm,
        initial: NO_SETS,
        fallback: NO_SETS,
        fetch: () => {
            const sid = sceneIdRef.current
            if (!cm || sid === undefined) return null
            return listStyleSets(cm, sid)
        },
        onError: (err) => console.warn('listStyleSets failed:', err),
        fetchDeps: [sceneId],
        listeners: styleListeners(sceneId),
    })
    const picked = useSyncExternalStore(subscribeSelected, getSelected)
    const active = useMemo(
        () => styleSets.find((s) => s.uid === picked) ?? defaultStyleSet(styleSets),
        [styleSets, picked],
    )
    return { styleSets, active }
}

/** Named colours / selections / styles of `styleSetId` (null: none). */
export function useStyleSetContents(
    cm: AsyncCueMol | null,
    sceneId: number | undefined,
    styleSetId: number | null,
): GetStyleSetContentsResult | null {
    const idRef = useLatestRef(styleSetId)
    const { state } = useLiveFetch<GetStyleSetContentsResult | null>({
        cm,
        initial: null,
        fallback: null,
        fetch: () => {
            const id = idRef.current
            if (!cm || id === null) return null
            return getStyleSetContents(cm, id)
        },
        onError: (err) => console.warn('getStyleSetContents failed:', err),
        fetchDeps: [styleSetId],
        listeners: styleListeners(sceneId),
    })
    return state
}
