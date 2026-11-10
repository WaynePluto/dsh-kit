import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startMessageLanding } from '../src/client/landing.js'
import { MAX_LANDING_HOLD_MS, LANDING_HOLD_STABLE_FRAMES } from '../src/client/landing.js'
import { MAX_LANDING_WAIT_MS, MAX_TARGET_WAIT_MS } from '../src/client/locate.js'

/** 实现说明：此处记录相关接口、边界和生命周期约束。 */
function historyWindow(options: { turn?: string; scrollTop?: number; scrollHeight?: number } = {}) {
  const listeners = new Map<string, Set<() => void>>()
  let currentScrollTop = options.scrollTop ?? 800
  const writes: number[] = []
  const port = {
    get scrollTop() { return currentScrollTop },
    set scrollTop(value: number) { writes.push(value); currentScrollTop = value },
    scrollHeight: options.scrollHeight ?? 1_400,
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
  // turn 头部替身：33px 高（含 border-bottom 分割线），默认与行上沿相距 16px
  let headerTop = rowTop - 16 - 33
  const header = {
    hidden: false,
    isConnected: true,
    getAttribute: (name: string) => (name === 'data-turn-process' ? options.turn ?? null : null),
    getBoundingClientRect: () => ({
      top: 100 + headerTop - port.scrollTop,
      bottom: 100 + headerTop - port.scrollTop + 33,
      height: 33,
    }),
  }
  // 行的父层替身：只为同 turn 的 turn-process 头部查询命中
  const scope = {
    querySelector: (selector: string) => (
      options.turn !== undefined && selector.includes(`[data-chat-turn="${options.turn}"]`) ? header : null
    ),
  }
  const row = {
    dataset: { chatFlowKey: 'assistant:1:2', chatTurn: options.turn },
    hidden: false,
    isConnected: true,
    ownerDocument: undefined,
    parentElement: options.turn === undefined ? null : scope,
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
    port, row, header, writes, prepare, onLand, start,
    hideRow: () => { rows = [] },
    showRow: () => { rows = [row] },
    moveRow: (top: number) => { rowTop = top },
    setRowHeight: (height: number) => { rowHeight = height },
    moveHeader: (top: number) => { headerTop = top },
    hideHeader: () => { header.hidden = true },
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
    expect(world.port.scrollTop).toBe(84)
    expect(world.onLand).toHaveBeenCalledExactlyOnceWith(world.row, world.port, null)
    expect(world.prepare).toHaveBeenCalledTimes(1)
    // 落点守护在窗口内把视图保持在阅读线，窗口结束后释放全部监听
    vi.advanceTimersByTime(MAX_LANDING_HOLD_MS)
    expect(world.port.scrollTop).toBe(84)
    expect(world.onLand).toHaveBeenCalledTimes(1)
    expect(world.listenerCount()).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('anchors the landing on the native turn divider when it sits directly above the row', () => {
    // 头部下沿（分割线）距行上沿 16px：滚动目标变为头部整行落在阅读线上，
    // 分割线落在其下方；onLand 带回命中的头部供原生线高亮。
    const world = historyWindow({ turn: '3' })
    world.start()
    vi.advanceTimersByTime(500)
    expect(world.port.scrollTop).toBe(104 - 16 - 33 - 20)
    expect(world.prepare).toHaveBeenCalledWith(world.row, world.port, 104 - 16 - 33 - 20)
    expect(world.onLand).toHaveBeenCalledExactlyOnceWith(world.row, world.port, world.header)
    // 落点守护同样以头部为锚保持落点
    world.port.scrollTop = 800
    vi.advanceTimersByTime(64)
    expect(world.port.scrollTop).toBe(104 - 16 - 33 - 20)
  })

  it('anchors the turn header even when it sits far above the message', () => {
    // 多步轮次：头部远在消息上方，仍然落在本轮头部（回到这一轮的开头），
    // 不是落在最后这条消息的开头。
    const world = historyWindow({ turn: '3', scrollTop: 500, scrollHeight: 3_000 })
    world.moveRow(700)
    world.moveHeader(400)
    world.start()
    vi.advanceTimersByTime(500)
    expect(world.port.scrollTop).toBe(380)
    expect(world.onLand).toHaveBeenCalledExactlyOnceWith(world.row, world.port, world.header)
  })

  it('falls back to the row anchor when the turn header is folded away', () => {
    // 整轮折叠时头部零高不可测量：退回消息行锚点，onLand 带回 null
    const world = historyWindow({ turn: '3' })
    world.hideHeader()
    world.start()
    vi.advanceTimersByTime(500)
    expect(world.port.scrollTop).toBe(84)
    expect(world.onLand).toHaveBeenCalledExactlyOnceWith(world.row, world.port, null)
  })

  it('skips scrolling and reports the divider when the header is already visible', () => {
    // 头部已在可视区内：不滚动、不垫尾部空间，直接把命中的头部交给闪线。
    const world = historyWindow({ turn: '3' })
    world.moveHeader(945)
    world.moveRow(945 + 33 + 16)
    world.start()
    expect(world.onLand).toHaveBeenCalledTimes(1)
    expect(world.onLand).toHaveBeenCalledWith(world.row, world.port, world.header)
    expect(world.prepare).not.toHaveBeenCalled()
    expect(world.writes).toHaveLength(0)
    expect(world.listenerCount()).toBe(0)
  })

  it('scrolls a visible message start to the landing inset when content still follows', () => {
    // 长会话里消息开头在屏幕中部可见（真实反馈的「定位不对」场景）：下方仍有内容，
    // 对齐落点不需要垫尾部空白，必须照常滚动而不是原地闪线。
    const world = historyWindow({ scrollTop: 500, scrollHeight: 3_000 })
    world.moveRow(700)
    world.start()
    vi.advanceTimersByTime(500)
    expect(world.port.scrollTop).toBe(680)
    expect(world.prepare).toHaveBeenCalledExactlyOnceWith(world.row, world.port, 680)
    expect(world.onLand).toHaveBeenCalledExactlyOnceWith(world.row, world.port, null)
  })

  it('aligns a visible turn header when its turn still has content below', () => {
    const world = historyWindow({ turn: '3', scrollTop: 500, scrollHeight: 3_000 })
    world.moveRow(700)
    world.moveHeader(651)
    world.start()
    vi.advanceTimersByTime(500)
    // 头部 rect top 251（行 300 上沿 16px 处是分割线），锚点取头部
    expect(world.port.scrollTop).toBe(631)
    expect(world.onLand).toHaveBeenCalledExactlyOnceWith(world.row, world.port, world.header)
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
    expect(world.port.scrollTop).toBe(84)
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
    expect(world.port.scrollTop).toBe(84)
    vi.advanceTimersByTime(400)
    expect(world.port.scrollTop).toBe(84)
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
    expect(world.port.scrollTop).toBe(1_480)
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
    expect(world.port.scrollTop).toBe(84)
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
    expect(world.port.scrollTop).toBe(84)
    expect(world.writes.length).toBeGreaterThan(4)
    expect(world.onLand).toHaveBeenCalledTimes(1)
  })

  it('uses an instant bounded write when reduced motion is enabled', () => {
    const world = historyWindow()
    world.start(true)
    expect(world.port.scrollTop).toBe(84)
    expect(world.onLand).not.toHaveBeenCalled()
    vi.advanceTimersByTime(40)
    expect(world.port.scrollTop).toBe(84)
    expect(world.writes.filter(value => value === 84)).toHaveLength(2)
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
    expect(world.port.scrollTop).toBe(884)
    expect(world.onLand).toHaveBeenCalledTimes(1)
  })

  it('accepts the natural top clamp instead of forcing an unreachable position', () => {
    // 锚点已在滚动容器上方（负数目标）：浏览器钳到 0，落点按当前几何确认
    const world = historyWindow()
    world.moveRow(-200)
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
