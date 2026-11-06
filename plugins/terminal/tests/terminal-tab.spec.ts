/** 测试：tap registry（ring/扇出/退出）、关闭确认臂、monitor 视图收敛、tab 定义与 bindings。 */

import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  MONITOR_POLL_MS, TERMINAL_TAB_ID, TERMINAL_TAB_KIND, TerminalTabMonitor,
  armedStore, armClose, clearAllClosedIntent, closeArmDecision, disarmClose,
  isClosedIntent, markClosedIntent, terminalTabDefinition,
} from '../src/client/terminal-tab.js'
import { BoundedRing, TerminalTapRegistry } from '../src/terminal-tap.js'
import { getBinding, removeBinding, setBinding } from '../src/client/terminal-bindings.js'
import type { TerminalMonitorHost } from '../src/client/terminal-tab.js'
import type { TerminalsSnapshot } from '../src/shared.js'

/** definition 文案直译器。 */
const copied = (key: string): string => `copied:${key}`
/** guide entry 图标占位。 */
const guideIcon = (): null => null

const SESSION = 'session-a'

/** 构造一个 list 快照；monitor 只读 terminals。 */
function snapshotOf(ids: readonly string[]): TerminalsSnapshot {
  return {
    terminals: ids.map(id => ({ id, type: 'shell', running: true })),
    now: Date.now(),
  }
}

/** fake PTY 句柄：output 是 EventEmitter（tap 以 'data' listener 广播消费）。 */
function fakeHandle() {
  const output = new EventEmitter()
  const writes: string[] = []
  const done: Promise<{ exitCode: number | null, signal: null }> = Promise.resolve({ exitCode: null, signal: null })
  return {
    output,
    writes,
    pid: 1,
    done,
    write: async (data: string) => { writes.push(data) },
    resize: async () => {},
    terminate: async () => {},
  }
}

/** tap data 帧收集 listener。 */
function dataListener(seen: number[][]): (frame: { kind: string, bytes?: Uint8Array }) => void {
  return (frame) => {
    if (frame.kind === 'data' && frame.bytes !== undefined) seen.push([...frame.bytes])
  }
}

describe('bounded ring', () => {
  it('keeps the newest bytes and merges a contiguous snapshot', () => {
    const ring = new BoundedRing(10)
    expect(ring.snapshot().length).toBe(0)
    ring.append(new Uint8Array([1, 2, 3]))
    ring.append(new Uint8Array([4, 5]))
    expect([...ring.snapshot()]).toStrictEqual([1, 2, 3, 4, 5])
    ring.append(new Uint8Array([6, 7, 8, 9, 10, 11]))
    expect(ring.size()).toBeLessThanOrEqual(10)
    // 超限时整块丢弃最旧 chunk（不做块内部分截断），最新字节完整保留。
    expect([...ring.snapshot()]).toStrictEqual([4, 5, 6, 7, 8, 9, 10, 11])
  })

  it('truncates a single oversized chunk from the tail', () => {
    const ring = new BoundedRing(4)
    ring.append(new Uint8Array([1, 2, 3, 4, 5, 6]))
    expect([...ring.snapshot()]).toStrictEqual([3, 4, 5, 6])
  })
})

describe('tap registry', () => {
  it('fans raw output out to subscribers and survives subscriber churn', () => {
    const taps = new TerminalTapRegistry()
    const handle = fakeHandle()
    const entry = taps.bind('pty-1', handle as never, { cols: 160, rows: 40 })
    const seen: number[][] = []
    const listener = dataListener(seen)
    entry.listeners.add(listener)
    handle.output.emit('data', Buffer.from([9, 8]))
    expect(seen).toStrictEqual([[9, 8]])
    entry.listeners.delete(listener)
    handle.output.emit('data', Buffer.from([7]))
    expect(seen).toStrictEqual([[9, 8]])
    expect(taps.entryOf('pty-1')?.ring.snapshot().length).toBeGreaterThan(0)
  })

  it('marks exited with the exit code from done', async () => {
    const taps = new TerminalTapRegistry()
    const handle = fakeHandle()
    let resolveDone: ((value: { exitCode: number | null, signal: null }) => void) | undefined
    const deferred = new Promise<{ exitCode: number | null, signal: null }>((resolve) => { resolveDone = resolve })
    handle.done = deferred
    const entry = taps.bind('pty-2', handle as never, { cols: 160, rows: 40 })
    const exits: (number | null)[] = []
    entry.listeners.add((frame) => { if (frame.kind === 'exit') exits.push(frame.exitCode) })
    resolveDone?.({ exitCode: 3, signal: null })
    await Promise.resolve()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(entry.exited).toBe(true)
    expect(entry.exitCode).toBe(3)
    expect(exits).toStrictEqual([3])
    taps.remove('pty-2')
    expect(taps.entryOf('pty-2')).toBeUndefined()
  })
})

describe('close confirm arm', () => {
  it('arms first and kills on the second decision within the window', () => {
    const tabId = 'tab-confirm-1'
    expect(closeArmDecision(armedStore.getSnapshot(), tabId)).toBe('arm')
    armClose(tabId)
    expect(closeArmDecision(armedStore.getSnapshot(), tabId)).toBe('kill')
    disarmClose(tabId)
    expect(closeArmDecision(armedStore.getSnapshot(), tabId)).toBe('arm')
  })

  it('documents a 5 second monitor cadence', () => {
    expect(MONITOR_POLL_MS).toBe(5000)
  })
})

describe('tab definition', () => {
  it('registers a multiple page type with a guide entry', () => {
    const definition = terminalTabDefinition(copied, guideIcon)
    expect(definition.id).toBe(TERMINAL_TAB_ID)
    expect(definition.kind).toBe(TERMINAL_TAB_KIND)
    expect(definition.kind).not.toBe('terminal')
    expect(definition.multiple).toBe(true)
    expect(definition.keepMounted).toBe(true)
    expect(definition.title('')).toBe('copied:title')
    expect(definition.guide).toHaveLength(1)
    expect(definition.guide?.[0]?.id).toBe('new')
    expect(definition.guide?.[0]?.icon).toBe(guideIcon)
  })
})

/** 可编程假宿主：记录 open 调用；tabs 的绑定经 terminalIds 表模拟。 */
function fakeHost(terminals: readonly string[] = []): TerminalMonitorHost & {
  opened: [string, string][]
  tabs: { sessionId: string; tabId: string; kind: string }[]
  failList: boolean
} {
  const tabTerminal = new Map<string, string>()
  const host: TerminalMonitorHost & {
    opened: [string, string][]
    tabs: { sessionId: string; tabId: string; kind: string }[]
    failList: boolean
  } = {
    opened: [],
    tabs: [],
    failList: false,
    currentSessionId: () => SESSION,
    list: async (sessionId: string) => {
      if (host.failList) throw new Error('unavailable')
      return sessionId === SESSION ? snapshotOf(terminals) : snapshotOf([])
    },
    openTabs: () => host.tabs,
    terminalIdOfTab: (sessionId: string, tabId: string) => {
      const found = host.tabs.find(entry => entry.sessionId === sessionId && entry.tabId === tabId)
      return found === undefined ? undefined : tabTerminal.get(tabId)
    },
    openTab: (sessionId: string, terminalId: string) => {
      host.opened.push([sessionId, terminalId])
      const tabId = `tab-${terminalId}`
      host.tabs.push({ sessionId, tabId, kind: TERMINAL_TAB_KIND })
      tabTerminal.set(tabId, terminalId)
    },
    documentVisible: () => true,
  }
  return host
}

describe('terminal tab monitor', () => {
  beforeEach(() => {
    clearAllClosedIntent()
  })

  it('opens tabs for terminals without one, exactly once each', async () => {
    const host = fakeHost(['t1', 't2'])
    const monitor = new TerminalTabMonitor(host)
    await monitor.tick()
    expect(host.opened).toStrictEqual([[SESSION, 't1'], [SESSION, 't2']])
    await monitor.tick()
    expect(host.opened).toHaveLength(2)
  })

  it('does not resurrect a user-closed terminal while the kill is in flight', async () => {
    const host = fakeHost(['t1'])
    const monitor = new TerminalTabMonitor(host)
    markClosedIntent('t1')
    await monitor.tick()
    expect(host.opened).toStrictEqual([])
    expect(isClosedIntent('t1')).toBe(true)
  })

  it('clears the closed intent once the terminal leaves the list (kill confirmed)', async () => {
    const ids: string[] = ['t1']
    const host = fakeHost(ids)
    const monitor = new TerminalTabMonitor(host)
    markClosedIntent('t1')
    await monitor.tick()
    ids.length = 0
    await monitor.tick()
    expect(isClosedIntent('t1')).toBe(false)
    expect(host.opened).toStrictEqual([])
  })

  it('does not let another session\'s tab suppress the foreground session', async () => {
    const host = fakeHost(['t1'])
    host.tabs.push({ sessionId: 'other', tabId: 'tab-x', kind: TERMINAL_TAB_KIND })
    const monitor = new TerminalTabMonitor(host)
    await monitor.tick()
    expect(host.opened).toStrictEqual([[SESSION, 't1']])
  })

  it('ignores failed list polls without opening anything', async () => {
    const host = fakeHost(['t1'])
    host.failList = true
    const monitor = new TerminalTabMonitor(host)
    await monitor.tick()
    expect(host.opened).toStrictEqual([])
    host.failList = false
    await monitor.tick()
    expect(host.opened).toStrictEqual([[SESSION, 't1']])
  })

  it('skips ticks while the page is hidden', async () => {
    const host = fakeHost(['t1'])
    host.documentVisible = () => false
    const monitor = new TerminalTabMonitor(host)
    await monitor.tick()
    expect(host.opened).toStrictEqual([])
  })

  it('coalesces overlapping ticks', async () => {
    const host = fakeHost(['t1'])
    let releaseList: (() => void) | undefined
    host.list = async () => await new Promise<TerminalsSnapshot>((resolve) => {
      releaseList = () => { resolve(snapshotOf(['t1'])) }
    })
    const monitor = new TerminalTabMonitor(host)
    const first = monitor.tick()
    void monitor.tick()
    releaseList?.()
    await first
    expect(host.opened).toStrictEqual([[SESSION, 't1']])
  })
})

describe('terminal bindings', () => {
  it('round-trips a terminal id by (session, contentId) in memory', () => {
    setBinding('s1', 'sidebar://dsh-kit-terminal/abc', 'pty-1')
    expect(getBinding('s1', 'sidebar://dsh-kit-terminal/abc')).toBe('pty-1')
    removeBinding('s1', 'sidebar://dsh-kit-terminal/abc')
    expect(getBinding('s1', 'sidebar://dsh-kit-terminal/abc')).toBeUndefined()
  })
})

describe('ring ready trim', () => {
  const marker = new TextEncoder().encode('dsh> ')

  it('keeps only the tail after the last prompt marker', () => {
    const ring = new BoundedRing()
    ring.append(new TextEncoder().encode('noise [?1.2c\r\n'))
    ring.append(new TextEncoder().encode('\x1b]133;D;0\x07dsh> '))
    expect(ring.trimToTail(marker)).toBe(true)
    expect(new TextDecoder().decode(ring.snapshot())).toBe('dsh> ')
  })

  it('leaves the ring untouched when the marker is absent', () => {
    const ring = new BoundedRing()
    ring.append(new TextEncoder().encode('PS D:\\> dir\r\n'))
    expect(ring.trimToTail(marker)).toBe(false)
    expect(new TextDecoder().decode(ring.snapshot())).toBe('PS D:\\> dir\r\n')
  })

  it('trims the registry entry replay on markReady', () => {
    const taps = new TerminalTapRegistry()
    const handle = fakeHandle()
    taps.bind('pty-3', handle as never, { cols: 160, rows: 40 })
    handle.output.emit('data', Buffer.from('preamble echo dsh> ', 'utf8'))
    taps.markReady('pty-3', marker)
    expect(new TextDecoder().decode(taps.entryOf('pty-3')?.ring.snapshot() ?? new Uint8Array())).toBe('dsh> ')
  })
})
