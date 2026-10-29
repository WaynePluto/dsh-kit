/**
 * panel-toggle 的 browser half：侧栏面板行（插件、自动化任务、服务等）再点一次
 * 回到当前会话。上游 PanelRow 的点击无条件 `selectPanel(id)`，对已选中的行是无效
 * 重选；本组件在 document 捕获阶段拦截活动面板行的点击，改调
 * `layout.selectPanel(null)`——与上游 clearMain 回会话同一条路径，面板页卸载、
 * 会话列重新挂载时仍是原来的 mainView 会话。拦截判定见 `toggle.ts`。
 *
 * 已知边界：面板页展示期间会话结束时，上游 status-controller 因 mainView 保留
 * 仍在而不记「完成未读」（isMain 判定），本组件只提供顺手的返回动作，不改变
 * 未读判定。上游若原生实现面板行 toggle，本组件应当移除（README 有醒目说明）。
 *
 * @module @dsh-kit/dsh-plugin-panel-toggle/client
 */

import type { Context } from '@deepseek-ai/cordis'
// 仅类型：引入声明本插件读取的 Context service merge（layout 服务）。
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { installPanelToggle } from './toggle.js'

export { ACTIVE_PANEL_ROW_SELECTOR, installPanelToggle, PANEL_LIST_SELECTOR } from './toggle.js'
export type { PanelToggleDeps } from './toggle.js'

/** browser half 使用的 service：layout 提供面板选中状态与回会话的 selectPanel(null)。 */
export const inject = ['layout']

/** 注册文案并安装侧栏活动面板行的 toggle 拦截。 */
export function apply(ctx: Context): void {
  if (typeof document === 'undefined') return
  ctx.effect(() => installPanelToggle({
    document,
    hasActivePanel: () => ctx.layout.panelInfo.getSnapshot().activePanelId !== null,
    returnToConversation: () => { ctx.layout.selectPanel(null) },
  }), 'panel-toggle: sidebar active panel row toggle')
}
