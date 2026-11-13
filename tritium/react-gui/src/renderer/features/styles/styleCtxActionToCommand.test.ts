/**
 * @file features/styles/styleCtxActionToCommand.test.ts
 * @description The Style Sets pane's action-to-command table: a row action
 * carries the set's uid, scope and label, and resolves to nothing on empty
 * space.
 */

import { describe, it, expect } from 'vitest'
import { CmdId } from '@renderer/commands/ids'
import type { StyleSetEntry } from '@renderer/worker/shared/styleSetTypes'
import { styleCtxActionToCommand as map } from './styleCtxActionToCommand'

const set: StyleSetEntry = { uid: 7, name: 'st1', scopeId: 3, src: '', readonly: false, modified: false }

describe('styleCtxActionToCommand', () => {
  it('carries the uid, the scope and the name of the set', () => {
    const ref = { id: '7', scopeId: 3, name: 'st1' }
    expect(map(set, { kind: 'editStyle' })).toEqual({ id: CmdId.StyleEdit, args: ref })
    expect(map(set, { kind: 'styleSaveAs' })).toEqual({ id: CmdId.StyleSaveAs, args: ref })
    expect(map(set, { kind: 'styleToggleReadOnly' })).toEqual({
      id: CmdId.StyleToggleReadOnly, args: { id: '7', scopeId: 3 },
    })
  })

  it('a row action on empty space resolves to nothing; New / Load need no row', () => {
    expect(map(null, { kind: 'editStyle' })).toBeNull()
    expect(map(null, { kind: 'delete' })).toBeNull()
    expect(map(null, { kind: 'newStyle' })).toEqual({ id: CmdId.StyleNew })
    expect(map(null, { kind: 'styleLoad' })).toEqual({ id: CmdId.StyleLoadFromFile })
  })
})
