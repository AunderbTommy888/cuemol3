/**
 * @file plugins/console/renderer/startupScripts.test.ts
 * @description Which dialect runs each startup script, and what the status
 * bar is left showing when the scripts end.
 */

import { describe, expect, it } from 'vitest'
import { NATIVE_META } from '../shared/dialectMeta'
import type { DialectMeta } from '../shared/dialectMeta'
import { planStartupScripts } from './startupScripts'
import { beginStartup, dismissStartup, endStartup, getStartupActivity, setStartupFile } from './startupActivity'

const PYMOL = { ...NATIVE_META, id: 'pymol', label: 'PyMOL', scripts: [{ ext: '.pml', submit: 'text' }] } as DialectMeta

describe('planStartupScripts', () => {
  it('runs a script in the dialect that owns its extension, a .txt as native lines, and skips one whose dialect is off', () => {
    const plans = planStartupScripts(['/h/startup.txt', '/h/startup.qax', '/h/startup.pml', '/h/startup.cxc'], [NATIVE_META, PYMOL])
    expect(plans.map((p) => (p.run ? p.dialect : 'skip'))).toEqual(['native', 'native', 'pymol', 'skip'])
    expect(plans[3].run === false && plans[3].reason).toContain('.cxc')
  })
})

describe('startupActivity', () => {
  it('goes away when every script ran, and stays to say which did not run after Stop until seen', () => {
    beginStartup(['/h/a.txt', '/h/b.pml'])
    setStartupFile(0, 'done')
    setStartupFile(1, 'done')
    endStartup(false)
    expect(getStartupActivity().phase).toBe('idle')

    beginStartup(['/h/a.txt', '/h/b.pml'])
    setStartupFile(0, 'stopped')
    endStartup(true)
    expect(getStartupActivity()).toEqual({
      phase: 'stopped',
      files: [{ path: '/h/a.txt', status: 'stopped' }, { path: '/h/b.pml', status: 'not-run' }],
    })
    dismissStartup()
    expect(getStartupActivity().phase).toBe('idle')
  })
})
