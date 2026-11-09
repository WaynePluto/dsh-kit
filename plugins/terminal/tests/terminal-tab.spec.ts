/** 测试：tap registry（ring/扇出/退出）、关闭确认臂、monitor 视图收敛、tab 定义与 bindings。 */

import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  MONITOR_POLL_MS, TERMINAL_TAB_ID, TERMINAL_TAB_KIND, TerminalTabMonitor,
  armedStore, armClose, clearAllClosedIntent, closeArmDecision, disarmClose,
  isClosedIntent, markClosedIntent, terminalTabDefinition,
} from '../src/client/terminal-tab.js'
import { BoundedRing, TerminalQueryStripper, TerminalTapRegistry } from '../src/terminal-tap.js'
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

/** 字节解码为 utf8 文本（stripper 断言用）。 */
function text(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes)
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

  it('advances the entry geometry on setGeometry (size frame contract)', () => {
    const taps = new TerminalTapRegistry()
    const handle = fakeHandle()
    const entry = taps.bind('pty-g', handle as never, { cols: 160, rows: 40 })
    expect(entry.size).toStrictEqual({ cols: 160, rows: 40 })
    taps.setGeometry('pty-g', { cols: 96, rows: 28 })
    expect(taps.entryOf('pty-g')?.size).toStrictEqual({ cols: 96, rows: 28 })
    // 未知终端静默忽略（resize 竞 close 时不抛错）。
    taps.setGeometry('pty-missing', { cols: 80, rows: 24 })
    expect(taps.entryOf('pty-missing')).toBeUndefined()
  })

  it('strips terminal queries from the browser-bound stream but not the raw handle stream', () => {
    const taps = new TerminalTapRegistry()
    const handle = fakeHandle()
    const entry = taps.bind('pty-q', handle as never, { cols: 160, rows: 40 })
    // 输出含 DSR 查询、DA 请求与普通字节；浏览器订阅者不应看到查询（否则 xterm 自动应答，
    // 双重应答污染 PTY 输入——幽灵输入根因）。绝对定位等非查询序列原样保留。
    handle.output.emit('data', Buffer.from('A\x1b[6nB\x1b[>0cC\x1b[cD', 'binary'))
    handle.output.emit('data', Buffer.from('E\x1b[2;10HF', 'binary'))
    expect(new TextDecoder().decode(entry.ring.snapshot())).toBe('ABCDE\x1b[2;10HF')
    const seen: string[] = []
    entry.listeners.add(frame => { if (frame.kind === 'data') seen.push(new TextDecoder().decode(frame.bytes)) })
    handle.output.emit('data', Buffer.from('x\x1b[6ny', 'binary'))
    expect(seen.join('')).toBe('xy')
    taps.remove('pty-q')
  })
})

describe('terminal query stripper', () => {
  it('drops DSR cursor and DA-family queries, passes everything else through', () => {
    const stripper = new TerminalQueryStripper()
    expect(text(stripper.feed(new TextEncoder().encode('A\x1b[6nB\x1b[cC\x1b[>0cD\x1b[=cE')))).toBe('ABCDE')
  })

  it('holds a partial escape sequence across chunks and resolves it with the next chunk', () => {
    const stripper = new TerminalQueryStripper()
    // 查询序列被 chunk 边界切开：挂起部分不吐出，下一片判定后丢弃。
    expect(stripper.feed(new TextEncoder().encode('A\x1b')).length).toBe(1)
    expect(stripper.feed(new TextEncoder().encode('[6')).length).toBe(0)
    expect(stripper.feed(new TextEncoder().encode('nB'))).toStrictEqual(new TextEncoder().encode('B'))
    // 非 CSI 的 ESC 序列（OSC 标题等）整对放行，负载里的伪查询字节不受影响。
    expect(text(stripper.feed(new TextEncoder().encode('\x1b]0;t\x1b[6n;\x07x')))).toBe('\x1b]0;t\x1b[6n;\x07x')
  })

  it('passes cursor-position reports and normal escapes through untouched', () => {
    const stripper = new TerminalQueryStripper()
    // 应答/重绘类序列（绝对定位、颜色、DSR 应答形状）不是查询，必须原样保留。
    const passthrough = '\x1b[2;10Hhi\x1b[1;33H\x1b[?25h\x1b[38;6R\r\nOK'
    expect(text(stripper.feed(new TextEncoder().encode(passthrough)))).toBe(passthrough)
  })

  it('flushes a defensively overlong parameter run instead of stalling', () => {
    const stripper = new TerminalQueryStripper()
    const long = `\x1b[${'0'.repeat(20)}m`
    expect(text(stripper.feed(new TextEncoder().encode(`x${long}y`)))).toBe(`x${long}y`)
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
