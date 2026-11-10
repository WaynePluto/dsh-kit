import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startMessageLanding } from '../src/client/landing.js'
import { MAX_LANDING_HOLD_MS, LANDING_HOLD_STABLE_FRAMES } from '../src/client/landing.js'
import { MAX_LANDING_WAIT_MS, MAX_TARGET_WAIT_MS } from '../src/client/locate.js'

/** 实现说明：此处记录相关接口、边界和生命周期约束。 */
function historyWindow() {
  const listeners = new Map<string, Set<() => void>>()
  let currentScrollTop = 800
  const writes: number[] = []
  const port = {
    get scrollTop() { return currentScrollTop },
    set scrollTop(value: number) { writes.push(value); currentScrollTop = value },
    scrollHeight: 1_400,
    clientHeight: 600,
    isConnected: true,
    getBoundingClientRect: () => ({ top: 100, bottom: 700 }),
    querySelector: () => null,
    addEventListener: (type: string, handler: () => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type)?.add(handler)
    },
    removeEventListener: (type: string, handler: () => void) => { listeners.get(type)?.delete(handler) },
  }
  let rowTop = 104
  let rowHeight = 40
  const row = {
    dataset: { chatFlowKey: 'assistant:1:2' },
    hidden: false,
    isConnected: true,
    ownerDocument: undefined,
    closest: () => port,
    getBoundingClientRect: () => ({ top: 100 + rowTop - port.scrollTop, height: rowHeight }),
  }
  let rows = [row]
  const root = { querySelectorAll: () => rows }
  const prepare = vi.fn()
  const onLand = vi.fn()
  const start = (reducedMotion = false) => startMessageLanding({
    root: root as unknown as ParentNode,
    messageKey: 'assistant:1:2',
    reducedMotion,
    prepare,
    onLand,
  })
  return {
    port, row, writes, prepare, onLand, start,
    hideRow: () => { rows = [] },
    showRow: () => { rows = [row] },
    moveRow: (top: number) => { rowTop = top },
    setRowHeight: (height: number) => { rowHeight = height },
    input: (type: string) => { for (const handler of listeners.get(type) ?? []) handler() },
    listenerCount: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('window', {
    requestAnimationFrame: (callback: () => void) => setTimeout(callback, 16),
    cancelAnimationFrame: (id: ReturnType<typeof setTimeout>) => { clearTimeout(id) },
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('history-message landing', () => {
  it('uses multiple real frame positions and lands on the reading line', () => {
    const world = historyWindow()
    world.start()
    expect(world.writes).toHaveLength(0)
    vi.advanceTimersByTime(500)
    expect(world.writes.length).toBeGreaterThan(3)
    expect(new Set(world.writes).size).toBeGreaterThan(3)
    expect(world.port.scrollTop).toBe(80)
    expect(world.onLand).toHaveBeenCalledExactlyOnceWith(world.row, world.port)
    expect(world.prepare).toHaveBeenCalledTimes(1)
    // 落点守护在窗口内把视图保持在阅读线，窗口结束后释放全部监听
    vi.advanceTimersByTime(MAX_LANDING_HOLD_MS)
    expect(world.port.scrollTop).toBe(80)
    expect(world.onLand).toHaveBeenCalledTimes(1)
    expect(world.listenerCount()).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('skips scrolling and flashes in place when the message start is already visible', () => {
    const world = historyWindow()
    // 行顶落在可视区内（无滚动条的短页或开头本来就可见），对齐没有意义
    world.moveRow(1_000)
    world.start()
    expect(world.onLand).toHaveBeenCalledTimes(1)
    expect(world.prepare).not.toHaveBeenCalled()
    expect(world.writes).toHaveLength(0)
    expect(world.listenerCount()).toBe(0)
    vi.advanceTimersByTime(200)
    expect(world.writes).toHaveLength(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('scrolls normally when the message start is only visible below the composer line', () => {
    const world = historyWindow()
    // 行顶在滚动容器底界之下（被 composer 遮住或尚未进入视野）仍要定位
    world.moveRow(1_500)
    world.start()
    expect(world.onLand).not.toHaveBeenCalled()
    expect(world.prepare).toHaveBeenCalledTimes(1)
  })

  it('holds the reading line against non-input drift after landing', () => {
    const world = historyWindow()
    world.start()
    vi.advanceTimersByTime(500)
    expect(world.onLand).toHaveBeenCalledTimes(1)
    // 模拟 dsh 机制在落点后把视图拉回底部
    world.port.scrollTop = 800
    vi.advanceTimersByTime(64)
    expect(world.port.scrollTop).toBe(80)
    expect(world.onLand).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(MAX_LANDING_HOLD_MS)
    expect(world.listenerCount()).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('yields to reader input during the post-landing hold', () => {
    const world = historyWindow()
    world.start()
    vi.advanceTimersByTime(500)
    world.input('pointerdown')
    world.port.scrollTop = 800
    vi.advanceTimersByTime(200)
    expect(world.port.scrollTop).toBe(800)
    expect(vi.getTimerCount()).toBe(0)
    expect(world.listenerCount()).toBe(0)
  })

  it('stops holding once the hold window elapses under a continuous tug', () => {
    const world = historyWindow()
    world.start()
    vi.advanceTimersByTime(500)
    for (let elapsed = 0; elapsed < MAX_LANDING_HOLD_MS + 128; elapsed += 16) {
      world.port.scrollTop = 800
      vi.advanceTimersByTime(16)
    }
    world.port.scrollTop = 800
    vi.advanceTimersByTime(64)
    expect(world.port.scrollTop).toBe(800)
    expect(vi.getTimerCount()).toBe(0)
    expect(world.listenerCount()).toBe(0)
  })

  it('stops holding when the row unmounts instead of chasing zero geometry', () => {
    const world = historyWindow()
    world.start()
    vi.advanceTimersByTime(500)
    ;(world.row as { isConnected: boolean }).isConnected = false
    world.port.scrollTop = 800
    vi.advanceTimersByTime(200)
    expect(world.port.scrollTop).toBe(800)
    expect(vi.getTimerCount()).toBe(0)
    expect(world.listenerCount()).toBe(0)
  })

  it('waits out a transient fold transition instead of chasing zero geometry', () => {
    const world = historyWindow()
    world.start()
    vi.advanceTimersByTime(500)
    expect(world.onLand).toHaveBeenCalledTimes(1)
    world.setRowHeight(0)
    vi.advanceTimersByTime(160)
    world.setRowHeight(40)
    world.port.scrollTop = 800
    vi.advanceTimersByTime(64)
    expect(world.port.scrollTop).toBe(80)
    vi.advanceTimersByTime(400)
    expect(world.port.scrollTop).toBe(80)
    expect(world.onLand).toHaveBeenCalledTimes(1)
  })

  it('re-prepares tail room when the hold write is clamped by the current floor', () => {
    const world = historyWindow()
    // 行顶在可视区之下且目标超过自然底：初始 prepare 未垫出空间时写入被钳制
    world.moveRow(1_500)
    const original = Object.getOwnPropertyDescriptor(world.port, 'scrollTop')!
    const originalGet = original.get as () => number
    const originalSet = original.set as (value: number) => void
    Object.defineProperty(world.port, 'scrollTop', {
      configurable: true,
      get: originalGet,
      set(value: number) {
        const clamped = Math.max(0, Math.min(value, world.port.scrollHeight - world.port.clientHeight))
        originalSet.call(world.port, clamped)
      },
    })
    let prepared = 0
    world.prepare.mockImplementation(() => {
      prepared += 1
      if (prepared >= 2) world.port.scrollHeight = 2_100
    })
    world.start()
    vi.advanceTimersByTime(MAX_LANDING_WAIT_MS + 64)
    expect(world.onLand).not.toHaveBeenCalled()
    vi.advanceTimersByTime(LANDING_HOLD_STABLE_FRAMES * 16 + 64)
    expect(world.prepare.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(world.onLand).toHaveBeenCalledTimes(1)
    expect(world.port.scrollTop).toBe(1_476)
    vi.advanceTimersByTime(MAX_LANDING_HOLD_MS)
    expect(world.listenerCount()).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reports a stable landing through the hold after an animation timeout', () => {
    // 模拟冷启动布局持续变化：动画窗口内外部所有者拒绝写入，随后布局稳定
    const world = historyWindow()
    const realDescriptor = Object.getOwnPropertyDescriptor(world.port, 'scrollTop')
    Object.defineProperty(world.port, 'scrollTop', {
      configurable: true,
      get: () => 800,
      set: () => {},
    })
    world.start()
    vi.advanceTimersByTime(MAX_LANDING_WAIT_MS + 32)
    expect(world.onLand).not.toHaveBeenCalled()
    Object.defineProperty(world.port, 'scrollTop', realDescriptor!)
    world.port.scrollTop = 800
    vi.advanceTimersByTime(LANDING_HOLD_STABLE_FRAMES * 16 + 32)
    expect(world.onLand).toHaveBeenCalledTimes(1)
    expect(world.port.scrollTop).toBe(80)
    vi.advanceTimersByTime(MAX_LANDING_HOLD_MS)
    expect(world.listenerCount()).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('recovers when ChatView resets a frame to the live bottom', () => {
    const world = historyWindow()
    world.start()
    vi.advanceTimersByTime(16)
    world.port.scrollTop = 800
    vi.advanceTimersByTime(500)
    expect(world.port.scrollTop).toBe(80)
    expect(world.writes.length).toBeGreaterThan(4)
    expect(world.onLand).toHaveBeenCalledTimes(1)
  })

  it('uses an instant bounded write when reduced motion is enabled', () => {
    const world = historyWindow()
    world.start(true)
    expect(world.port.scrollTop).toBe(80)
    expect(world.onLand).not.toHaveBeenCalled()
    vi.advanceTimersByTime(40)
    expect(world.port.scrollTop).toBe(80)
    expect(world.writes.filter(value => value === 80)).toHaveLength(2)
    expect(world.onLand).toHaveBeenCalledTimes(1)
  })

  it('waits for the owning flow to commit without requiring an older page', () => {
    const world = historyWindow()
    world.hideRow()
    world.start()
    vi.advanceTimersByTime(100)
    world.showRow()
    vi.advanceTimersByTime(500)
    expect(world.onLand).toHaveBeenCalledTimes(1)
  })

  it('remeasures the same DOM row after layout shifts and tail-room preparation', () => {
    const world = historyWindow()
    world.prepare.mockImplementation(() => { world.port.scrollHeight += 200 })
    world.start()
    world.moveRow(904)
    vi.advanceTimersByTime(500)
    expect(world.port.scrollTop).toBe(880)
    expect(world.onLand).toHaveBeenCalledTimes(1)
  })

  it('accepts the natural top clamp rather than retrying an unreachable inset', () => {
    const world = historyWindow()
    world.moveRow(12)
    world.start(true)
    vi.advanceTimersByTime(40)
    expect(world.port.scrollTop).toBe(0)
    expect(world.onLand).toHaveBeenCalledTimes(1)
  })

  it.each(['pointerdown', 'wheel', 'keydown'])('yields to reader %s input', type => {
    const world = historyWindow()
    world.start()
    world.input(type)
    vi.advanceTimersByTime(MAX_LANDING_WAIT_MS)
    expect(world.writes).toHaveLength(0)
    expect(world.onLand).not.toHaveBeenCalled()
    expect(world.listenerCount()).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('bounds a missing-row wait and never reports a failed landing', () => {
    const world = historyWindow()
    world.hideRow()
    world.start()
    vi.advanceTimersByTime(MAX_TARGET_WAIT_MS + 32)
    expect(world.onLand).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('bounds corrections if an external owner keeps refusing the scroll', () => {
    const world = historyWindow()
    Object.defineProperty(world.port, 'scrollTop', {
      configurable: true,
      get: () => 800,
      set: () => {},
    })
    world.start()
    // 动画超时后守护接管，守护窗口耗尽才完全释放
    vi.advanceTimersByTime(MAX_LANDING_WAIT_MS + MAX_LANDING_HOLD_MS + 64)
    expect(world.onLand).not.toHaveBeenCalled()
    expect(world.listenerCount()).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })
})
