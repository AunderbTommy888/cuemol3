/**
 * @file utils/createDialogPrefs.ts
 * @description localStorage-backed "last confirmed options" for a dialog.
 * Mirrors UXP's xulstore `persist="checked"` and
 * `pref.set("cuemol2.ui.histories.<dlg>...")`: a dialog loads the record when
 * it opens and saves its option state when the user confirms it.
 *
 * Reading has a single rule: every field has a check, and a stored value
 * that fails its check (or a field that is missing) falls back to the
 * default for that field alone. Malformed JSON or no record gives the
 * defaults; keys not listed in `fields` are dropped. Adding a field to a
 * dialog therefore needs no migration.
 */

import { loadJSON, saveJSON } from './localStorageJSON';

/** Accepts or rejects one stored field value. */
export type Check = (v: unknown) => boolean;

export interface DialogPrefsOptions<T extends object> {
    /** localStorage key, conventionally `cuemol2.ui.histories.<dialog>`. */
    key: string;
    /** Values a dialog starts with when nothing (valid) is stored. */
    defaults: T;
    /**
     * One check per field of `T`, optional fields included (the `-?` makes a
     * missing entry a compile error).
     */
    fields: { [K in keyof T]-?: Check };
}

/** Public surface returned by {@link createDialogPrefs}. */
export interface DialogPrefs<T extends object> {
    /** Stored values, each field validated independently. */
    load(): T;
    /** Replaces the stored record with `value`. */
    save(value: T): void;
    /** The defaults the store was built with (for a Defaults button). */
    readonly defaults: T;
}

export const isBool: Check = (v) => typeof v === 'boolean';
export const isStr: Check = (v) => typeof v === 'string';
/** A number or absent, e.g. an object uid that may not be chosen yet. */
export const isOptNum: Check = (v) =>
    v === undefined || (typeof v === 'number' && Number.isFinite(v));

/**
 * A finite number within the inclusive range.
 *
 * @param min - lower bound (default unbounded)
 * @param max - upper bound (default unbounded)
 */
export function isNum(min = -Infinity, max = Infinity): Check {
    return (v) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
}

/**
 * One of the listed values (an enum / select / segment choice).
 *
 * @param values - the choices the control currently offers
 */
export function isOneOf(values: readonly unknown[]): Check {
    return (v) => values.includes(v);
}

/**
 * Build a dialog option store bound to a localStorage key.
 *
 * @param opts - key, defaults and the per-field checks
 * @returns load / save and the defaults
 */
export function createDialogPrefs<T extends object>(
    opts: DialogPrefsOptions<T>,
): DialogPrefs<T> {
    const { key, defaults, fields } = opts;
    const keys = Object.keys(fields) as (keyof T)[];

    function asRecord(raw: unknown): Record<string, unknown> | null {
        return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
            ? (raw as Record<string, unknown>)
            : null;
    }

    function load(): T {
        const saved = loadJSON(key, asRecord, null);
        if (!saved) return { ...defaults };
        const out = {} as T;
        for (const k of keys) {
            const v = saved[k as string];
            const value = fields[k](v) ? (v as T[keyof T]) : defaults[k];
            // Keep an optional field absent rather than present-undefined.
            if (value !== undefined) out[k] = value;
        }
        return out;
    }

    function save(value: T): void {
        saveJSON(key, value);
    }

    return { load, save, defaults };
}
