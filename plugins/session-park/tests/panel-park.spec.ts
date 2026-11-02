// @vitest-environment jsdom
/** 面板停靠的判定测试：面板选中停靠、停靠落地恢复面板、用户回会话不恢复、卸载。 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { installPanelPark } from '../src/client/panel-park.js'

/** 面板选中状态的可控桩：setPanel 改写并同步通知订阅者（与上游 sync flush 一致）。 */
interface PanelHarness {
  /** 改写面板选中并同步派发通知；null = 会话视图。 */
  setPanel: (id: string | null) => void
  dispose: () => void
  park: ReturnType<typeof vi.fn>
  isMainSessionRunning: ReturnType<typeof vi.fn>
  isMainSessionPendingInteraction: ReturnType<typeof vi.fn>
  isMainSessionBlank: ReturnType<typeof vi.fn>
  selectPanel: ReturnType<typeof vi.fn>
}

/**
 * 装一个面板停靠。`running`/`blank` 给 main 会话状态的当前值；测试中途可改写
 * `isMainSessionRunning.mockReturnValue` 模拟「停靠 reveal 已换持 blank」。
 */
function harness(options?: { running?: boolean; blank?: boolean; pending?: boolean; initial?: string | null }): PanelHarness {
  const listeners = new Set<() => void>()
  let active: MainPanelId | null = (options?.initial ?? null) as MainPanelId | null
  const park = vi.fn()
  const isMainSessionRunning = vi.fn(() => options?.running ?? true)
  const isMainSessionPendingInteraction = vi.fn(() => options?.pending ?? false)
  const isMainSessionBlank = vi.fn(() => options?.blank ?? false)
  const selectPanel = vi.fn((id: MainPanelId) => { setPanel(id) })
  const setPanel = (id: string | null): void => {
    active = id as MainPanelId | null
    for (const listener of listeners) listener()
  }
  const dispose = installPanelPark({
    subscribePanels: listener => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    getActivePanel: () => active,
    selectPanel,
    isMainSessionRunning,
    isMainSessionPendingInteraction,
    isMainSessionBlank,
    park,
  })
  return { setPanel, dispose, park, isMainSessionRunning, isMainSessionPendingInteraction, isMainSessionBlank, selectPanel }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('installPanelPark', () => {
  it('打开面板且 main 会话运行中：停靠一次', () => {
    const h = harness()
    h.setPanel('dsh-plugin-services')
    expect(h.park).toHaveBeenCalledTimes(1)
    h.dispose()
  })

  it('main 会话不在运行（含无 main）：打开面板不停靠', () => {
    const h = harness({ running: false })
    h.setPanel('plugins')
    expect(h.park).not.toHaveBeenCalled()
    h.dispose()
  })

  it('main 会话待用户操作（黄点）：打开面板不停靠（黄点需用户答题才消失）', () => {
    const h = harness({ pending: true })
    h.setPanel('plugins')
    expect(h.park).not.toHaveBeenCalled()
    h.dispose()
  })

  it('停靠落地（reveal 把面板切回会话视图、main 已是 blank）：同步恢复面板', () => {
    const h = harness()
    h.setPanel('dsh-plugin-services')
    // 上游 replaceMain('reveal')：先换持 mainView（main 变 blank），再 selectPanel(null)。
    h.isMainSessionRunning.mockReturnValue(false)
    h.isMainSessionBlank.mockReturnValue(true)
    h.setPanel(null)
    expect(h.selectPanel).toHaveBeenCalledWith('dsh-plugin-services')
    // 恢复本身选中面板：无新停靠（main 已是 blank、不在运行）。
    expect(h.park).toHaveBeenCalledTimes(1)
    h.dispose()
  })

  it('用户自己回会话（main 不是 blank）：不恢复面板', () => {
    const h = harness()
    h.setPanel('dsh-plugin-services')
    // 用户点了会话行：replaceMain 换到目标会话（非 blank）并 selectPanel(null)。
    h.isMainSessionBlank.mockReturnValue(false)
    h.setPanel(null)
    expect(h.selectPanel).not.toHaveBeenCalled()
    h.dispose()
  })

  it('panel-toggle 再点面板行回会话（main 仍是原运行会话）：不恢复面板', () => {
    const h = harness()
    h.setPanel('dsh-plugin-services')
    h.setPanel(null)
    expect(h.selectPanel).not.toHaveBeenCalled()
    h.dispose()
  })

  it('停靠在途时切换到另一面板：按新面板重新停靠，旧恢复意图作废', () => {
    const h = harness()
    h.setPanel('plugins')
    h.setPanel('dsh-plugin-services')
    expect(h.park).toHaveBeenCalledTimes(2)
    // 第二次停靠落地：恢复的是新面板。
    h.isMainSessionRunning.mockReturnValue(false)
    h.isMainSessionBlank.mockReturnValue(true)
    h.setPanel(null)
    expect(h.selectPanel).toHaveBeenCalledWith('dsh-plugin-services')
    h.dispose()
  })

  it('打开面板但未停靠过（不在运行）：null 时不恢复', () => {
    const h = harness({ running: false })
    h.setPanel('plugins')
    h.isMainSessionBlank.mockReturnValue(true)
    h.setPanel(null)
    expect(h.selectPanel).not.toHaveBeenCalled()
    h.dispose()
  })

  it('恢复时面板已注销（selectPanel throw）：吞掉异常、状态清空', () => {
    const h = harness()
    h.selectPanel.mockImplementationOnce(() => { throw new Error('main panel "x" is not registered') })
    h.setPanel('plugins')
    h.isMainSessionRunning.mockReturnValue(false)
    h.isMainSessionBlank.mockReturnValue(true)
    expect(() => { h.setPanel(null) }).not.toThrow()
    // 状态已清：后续面板变化按新轮次判定。
    h.isMainSessionRunning.mockReturnValue(true)
    h.setPanel('plugins')
    expect(h.park).toHaveBeenCalledTimes(2)
    h.dispose()
  })

  it('安装时已选中的面板不追溯停靠', () => {
    const h = harness({ initial: 'plugins' })
    // 无变化通知，也不补停靠。
    expect(h.park).not.toHaveBeenCalled()
    h.setPanel('dsh-plugin-services')
    expect(h.park).toHaveBeenCalledTimes(1)
    h.dispose()
  })

  it('卸载：订阅移除，面板变化不再停靠', () => {
    const h = harness()
    h.dispose()
    h.setPanel('plugins')
    expect(h.park).not.toHaveBeenCalled()
    h.dispose()
  })

  it('通知到达但选中值未变（同值写）：不动作', () => {
    const h = harness({ initial: 'plugins' })
    // store 同值重写也派发通知（layout 的其他字段变化同样触发）。
    h.setPanel('plugins')
    expect(h.park).not.toHaveBeenCalled()
    h.dispose()
  })
})
