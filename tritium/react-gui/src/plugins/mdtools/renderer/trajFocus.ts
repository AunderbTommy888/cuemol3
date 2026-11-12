/**
 * @file plugins/mdtools/renderer/trajFocus.ts
 * @description A one-shot request for the Trajectory panel to show a given
 * trajectory, fitted to the panel width, once it has a given frame count.
 *
 * Made by the attach command after it succeeds; taken by the panel, which may
 * not be mounted yet (the command reveals its tab right after). The request
 * is cleared when taken, so a later remount of the panel does not repeat it.
 */

export interface TrajFocusRequest {
  /** The Trajectory to select. */
  objId: number
  /** Its frame count after the attach; the fit waits until the panel sees it. */
  nframe: number
}

let pending: TrajFocusRequest | null = null
const listeners = new Set<() => void>()

/** Ask the panel to select and fit `req.objId`. */
export function requestTrajFocus(req: TrajFocusRequest): void {
  pending = req
  for (const l of listeners) l()
}

/** Take the pending request, if any, clearing it. */
export function takeTrajFocus(): TrajFocusRequest | null {
  const req = pending
  pending = null
  return req
}

/** Be told when a request is made; returns the unsubscribe. */
export function onTrajFocus(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
