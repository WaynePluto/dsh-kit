import { describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { sendTaskToWorkspace, type SendTaskDeps } from '../src/client/send-task.js'

const s1 = 's1' as SessionId
const s2 = 's2' as SessionId

function deps(over: Partial<{
  create: SendTaskDeps['sessions']['create']
  scope: SendTaskDeps['sessions']['scope']
  openSession: SendTaskDeps['uiWorkspace']['openSession']
}> = {}): SendTaskDeps {
  return {
    sessions: {
      create: over.create ?? (async () => s1),
      scope: over.scope ?? (() => ({
        get: () => ({
          input: {
            for: () => ({
              setDraft: vi.fn(),
              submit: vi.fn(),
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

describe('sendTaskToWorkspace', () => {
  it('默认落点：create 不带 workspaceId，openSession 后 setDraft + submit', async () => {
    const create = vi.fn(async () => s1)
    const openSession = vi.fn()
    const setDraft = vi.fn()
    const submit = vi.fn()
    const sessionId = await sendTaskToWorkspace(
      deps({ create, openSession, scope: () => ({
        get: () => ({ input: { for: () => ({ setDraft, submit }) } }),
      }) }),
      'fix the bug',
      undefined,
    )
    expect(sessionId).toBe(s1)
    expect(create).toHaveBeenCalledWith({})
    expect(openSession).toHaveBeenCalledWith(s1)
    expect(setDraft).toHaveBeenCalledWith('fix the bug')
    expect(submit).toHaveBeenCalledWith('queue', 'click')
  })

  it('指定工作区：create 带 workspaceId', async () => {
    const create = vi.fn(async () => s2)
    await sendTaskToWorkspace(deps({ create }), 'task', 'w-42')
    expect(create).toHaveBeenCalledWith({ workspaceId: 'w-42' })
  })

  it('空文本直接拒绝', async () => {
    await expect(sendTaskToWorkspace(deps(), '   ')).rejects.toThrow('task text is empty')
  })

  it('conversation scope 缺失时抛错', async () => {
    const missing = deps({ scope: () => undefined })
    await expect(sendTaskToWorkspace(missing, 'task')).rejects.toThrow('no conversation scope')
  })

  it('create 失败原样上抛（页面转为错误文案）', async () => {
    const failing = deps({ create: async () => { throw new Error('workspace not connectable') } })
    await expect(sendTaskToWorkspace(failing, 'task', 'w-1')).rejects.toThrow('workspace not connectable')
  })
})
