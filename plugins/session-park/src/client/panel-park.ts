/**
 * 面板停靠的判定与安装编排：面板页接管 main 视图时停靠运行中的会话，测试逐项注入依赖。
 *
 * 上游事实（0.2.1-rc.5 核实，rc.3 起一致，docs/dsh/plugins.md「全局面板」）：
 * - 侧栏面板行与「更多」菜单项都经 `layout.selectPanel(id)` 切面板，选中态在
 *   `layout.panelInfo`（defineStore 默认 sync flush，订阅同步通知）；
 * - `layout.selectPanel` 会 abort 挂起的导航（LayoutController），因此停靠发起后
 *   用户任何换面板/回会话/开新会话操作都会让上游放弃这次停靠（navigation.aborted）；
 * - 停靠走 `uiWorkspace.startSession()`，其 replaceMain 以 'reveal' 收尾——换持
 *   mainView 后调 `layout.selectPanel(null)` 把面板切回会话视图，面板页被 deselect。
 *
 * 因此本模块在面板选中（null → 面板，含换面板）且当前 main 会话运行中时发起停靠，
 * 并在「我们发起的停靠落了地」的那次 reveal（面板 → null）里同步把面板选回来：
 * 恢复发生在同一次同步通知内、React 提交渲染之前，面板页不重挂、无闪烁。落了地的
 * 判据是「当前 main 会话已是 blank」——停靠 reveal 先换持 mainView 再 deselect
 * （`adapter.current` 由 retainInfo 订阅同步更新），用户自己的回会话
 * （点会话行 / panel-toggle 再点面板行 / 新建会话）则 main 不是停靠的 blank，
 * 不恢复、停靠也被上游 abort，互不纠缠。
 *
 * 已知边界（窗口 = 一次 blank 复用/创建 RPC，通常几毫秒）：停靠在途时用户点开一个
 * blank 会话行或点了「新建会话」，null 到来时 main 同样是 blank，会被误判为我们的
 * 停靠而把面板选回来——再点一次即可，无数据影响。
 *
 * @module @dsh-kit/dsh-plugin-session-park/client/panel-park
 */

import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'

/** {@link installPanelPark} 的全部外部依赖，测试逐项注入。 */
export interface PanelParkDeps {
  /** 订阅面板选中变化（layout.panelInfo.subscribe）。 */
  subscribePanels: (listener: () => void) => () => void
  /** 当前选中面板 id；null = 会话视图（`panelInfo.getSnapshot().activePanelId`）。 */
  getActivePanel: () => MainPanelId | null
  /** 恢复面板选中（`layout.selectPanel`；面板已注销时上游 throw）。 */
  selectPanel: (panelId: MainPanelId) => void
  /** 当前 main 会话是否运行中；无 main 会话时为 false。 */
  isMainSessionRunning: () => boolean
  /** 当前 main 会话是否 blank（停靠落地的判据）。 */
  isMainSessionBlank: () => boolean
  /** 停靠动作：把 mainView 让给当前工作区的 blank 会话（uiWorkspace.startSession()）。 */
  park: () => void
}

/**
 * 安装面板停靠监听。面板选中且 main 会话运行中时停靠；我们发起的停靠落地后
 * （reveal 把面板切回会话视图）同步恢复面板选中。安装时已选中的面板不追溯
 * （插件装载/HMR 不是用户点击）。
 * @param deps - 外部依赖。
 * @returns 卸载函数：移除订阅。
 */
export function installPanelPark(deps: PanelParkDeps): () => void {
  let previous = deps.getActivePanel()
  /** 我们发起、尚未落地或刚落地的停靠要恢复的面板；undefined = 无。 */
  let restorePanel: MainPanelId | undefined = undefined

  const onPanelsChanged = (): void => {
    const current = deps.getActivePanel()
    if (current === previous) return
    const from = previous
    previous = current
    if (current !== null) {
      // 打开或切换面板：旧的恢复意图作废（上游已 abort 那次停靠），按新面板重新判定。
      restorePanel = undefined
      if (deps.isMainSessionRunning()) {
        restorePanel = current
        deps.park()
      }
      return
    }
    // 面板让位给会话视图：只有「我们发起的停靠已落地」才恢复面板——main 已是
    // blank 说明 null 来自停靠 reveal 的 deselect；用户自己的回会话不是。
    const restore = restorePanel !== undefined && restorePanel === from && deps.isMainSessionBlank()
      ? restorePanel
      : undefined
    restorePanel = undefined
    if (restore === undefined) return
    try {
      deps.selectPanel(restore)
    } catch {
      // 面板 key 已注销（其插件正在停用）：留在会话视图，不再恢复。
    }
  }

  const dispose = deps.subscribePanels(onPanelsChanged)
  return () => { dispose() }
}
