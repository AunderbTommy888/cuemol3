/**
 * @file renderer/plugin-host/bottomTabReveal.ts
 * @description Bringing a bottom-panel tab to the front from outside the
 * panel, e.g. a plugin showing its tab after an operation that fills it.
 *
 * The panel keeps the picked tab as its own state; it subscribes here and
 * switches when asked. Module-level because there is one bottom panel.
 */

type RevealListener = (tabId: string) => void

const listeners = new Set<RevealListener>()

/**
 * Bring the bottom tab `tabId` (a built-in id or a plugin's
 * `contributes.bottomTabs` id) to the front. A tab that is not present is
 * ignored by the panel.
 */
export function revealBottomTab(tabId: string): void {
  for (const l of listeners) l(tabId)
}

/** Subscribe the bottom panel to reveal requests; returns the unsubscribe. */
export function onRevealBottomTab(listener: RevealListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
