/**
 * session-park 的 browser half：两类「人已离开会话视图」的信号都把 mainView 让给
 * 当前工作区的空白会话（官方 `uiWorkspace.startSession()`，与原生「新建会话」同路径，
 * blank 复用不会堆积会话），使会话结束按上游 isMain 语义记「完成未读」绿点：
 * - 切屏离开（窗口失焦/隐藏持续 3 秒），判定与安装见 `park.ts`；
 * - 侧栏面板菜单项接管 main 视图（插件/自动化任务/服务/任务看板与「更多」菜单项，
 *   经 `layout.selectPanel` 的面板选中），停靠后同步把面板选回来、页面不停留在
 *   空白会话上，判定与安装见 `panel-park.ts`。
 *
 * 上游事实（docs/dsh/workspace.md「完成未读的精确机制」）：停在运行中的会话上切屏、
 * 或被插件/服务等面板页挡住（面板页不清 mainView retain），会话结束都不记未读；
 * 本组件在「人已离开」时满足该判定的前提。待操作（黄点，pendingInteraction：审批/
 * 计划确认/提问）不会自动消失、需要用户回答才清除，此时停靠只会把要操作的会话从
 * 眼前换走，因此运行判定之外还排除黄点状态（官方 `uiSession.sessionStatus` 快照）。
 *
 * 已知边界：失焦后 `PARK_DELAY_MS` 内会话恰好结束则不停靠（该次结束不记未读，但
 * 用户很快回来时内容就在眼前）；当前视图是子代理会话时 sessions 列表无对应行，
 * 判定为不在运行、不动作；无 main 会话（全空白）同样不动作。面板停靠的边界见
 * `panel-park.ts` 模块注释。
 *
 * @module @dsh-kit/dsh-plugin-session-park/client
 */

import type { Context } from '@deepseek-ai/cordis'
// 仅类型 import：激活 Context service merge（layout、sessions、uiSession、uiWorkspace）。
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { installSessionPark, PARK_DELAY_MS } from './park.js'
import { installPanelPark } from './panel-park.js'

export { installSessionPark, PARK_DELAY_MS } from './park.js'
export type { SessionParkDeps } from './park.js'
export { installPanelPark } from './panel-park.js'
export type { PanelParkDeps } from './panel-park.js'

/** browser half 使用的 service：面板选中、sessions 列表、uiSession 当前 main、uiWorkspace 导航。 */
export const inject = ['layout', 'sessions', 'uiSession', 'uiWorkspace']

/** 注册切屏与面板停靠监听。 */
export function apply(ctx: Context): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  // 面板页选中时会话列卸载，但 mainView 由工作区导航层持有，current 仍可解析
  // （services 面板同款锚点读取）。
  const mainKey = (): SessionId | undefined =>
    ctx.uiSession.adapter.current.getSnapshot().key as SessionId | undefined
  const mainSummary = () => {
    const key = mainKey()
    return key === undefined ? undefined : ctx.sessions.list.getSnapshot().byId[key]
  }
  // 黄点（待用户操作：审批/计划确认/提问）来自官方 sessionStatus 快照；黄点不会自动
  // 消失、需要用户答题才清除，停靠换出会话视图无收益，两条停靠路径都排除。
  const isMainSessionPendingInteraction = (): boolean => {
    const key = mainKey()
    return key !== undefined
      && ctx.uiSession.sessionStatus.getSnapshot().get(key)?.pendingInteraction !== undefined
  }
  ctx.effect(() => installSessionPark({
    window,
    document,
    isMainSessionRunning: () => mainSummary()?.running === true,
    isMainSessionPendingInteraction,
    park: () => { ctx.uiWorkspace.startSession() },
    delayMs: PARK_DELAY_MS,
    setTimeout: (handler, timeout) => window.setTimeout(handler, timeout),
    clearTimeout: handle => window.clearTimeout(handle as number),
  }), 'session-park: away park on running session')
  ctx.effect(() => installPanelPark({
    subscribePanels: listener => ctx.layout.panelInfo.subscribe(listener),
    getActivePanel: () => ctx.layout.panelInfo.getSnapshot().activePanelId,
    selectPanel: panelId => { ctx.layout.selectPanel(panelId) },
    isMainSessionRunning: () => mainSummary()?.running === true,
    isMainSessionPendingInteraction,
    isMainSessionBlank: () => mainSummary()?.blank === true,
    park: () => { ctx.uiWorkspace.startSession() },
  }), 'session-park: panel park on running session')
}
