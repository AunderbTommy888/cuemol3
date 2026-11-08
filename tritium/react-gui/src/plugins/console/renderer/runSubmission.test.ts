/**
 * @file plugins/console/renderer/runSubmission.test.ts
 * @description A script sent by its path and split at a scene command: the
 * rest goes back as text, not as the path again -- sending the path would
 * run the file from the top, scene command included, every time.
 */

import { describe, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('../calls', () => ({ consoleServices: { invoke } }))
vi.mock('./sceneRequest', () => ({ doSceneRequest: vi.fn(async () => ({ ok: true, lines: [] })) }))

import { runSubmission } from './runSubmission'
import type { SubmissionDeps } from './runSubmission'

describe('runSubmission', () => {
  it('sends a script path only until a call has read it, then the rest as text', async () => {
    invoke
      .mockResolvedValueOnce({ ok: true, entries: [], aborted: false, interrupted: false, sceneRequest: { op: 'new', name: '' }, rest: 'mutate' })
      .mockResolvedValueOnce({ ok: true, entries: [], aborted: false, interrupted: false })
    const deps = {
      cm: {},
      ensureActiveScene: async () => ({ scene_uid: 1, view_id: 2 }),
      tabs: { list: async () => [{}] },
      openScene: async () => true,
    } as unknown as SubmissionDeps

    const res = await runSubmission(deps, { dialect: 'native', text: '', runId: 'r', scriptPath: '/h/startup.txt', stopped: () => false })
    expect(res.aborted).toBe(false)
    const sent = invoke.mock.calls.map((c) => c[2] as { text: string; scriptPath?: string })
    expect(sent.map((a) => [a.text, a.scriptPath])).toEqual([['', '/h/startup.txt'], ['mutate', undefined]])
  })
})
