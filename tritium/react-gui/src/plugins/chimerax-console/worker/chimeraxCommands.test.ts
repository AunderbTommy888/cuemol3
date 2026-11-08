/**
 * @file plugins/chimerax-console/worker/chimeraxCommands.test.ts
 * @description Which unknown lines a ChimeraX script runs past.
 *
 * A ChimeraX command the console does not have is skipped so the script
 * goes on; a misspelling stops it. Taking a misspelling for a ChimeraX
 * command would hide the user's mistake, and taking a real command for a
 * misspelling would stop every tutorial at its first `sym`. A second word
 * after a command the console has is a ChimeraX command only when ChimeraX
 * has that pair.
 */

import { describe, expect, it } from 'vitest'
import { CHIMERAX_DIALECT } from './index'

const skip = (text: string) => CHIMERAX_DIALECT.unsupportedCommand?.(text) ?? null

describe('unsupportedCommand', () => {
  it('skips a ChimeraX command the console lacks, abbreviated or not, and leaves misspellings as errors', () => {
    expect(skip('sym #1 assembly 3')).toMatch(/^Error: sym is not supported yet/)
    expect(skip('fit #2 in #1')).toMatch(/^Error: fitmap is not supported yet/)
    expect(skip('alphafold match P12345')).toMatch(/^Error: alphafold match is not supported yet/)
    expect(skip('symx #1')).toBeNull()
    expect(skip('alphafold fetchx P12345')).toBeNull()
  })
})
