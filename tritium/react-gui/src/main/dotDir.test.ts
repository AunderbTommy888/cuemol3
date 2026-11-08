/**
 * @file main/dotDir.test.ts
 * @description What CueMol reads from the dot directory at startup, and in
 * which order: the scripts run in a fixed order whatever the folder lists,
 * and the style files go by file name (a later one wins over an earlier one).
 */

import { describe, expect, it } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { listDotStyleFiles, listStartupScripts } from './dotDir'

describe('dotDir', () => {
  it('lists the startup scripts there are in running order, and the style files by name', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuemol-home-'))
    for (const n of ['startup.cxc', 'startup.txt', 'startup.pml', 'other.txt']) fs.writeFileSync(path.join(dir, n), '')
    expect(listStartupScripts(dir).map((p) => path.basename(p))).toEqual(['startup.txt', 'startup.pml', 'startup.cxc'])

    expect(listDotStyleFiles(dir)).toEqual([])
    fs.mkdirSync(path.join(dir, 'styles'))
    for (const n of ['b.xml', 'a.XML', 'notes.txt']) fs.writeFileSync(path.join(dir, 'styles', n), '')
    expect(listDotStyleFiles(dir).map((p) => path.basename(p))).toEqual(['a.XML', 'b.xml'])
  })
})
