import { describe, expect, it, vi } from 'vitest'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  createForkOrderPlacer, FLAT_SESSION_ORDER_KEY, forkOrderMembers, isFreshForkChild,
  owningGroupKey, pickForkOrderStore, placeSessionFirst, UNGROUPED_KEY,
  type ForkOrderEntry, type ForkOrderRuntime, type ForkOrderSource, type ForkOrderWorkspace,
} from '../src/client/fork-order.js'

const WORKSPACE = 'workspace-1'
const OTHER_WORKSPACE = 'workspace-2'

/** 构造一条最小 list row（client SessionSummary）。 */
function row(id: string, over: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: id as SessionId,
    displayTitle: id,
    running: false,
    retainedBy: {},
    blank: false,
    updatedAt: 0,
    ...over,
  }
}

/** 构造一份 list 快照。 */
function listState(rows: readonly SessionSummary[]): SessionListState {
  return {
    ids: rows.map(summary => summary.id),
    byId: Object.fromEntries(rows.map(summary => [summary.id, summary])) as Record<SessionId, SessionSummary>,
    phase: 'ready',
    projectionsBySession: {},
  }
}

/** 记住写入并模拟 ui-workspace `pinSessionOrder` 的前置语义。 */
function fakeViewStore(options: { apply?: boolean; throws?: boolean } = {}) {
  const calls: { sessionId: string; accountKeys: readonly string[]; source: ForkOrderSource }[] = []
  const orders: Record<string, readonly string[]> = {}
  const instance = {
    actions: {
      pinSessionOrder: (sessionId: SessionId, accountKeys: readonly string[], source: ForkOrderSource): void => {
        calls.push({ sessionId, accountKeys, source })
        if (options.throws === true) throw new Error('host refused')
        if (options.apply === false) return
        for (const key of accountKeys) {
          orders[key] = [sessionId, ...(orders[key] ?? []).filter(id => id !== sessionId)]
        }
      },
    },
    getSnapshot: () => ({ sessionOrderByAccount: orders }),
  }
  const store = { create: () => instance }
  return { store, calls, orders }
}

interface World {
  readonly runtime: ForkOrderRuntime
  workspaces(): readonly ForkOrderWorkspace[]
  setWorkspaces(next: readonly ForkOrderWorkspace[]): void
  setList(list: SessionListState): void
  notify(): void
}

/** 可变的应用侧读取面，模拟宿主快照逐帧到达。 */
function world(options: {
  rows?: readonly SessionSummary[]
  workspaces?: ForkOrderWorkspace[]
  entries?: ForkOrderEntry[]
} = {}): World {
  let workspaces: readonly ForkOrderWorkspace[] = options.workspaces ?? []
  let list = listState(options.rows ?? [])
  const entries: ForkOrderEntry[] = options.entries ?? []
  const listeners = new Set<() => void>()
  return {
    runtime: {
      entries: () => entries,
      workspaces: () => workspaces,
      list: () => list,
      rowState: () => ({ pinnedSessionIds: [], archivedSessionIds: [] }),
      subscribe: (listener) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    },
    workspaces: () => workspaces,
    setWorkspaces(next) { workspaces = next },
    setList(next: SessionListState) { list = next },
    notify() { for (const listener of listeners) listener() },
  }
}

describe('owningGroupKey', () => {
  it('names the owning workspace, or the ungrouped account', () => {
    const workspaces: ForkOrderWorkspace[] = [
      { workspaceId: WORKSPACE, sessionIds: ['session-a' as SessionId] },
    ]
    expect(owningGroupKey(workspaces, 'session-a' as SessionId)).toBe(WORKSPACE)
    expect(owningGroupKey(workspaces, 'session-b' as SessionId)).toBe(UNGROUPED_KEY)
  })
})

describe('forkOrderMembers', () => {
  it('lists every workspace, the ungrouped bucket and the flat account', () => {
    const workspaces: ForkOrderWorkspace[] = [
      { workspaceId: WORKSPACE, sessionIds: ['session-a' as SessionId, 'session-b' as SessionId] },
    ]
    const list = listState([
      row('session-a', { retainedBy: { mainView: 1 } }),
      row('session-b'),
      row('session-loose', { retainedBy: { mainView: 1 } }),
      row('session-subagent', { origin: 'subagent' }),
      row('session-blank', { blank: true }),
    ])

    const members = forkOrderMembers(workspaces, list)

    expect(members[WORKSPACE]).toEqual(['session-a', 'session-b'])
    expect(members[UNGROUPED_KEY]).toEqual(['session-loose', 'session-subagent', 'session-blank'])
    // 扁平账户跳过 subagent，blank 只保留当前选中的那一个。
    expect(members[FLAT_SESSION_ORDER_KEY]).toEqual(['session-a', 'session-b', 'session-loose'])
  })
})

describe('pickForkOrderStore', () => {
  it('skips entries without a shared store handle', () => {
    expect(pickForkOrderStore([{}, { store: 'ignored' }])).toBeUndefined()
    const store = { create: () => ({}) }
    expect(pickForkOrderStore([{}, { store }])).toBe(store)
  })
})

describe('placeSessionFirst', () => {
  it('fronts the session in its group and the flat list without pinning', () => {
    const view = fakeViewStore()
    const source = row('session-child', { updatedAt: 10 })
    const target = world({
      rows: [row('session-parent'), source],
      workspaces: [{ workspaceId: WORKSPACE, sessionIds: ['session-parent' as SessionId] }],
      entries: [{ store: view.store }],
    })

    expect(placeSessionFirst(target.runtime, 'session-parent' as SessionId)).toBe('placed')
    expect(view.calls[0]?.accountKeys).toEqual([WORKSPACE, FLAT_SESSION_ORDER_KEY])
    expect(view.orders[WORKSPACE]?.[0]).toBe('session-parent')
    expect(view.orders[FLAT_SESSION_ORDER_KEY]?.[0]).toBe('session-parent')
    expect(view.calls[0]?.source.members[WORKSPACE]).toEqual(['session-parent'])
    expect(view.calls[0]?.source.summaries['session-child' as SessionId]).toBe(source)
  })

  it('waits while the Host has not attached the session yet', () => {
    const view = fakeViewStore()
    const target = world({
      rows: [row('session-child')],
      workspaces: [{ workspaceId: WORKSPACE, sessionIds: ['session-parent' as SessionId] }],
      entries: [{ store: view.store }],
    })

    expect(placeSessionFirst(target.runtime, 'session-child' as SessionId)).toBe('waiting')
    expect(view.calls).toHaveLength(0)
  })

  it('waits while the sidebar store is not registered yet', () => {
    const target = world({
      rows: [row('session-parent')],
      workspaces: [{ workspaceId: WORKSPACE, sessionIds: ['session-parent' as SessionId] }],
    })

    expect(placeSessionFirst(target.runtime, 'session-parent' as SessionId)).toBe('waiting')
  })

  it('reports a placement the store did not apply', () => {
    const view = fakeViewStore({ apply: false })
    const target = world({
      rows: [row('session-parent')],
      workspaces: [{ workspaceId: WORKSPACE, sessionIds: ['session-parent' as SessionId] }],
      entries: [{ store: view.store }],
    })

    expect(placeSessionFirst(target.runtime, 'session-parent' as SessionId)).toBe('failed')
  })

  it('reports a store that throws instead of propagating', () => {
    const view = fakeViewStore({ throws: true })
    const target = world({
      rows: [row('session-parent')],
      workspaces: [{ workspaceId: WORKSPACE, sessionIds: ['session-parent' as SessionId] }],
      entries: [{ store: view.store }],
    })

    expect(placeSessionFirst(target.runtime, 'session-parent' as SessionId)).toBe('failed')
  })
})

describe('isFreshForkChild', () => {
  const now = 1_000_000

  it('accepts a non-blank session updated inside the window', () => {
    expect(isFreshForkChild(row('session-fork', { updatedAt: now - 1_000 }), now, 120_000)).toBe(true)
  })

  it('rejects unknown, blank, subagent and stale rows', () => {
    expect(isFreshForkChild(undefined, now, 120_000)).toBe(false)
    expect(isFreshForkChild(row('session-blank', { blank: true, updatedAt: now }), now, 120_000)).toBe(false)
    expect(isFreshForkChild(row('session-subagent', { origin: 'subagent', updatedAt: now }), now, 120_000)).toBe(false)
    expect(isFreshForkChild(row('session-stale', { updatedAt: now - 500_000 }), now, 120_000)).toBe(false)
  })
})

describe('createForkOrderPlacer', () => {
  it('puts a native fork child first once the Host attach frame lands', () => {
    const view = fakeViewStore()
    const target = world({
      rows: [row('session-parent')],
      workspaces: [{ workspaceId: WORKSPACE, sessionIds: ['session-parent' as SessionId] }],
      entries: [{ store: view.store }],
    })
    const placer = createForkOrderPlacer(target.runtime, { now: () => 1_000_000, warn: vi.fn() })

    // fork 返回后：列表先看到子会话，工作区成员关系还没到。
    target.setList(listState([
      row('session-fork', { updatedAt: 999_000 }),
      row('session-parent'),
    ]))
    target.notify()
    expect(view.calls).toHaveLength(0)
    expect(placer.pending()).toBe(1)

    // attach 帧到达后自动落位。
    target.setWorkspaces([{ workspaceId: WORKSPACE, sessionIds: ['session-fork' as SessionId, 'session-parent' as SessionId] }])
    target.notify()
    expect(view.orders[WORKSPACE]?.[0]).toBe('session-fork')
    expect(view.orders[FLAT_SESSION_ORDER_KEY]?.[0]).toBe('session-fork')
    expect(placer.pending()).toBe(0)
    placer.dispose()
  })

  it('places an id handed over by the plugin own fork path', () => {
    const view = fakeViewStore()
    const target = world({
      rows: [row('session-parent', { updatedAt: 1_000_000 })],
      workspaces: [{ workspaceId: WORKSPACE, sessionIds: ['session-parent' as SessionId] }],
      entries: [{ store: view.store }],
    })
    const placer = createForkOrderPlacer(target.runtime, { now: () => 1_000_000, warn: vi.fn() })

    target.setList(listState([row('session-parent', { updatedAt: 1_000_000 })]))
    target.setWorkspaces([{ workspaceId: WORKSPACE, sessionIds: ['session-fresh' as SessionId, 'session-parent' as SessionId] }])
    placer.enqueue('session-fresh' as SessionId)

    expect(view.orders[WORKSPACE]?.[0]).toBe('session-fresh')
    placer.dispose()
  })

  it('falls back to the ungrouped account when no workspace ever claims the session', () => {
    const view = fakeViewStore()
    const target = world({
      rows: [row('session-loose', { updatedAt: 1_000_000 })],
      entries: [{ store: view.store }],
    })
    const placer = createForkOrderPlacer(target.runtime, {
      now: () => 1_000_000,
      ungroupedGrace: 1,
      warn: vi.fn(),
    })

    placer.enqueue('session-loose' as SessionId)
    expect(view.calls).toHaveLength(0)
    target.notify()

    expect(view.calls[0]?.accountKeys).toEqual([UNGROUPED_KEY, FLAT_SESSION_ORDER_KEY])
    expect(view.orders[UNGROUPED_KEY]?.[0]).toBe('session-loose')
    expect(placer.pending()).toBe(0)
    placer.dispose()
  })

  it('gives up after the attempt budget and reports once', () => {
    const view = fakeViewStore({ apply: false })
    const warn = vi.fn()
    const target = world({
      rows: [row('session-parent', { updatedAt: 1_000_000 })],
      workspaces: [{ workspaceId: WORKSPACE, sessionIds: ['session-parent' as SessionId] }],
      entries: [{ store: view.store }],
    })
    const placer = createForkOrderPlacer(target.runtime, { now: () => 1_000_000, maxAttempts: 2, warn })

    placer.enqueue('session-parent' as SessionId)
    expect(placer.pending()).toBe(1)
    target.notify()
    expect(placer.pending()).toBe(0)
    expect(warn).toHaveBeenCalledTimes(1)
    placer.dispose()
  })

  it('stops observing after dispose', () => {
    const view = fakeViewStore()
    const target = world({
      rows: [row('session-parent', { updatedAt: 1_000_000 })],
      workspaces: [{ workspaceId: WORKSPACE, sessionIds: ['session-parent' as SessionId] }],
      entries: [{ store: view.store }],
    })
    const placer = createForkOrderPlacer(target.runtime, { now: () => 1_000_000, warn: vi.fn() })
    placer.dispose()

    target.setList(listState([
      row('session-fork', { updatedAt: 1_000_000 }),
      row('session-parent', { updatedAt: 1_000_000 }),
    ]))
    target.notify()
    expect(view.calls).toHaveLength(0)
    expect(placer.pending()).toBe(0)
  })

  it('seeds its baseline from the first ready snapshot instead of moving old sessions', () => {
    const view = fakeViewStore()
    const pendingList: SessionListState = { ids: [], byId: {}, phase: 'pending', projectionsBySession: {} }
    const target = world({
      rows: [],
      workspaces: [{ workspaceId: OTHER_WORKSPACE, sessionIds: ['session-old' as SessionId] }],
      entries: [{ store: view.store }],
    })
    target.setList(pendingList)
    const placer = createForkOrderPlacer(target.runtime, { now: () => 1_000_000, warn: vi.fn() })

    // 基线快照里已有的会话不是这次运行中 fork 出来的，不该被移动。
    target.setList(listState([row('session-old', { updatedAt: 1_000_000 })]))
    target.notify()
    expect(view.calls).toHaveLength(0)
    placer.dispose()
  })
})
