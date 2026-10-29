// @vitest-environment jsdom
/** 切屏停靠的判定测试：预约与取消、到点复查、一次离开单次停靠、卸载。 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { installSessionPark, PARK_DELAY_MS } from '../src/client/park.js'
import { inject } from '../src/client/index.js'

/** 手动推进的计时器队列：setTimeout 记账，firePending 触发到点。 */
interface FakeTimer {
  handler: () => void
  ms: number
  cleared: boolean
  fired: boolean
}

/** 焦点与可见性状态桩：jsdom 不随 blur/focus 事件更新真实状态，测试直接改写。 */
function stubWindowState(state: { focused: boolean; visibility: 'visible' | 'hidden' }): void {
  document.hasFocus = () => state.focused
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state.visibility,
  })
}

/** 派发 window 焦点事件（真实浏览器里事件与状态同步，这里两者都显式给）。 */
function focusWindow(state: { focused: boolean; visibility: 'visible' | 'hidden' }): void {
  state.focused = true
  stubWindowState(state)
  window.dispatchEvent(new Event('focus'))
}

function blurWindow(state: { focused: boolean; visibility: 'visible' | 'hidden' }): void {
  state.focused = false
  stubWindowState(state)
  window.dispatchEvent(new Event('blur'))
}

function hideWindow(state: { focused: boolean; visibility: 'visible' | 'hidden' }): void {
  state.visibility = 'hidden'
  stubWindowState(state)
  document.dispatchEvent(new Event('visibilitychange'))
}

function showWindow(state: { focused: boolean; visibility: 'visible' | 'hidden' }): void {
  state.visibility = 'visible'
  stubWindowState(state)
  document.dispatchEvent(new Event('visibilitychange'))
}

function harness(running = true, delayMs = 1000) {
  const state = { focused: true, visibility: 'visible' as 'visible' | 'hidden' }
  stubWindowState(state)
  const park = vi.fn()
  const isMainSessionRunning = vi.fn(() => running)
  const timers: FakeTimer[] = []
  const dispose = installSessionPark({
    window,
    document,
    isMainSessionRunning,
    park,
    delayMs,
    setTimeout: (handler, ms) => {
      const timer: FakeTimer = { handler: () => { timer.fired = true; handler() }, ms, cleared: false, fired: false }
      timers.push(timer)
      return timer
    },
    clearTimeout: handle => { (handle as FakeTimer).cleared = true },
  })
  return { state, dispose, park, isMainSessionRunning, timers }
}

/** 触发全部未清除、未触发过的到点回调（按预约顺序）。 */
function firePending(timers: FakeTimer[]): void {
  for (const timer of timers) {
    if (!timer.cleared && !timer.fired) timer.handler()
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('契约', () => {
  it('browser half 注入三个导航与状态服务', () => {
    expect(inject).toEqual(['sessions', 'uiSession', 'uiWorkspace'])
  })

  it('停靠延迟为 3 秒', () => {
    expect(PARK_DELAY_MS).toBe(3000)
  })
})

describe('installSessionPark', () => {
  it('失焦到点且会话运行中：停靠一次；到点前不动作', () => {
    const { state, dispose, park, timers } = harness()
    blurWindow(state)

    firePending(timers.slice(0, 0))
    expect(park).not.toHaveBeenCalled()

    firePending(timers)
    expect(park).toHaveBeenCalledTimes(1)
    dispose()
  })

  it('delay 内回来（focus）取消停靠', () => {
    const { state, dispose, park, timers } = harness()
    blurWindow(state)
    focusWindow(state)

    firePending(timers)
    expect(park).not.toHaveBeenCalled()
    dispose()
  })

  it('到点时不在运行：不停靠（失焦窗口内会话恰好结束）', () => {
    const { state, dispose, park, timers } = harness(false)
    blurWindow(state)

    firePending(timers)
    expect(park).not.toHaveBeenCalled()
    dispose()
  })

  it('到点复查已回焦但 focus 事件缺失：不停靠（仍离开才动作）', () => {
    const { state, dispose, park, timers } = harness()
    blurWindow(state)
    // 状态恢复但没发 focus 事件（事件与状态错过的防御）。
    state.focused = true

    firePending(timers)
    expect(park).not.toHaveBeenCalled()
    dispose()
  })

  it('隐藏（visibilitychange）同样预约，恢复可见取消', () => {
    const { state, dispose, park, timers } = harness()
    hideWindow(state)
    expect(timers.length).toBe(1)

    showWindow(state)
    firePending(timers)
    expect(park).not.toHaveBeenCalled()
    dispose()
  })

  it('最小化（blur + hidden 连续触发）只预约一个定时器', () => {
    const { state, dispose, park, timers } = harness()
    blurWindow(state)
    hideWindow(state)
    expect(timers.length).toBe(1)

    firePending(timers)
    expect(park).toHaveBeenCalledTimes(1)
    dispose()
  })

  it('停靠后仍处于离开状态：同一轮离开不再二次预约或停靠', () => {
    const { state, dispose, park, timers } = harness()
    blurWindow(state)

    firePending(timers)
    expect(park).toHaveBeenCalledTimes(1)
    expect(timers.length).toBe(1)
    dispose()
  })

  it('回来再次离开：按新的一轮重新停靠', () => {
    const { state, dispose, park, timers } = harness()
    blurWindow(state)
    firePending(timers)
    focusWindow(state)
    blurWindow(state)

    firePending(timers)
    expect(park).toHaveBeenCalledTimes(2)
    dispose()
  })

  it('卸载：待发定时器清除，后续 blur 不再预约', () => {
    const { state, dispose, park, timers } = harness()
    blurWindow(state)
    dispose()

    expect(timers[0]?.cleared).toBe(true)
    blurWindow(state)
    expect(timers.length).toBe(1)

    firePending(timers)
    expect(park).not.toHaveBeenCalled()
    dispose()
  })
})
