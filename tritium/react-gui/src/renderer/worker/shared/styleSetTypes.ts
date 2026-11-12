/**
 * @file worker/shared/styleSetTypes.ts
 * @description One row of the Style Sets pane: a registered style set and
 * the flags its context menu gates on.
 */

/** A style set visible from a scene (global or scene-local). */
export interface StyleSetEntry {
    /** StyleSet uid (a real C++ uid, usable with `StyleManager.getStyleSet`). */
    uid: number;
    /** Set name; empty for an anonymous set. */
    name: string;
    /** Scope id: 0 for a global set, the scene uid for a scene-local one. */
    scopeId: number;
    /** Source file path; empty when the set was not loaded from a file. */
    src: string;
    readonly: boolean;
    modified: boolean;
}
