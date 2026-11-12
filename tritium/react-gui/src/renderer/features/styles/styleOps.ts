/**
 * @file features/styles/styleOps.ts
 * @description Renderer-side calls behind the Styles view: one function per
 * worker service, each a no-op without a CueMol instance or an active scene.
 *
 * Every edit is one undo step of the active scene (the worker wraps it); the
 * panes do not refetch after a call, they follow the `SEM_STYLE` events.
 */

import type { AsyncCueMol } from '@renderer/worker/client/AsyncCueMol'
import type { StyleSetEntry } from '@renderer/worker/shared/styleSetTypes'
import type { GetStyleSetContentsResult } from '@renderer/worker/server/services/style/styleSetEdit'
import { readSceneClip, writeSceneClip } from '@renderer/hooks/sceneTree/sceneClipIo'

/** The scene's own style sets, then the global ones (lookup order). */
export async function listStyleSets(cm: AsyncCueMol, sceneId: number): Promise<StyleSetEntry[]> {
    const res = await cm.invokeService('listStyleSets', { sceneId })
    return res?.ok ? res.styleSets : []
}

/** Named colours, selections and style entries of one set, or null. */
export async function getStyleSetContents(
    cm: AsyncCueMol,
    styleSetId: number,
): Promise<GetStyleSetContentsResult | null> {
    const res = await cm.invokeService('getStyleSetContents', { styleSetId })
    return res?.ok ? res : null
}

/** Create a scene-local set; resolves to its uid, or null. */
export async function createStyleSet(
    cm: AsyncCueMol | null,
    sceneId: number | undefined,
    name: string,
): Promise<number | null> {
    if (!cm || sceneId === undefined) return null
    const res = await cm.invokeService('createStyleSet', { sceneId, name })
    return res?.ok ? res.newId : null
}

export async function destroyStyleSet(
    cm: AsyncCueMol | null,
    sceneId: number | undefined,
    styleSetId: number,
    scopeId: number,
): Promise<boolean> {
    if (!cm || sceneId === undefined) return false
    const res = await cm.invokeService('destroyStyleSet', { sceneId, scopeId, styleSetId })
    return res?.ok === true
}

export async function toggleStyleSetReadOnly(
    cm: AsyncCueMol | null,
    sceneId: number | undefined,
    styleSetId: number,
    scopeId: number,
): Promise<boolean> {
    if (!cm || sceneId === undefined) return false
    const res = await cm.invokeService('toggleStyleSetReadOnly', { sceneId, scopeId, styleSetId })
    return res?.ok === true
}

export async function loadStyleSetFromFile(
    cm: AsyncCueMol | null,
    sceneId: number | undefined,
    path: string,
): Promise<boolean> {
    if (!cm || sceneId === undefined) return false
    const res = await cm.invokeService('loadStyleSetFromFile', { sceneId, path })
    return res?.ok === true
}

export async function saveStyleSetToFile(
    cm: AsyncCueMol | null,
    sceneId: number | undefined,
    styleSetId: number,
    scopeId: number,
    path: string,
): Promise<boolean> {
    if (!cm || sceneId === undefined) return false
    const res = await cm.invokeService('saveStyleSetToFile', { sceneId, scopeId, styleSetId, path })
    return res?.ok === true
}

/**
 * Save a set back to the file it came from.
 *
 * @returns `saved: false` with `ok: true` when the set has no source file,
 *   so the caller can fall through to Save As.
 */
export async function saveStyleSetToCurrentSrc(
    cm: AsyncCueMol | null,
    sceneId: number | undefined,
    styleSetId: number,
    scopeId: number,
): Promise<{ ok: boolean; saved: boolean }> {
    if (!cm || sceneId === undefined) return { ok: false, saved: false }
    const res = await cm.invokeService('saveStyleSetToCurrentSrc', { sceneId, scopeId, styleSetId })
    return { ok: res?.ok === true, saved: res?.saved === true }
}

/** Copy a set to the clipboard (global sets are refused by the worker). */
export async function copyStyleSet(
    cm: AsyncCueMol | null,
    sceneId: number | undefined,
    styleSetId: number,
    scopeId: number,
): Promise<boolean> {
    if (!cm || sceneId === undefined) return false
    const res = await cm.invokeService('copyNode', {
        sceneId,
        nodeId: styleSetId,
        nodeType: 'style',
        scopeId,
    })
    return writeSceneClip(res)
}

/** Paste a copied set into the scene (renamed when the name is taken). */
export async function pasteStyleSet(
    cm: AsyncCueMol | null,
    sceneId: number | undefined,
): Promise<boolean> {
    if (!cm || sceneId === undefined) return false
    const clip = await readSceneClip()
    if (!clip || clip.kind !== 'style') return false
    const res = await cm.invokeService('pasteNode', { sceneId, ...clip })
    return res?.ok === true
}

/** Add or change a named colour (`colorStr` is compiled in the set's scope). */
export async function setStyleColor(
    cm: AsyncCueMol | null,
    sceneId: number | undefined,
    set: StyleSetEntry,
    name: string,
    colorStr: string,
): Promise<boolean> {
    if (!cm || sceneId === undefined) return false
    const res = await cm.invokeService('setStyleSetColor', {
        sceneId,
        styleSetId: set.uid,
        scopeId: set.scopeId,
        name,
        colorStr,
    })
    return res?.ok === true
}

export async function removeStyleColor(
    cm: AsyncCueMol | null,
    sceneId: number | undefined,
    set: StyleSetEntry,
    name: string,
): Promise<boolean> {
    if (!cm || sceneId === undefined) return false
    const res = await cm.invokeService('removeStyleSetColor', { sceneId, styleSetId: set.uid, name })
    return res?.ok === true
}

/** Add or change a named selection. */
export async function setStyleSelection(
    cm: AsyncCueMol | null,
    sceneId: number | undefined,
    set: StyleSetEntry,
    name: string,
    value: string,
): Promise<boolean> {
    if (!cm || sceneId === undefined) return false
    const res = await cm.invokeService('setStyleSetSelection', {
        sceneId,
        styleSetId: set.uid,
        name,
        value,
    })
    return res?.ok === true
}

export async function removeStyleSelection(
    cm: AsyncCueMol | null,
    sceneId: number | undefined,
    set: StyleSetEntry,
    name: string,
): Promise<boolean> {
    if (!cm || sceneId === undefined) return false
    const res = await cm.invokeService('removeStyleSetSelection', { sceneId, styleSetId: set.uid, name })
    return res?.ok === true
}
