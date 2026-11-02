import { describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { draftTaskToWorkspace, type DraftTaskDeps } from '../src/client/draft-task.js'

const s1 = 's1' as SessionId
const s2 = 's2' as SessionId

function deps(over: Partial<{
  create: DraftTaskDeps['sessions']['create']
  scope: DraftTaskDeps['sessions']['scope']
  openSession: DraftTaskDeps['uiWorkspace']['openSession']
}> = {}): DraftTaskDeps {
  return {
    sessions: {
      create: over.create ?? (async () => s1),
      scope: over.scope ?? (() => ({
        get: () => ({
          input: {
            for: () => ({
              setDraft: vi.fn(),
            }),
          },
        }),
      })),
    },
    uiWorkspace: {
      openSession: over.openSession ?? vi.fn(),
    },
  }
}

describe('draftTaskToWorkspace', () => {
  it('默认落点：create 不带 workspaceId，openSession 后 setDraft、不发送', async () => {
    const create = vi.fn(async () => s1)
    const openSession = vi.fn()
    const setDraft = vi.fn()
    const sessionId = await draftTaskToWorkspace(
      deps({ create, openSession, scope: () => ({
        get: () => ({ input: { for: () => ({ setDraft }) } }),
      }) }),
      'fix the bug',
      undefined,
    )
    expect(sessionId).toBe(s1)
    expect(create).toHaveBeenCalledWith({})
    expect(openSession).toHaveBeenCalledWith(s1)
    expect(setDraft).toHaveBeenCalledWith('fix the bug')
  })

  it('指定工作区：create 带 workspaceId', async () => {
    const create = vi.fn(async () => s2)
    await draftTaskToWorkspace(deps({ create }), 'task', 'w-42')
    expect(create).toHaveBeenCalledWith({ workspaceId: 'w-42' })
  })

  it('空文本直接拒绝', async () => {
    await expect(draftTaskToWorkspace(deps(), '   ')).rejects.toThrow('task text is empty')
  })

  it('conversation scope 缺失时抛错', async () => {
    const missing = deps({ scope: () => undefined })
    await expect(draftTaskToWorkspace(missing, 'task')).rejects.toThrow('no conversation scope')
  })

  it('create 失败原样上抛（页面转为错误文案）', async () => {
    const failing = deps({ create: async () => { throw new Error('workspace not connectable') } })
    await expect(draftTaskToWorkspace(failing, 'task', 'w-1')).rejects.toThrow('workspace not connectable')
  })
})
