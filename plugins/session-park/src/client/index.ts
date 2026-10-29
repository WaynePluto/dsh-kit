/**
 * session-park 的 browser half：切屏离开且当前 main 会话运行中时，把 mainView 让给
 * 当前工作区的空白会话（官方 `uiWorkspace.startSession()`，与原生「新建会话」同路径，
 * blank 复用不会堆积会话），使会话结束按上游 isMain 语义记「完成未读」绿点。
 * 判定与安装见 `park.ts`。
 *
 * 上游事实（docs/dsh/workspace.md「完成未读的精确机制」）：停在运行中的会话上切屏、
 * 或被插件/服务等面板页挡住（面板页不清 mainView retain），会话结束都不记未读；
 * 本组件在「人已离开」时满足该判定的前提。停靠不区分状态点细类：待操作（warning）
 * 与运行中（ongoing）都不做 isMain 过滤、恒显示，停靠不会「弄丢」任何状态点。
 *
 * 已知边界：失焦后 `PARK_DELAY_MS` 内会话恰好结束则不停靠（该次结束不记未读，但
 * 用户很快回来时内容就在眼前）；当前视图是子代理会话时 sessions 列表无对应行，
 * 判定为不在运行、不动作；无 main 会话（全空白）同样不动作。
 *
 * @module @dsh-kit/dsh-plugin-session-park/client
 */

import type { Context } from '@deepseek-ai/cordis'
// 仅类型 import：激活 Context service merge（sessions、uiSession、uiWorkspace）。
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { installSessionPark, PARK_DELAY_MS } from './park.js'

export { installSessionPark, PARK_DELAY_MS } from './park.js'
export type { SessionParkDeps } from './park.js'

/** browser half 使用的 service：sessions 列表、uiSession 当前 main、uiWorkspace 导航。 */
export const inject = ['sessions', 'uiSession', 'uiWorkspace']

/** 注册切屏停靠监听。 */
export function apply(ctx: Context): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  ctx.effect(() => installSessionPark({
    window,
    document,
    isMainSessionRunning: () => {
      // 面板页选中时会话列卸载，但 mainView 由工作区导航层持有，current 仍可解析
      // （services 面板同款锚点读取）。
      const key = ctx.uiSession.adapter.current.getSnapshot().key as SessionId | undefined
      return key !== undefined && ctx.sessions.list.getSnapshot().byId[key]?.running === true
    },
    park: () => { ctx.uiWorkspace.startSession() },
    delayMs: PARK_DELAY_MS,
    setTimeout: (handler, timeout) => window.setTimeout(handler, timeout),
    clearTimeout: handle => window.clearTimeout(handle as number),
  }), 'session-park: away park on running session')
}
