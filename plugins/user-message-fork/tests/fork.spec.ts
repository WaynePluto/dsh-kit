import { describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  createAndSeedUserMessage, forkAndSeedUserMessage, resolvePreviousTurnEnd, type ForkSessions,
} from '../src/client/fork.js'
import type { ForkTimeline } from '../src/shared.js'

const SOURCE = 'session-source' as SessionId
const CHILD = 'session-child' as SessionId
const FRESH = 'session-fresh' as SessionId

function world(sessionId: SessionId) {
  const order: string[] = []
  const setDraft = vi.fn((text: string) => { order.push(`draft:${text}`) })
  const scope = {
    get: vi.fn(() => ({ input: { for: vi.fn(() => ({ setDraft })) } })),
  }
  const sessions: ForkSessions = {
    fork: vi.fn(async options => {
      order.push(`fork:${String(options.atSeq)}`)
      return CHILD
    }),
    create: vi.fn(async () => {
      order.push('create')
      return FRESH
    }),
    scope: vi.fn((id: SessionId) => {
      expect(id).toBe(sessionId)
      return scope
    }),
  }
  const openSession = vi.fn((id: SessionId) => { order.push(`open:${String(id)}`) })
  return { order, sessions, openSession, setDraft }
}

describe('resolvePreviousTurnEnd', () => {
  it('pages the history window before resolving an unloaded previous turn', async () => {
    let timeline: ForkTimeline = {
      turnOrder: [3],
      turns: new Map([[3, { end: undefined }]]),
    }
    const loadThrough = vi.fn(async () => {
      timeline = {
        turnOrder: [1, 2, 3],
        turns: new Map([
          [1, { end: { seq: 10 } }],
          [2, { end: { seq: 20 } }],
          [3, { end: undefined }],
        ]),
      }
    })
    await expect(resolvePreviousTurnEnd(
      undefined,
      3,
      30,
      loadThrough,
      () => timeline,
    )).resolves.toBe(20)
    expect(loadThrough).toHaveBeenCalledWith(29)
  })

  it('uses a loaded boundary without paging', async () => {
    const loadThrough = vi.fn(async () => {})
    await expect(resolvePreviousTurnEnd(20, 3, 30, loadThrough, () => undefined)).resolves.toBe(20)
    expect(loadThrough).not.toHaveBeenCalled()
  })
})

describe('forkAndSeedUserMessage', () => {
  it('forks at the previous turn, opens the child, then seeds its composer', async () => {
    const { order, sessions, openSession, setDraft } = world(CHILD)

    await expect(forkAndSeedUserMessage(sessions, openSession, SOURCE, 42, '修改后再发')).resolves.toBe(CHILD)
    expect(sessions.fork).toHaveBeenCalledWith({ sessionId: SOURCE, atSeq: 42, increaseTitle: true })
    expect(sessions.create).not.toHaveBeenCalled()
    expect(setDraft).toHaveBeenCalledWith('修改后再发')
    expect(order).toEqual(['fork:42', 'open:session-child', 'draft:修改后再发'])
  })

  it('surfaces a child without a scoped composer instead of seeding nothing', async () => {
    const sessions: ForkSessions = {
      fork: vi.fn(async () => CHILD),
      create: vi.fn(async () => FRESH),
      scope: vi.fn(() => ({ get: vi.fn(() => undefined) })),
    }
    await expect(forkAndSeedUserMessage(sessions, vi.fn(), SOURCE, 42, '内容')).rejects.toThrow('conversation service')
  })
})

describe('createAndSeedUserMessage', () => {
  it('creates a plain conversation in the source workspace, opens it, then seeds the composer', async () => {
    const { order, sessions, openSession, setDraft } = world(FRESH)
    const target = { workspaceId: 'workspace-1' }

    await expect(createAndSeedUserMessage(sessions, openSession, target, '第一条')).resolves.toBe(FRESH)
    expect(sessions.create).toHaveBeenCalledWith(target)
    expect(sessions.fork).not.toHaveBeenCalled()
    expect(setDraft).toHaveBeenCalledWith('第一条')
    expect(order).toEqual(['create', 'open:session-fresh', 'draft:第一条'])
  })

  it('falls back to the source directory target when the session is ungrouped', async () => {
    const { sessions, openSession } = world(FRESH)
    const target = { cwd: 'D:\\work' }

    await expect(createAndSeedUserMessage(sessions, openSession, target, '内容')).resolves.toBe(FRESH)
    expect(sessions.create).toHaveBeenCalledWith(target)
  })

  it('surfaces a fresh session without a scoped composer instead of seeding nothing', async () => {
    const sessions: ForkSessions = {
      fork: vi.fn(async () => CHILD),
      create: vi.fn(async () => FRESH),
      scope: vi.fn(() => undefined),
    }
    await expect(createAndSeedUserMessage(sessions, vi.fn(), {}, '内容')).rejects.toThrow('client scope')
  })
})
