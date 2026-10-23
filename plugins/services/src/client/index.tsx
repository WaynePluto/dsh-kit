/** browser half：注册「服务」全局面板——`main` keyed 主列页面 + `sidebar.panellist` 侧边栏行——并通过 shared RPC channel 调用 Host。 */

import type { Context } from '@deepseek-ai/cordis'
// 仅类型：引入声明本插件读取的 Context service merge。
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// 仅类型：'main' keyed 槽的声明在 ui-layout，'sidebar.panellist' list 槽的声明在 ui-sidebar。
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { CHANNEL, SELF_NAMESPACE } from '../shared.js'
import type { ServiceActionResult, ServiceLogsResult, ServicesSnapshot } from '../shared.js'
import { ServicesPanelIcon } from './ServicesPanelIcon.js'
import { ServicesPage } from './ServicesPage.js'
import type { ServicesActions } from './ServicesPage.js'
import { en, zh } from './locales.js'
import type { ServicesKey } from './locales.js'
import { callKitChannel } from '@dsh-kit/plugin-rpc'

export { POLL_MS, ServicesPage } from './ServicesPage.js'
export type { ServicesActions, ServicesPageProps } from './ServicesPage.js'
export { ServicesPanelIcon } from './ServicesPanelIcon.js'
export type { ServicesKey } from './locales.js'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** 本插件的文案命名空间，与包名后缀一致。 */
    'dsh-plugin-services': ServicesKey
  }
}

/** 本插件的文案 namespace。 */
const NS = SELF_NAMESPACE

/**
 * 面板 id：`main` keyed 槽的 key 与 `sidebar.panellist` 条目的 id 共用同一字符串，
 * 行点击经 `layout.selectPanel(id)` 落到页面。用包名后缀避免与官方面板 key（plugins/schedules）撞名。
 */
export const PANEL_ID = SELF_NAMESPACE as MainPanelId

/** 侧边栏行在面板列表中的顺序：插件（0）、自动化任务（10）之后，排在第三行。 */
const ORDER = 20

/** RPC channel 错误。 */
export class ServicesChannelError extends Error {}

/** 所需 service：槽位注册、文案、连接与当前会话（排序锚点）。 */
export const inject = ['slots', 'locale', 'connection', 'uiSession']

/** 调用 `/services/<endpoint>` RPC，并将失败转换为 ServicesChannelError。 */
const call = async (endpoint: string, payload: object): Promise<unknown> => {
  const result = await callKitChannel(CHANNEL, endpoint, payload)
  if (!result.ok) throw new ServicesChannelError(result.error.message)
  return result.value
}

/** 注册文案、RPC channel、主列页面与侧边栏行。 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'services: copy dictionaries')
  const t = ctx.locale.bind(NS)

  /** 页面注入：锚点会话每次现取（全局面板没有会话绑定），RPC 按名称全局寻址。 */
  const pageActions = (): ServicesActions => ({
    onList: async anchorSessionId => await call('list', { sessionId: anchorSessionId }) as ServicesSnapshot,
    onStop: async name => await call('stop', { name }) as ServiceActionResult,
    onRestart: async name => await call('restart', { name }) as ServiceActionResult,
    onLogs: async name => await call('logs', { name }) as ServiceLogsResult,
    currentSessionId: () => {
      const key = ctx.uiSession.adapter.current.getSnapshot().key
      return key === undefined ? undefined : String(key)
    },
  })

  // 先注册主列页面再注册侧边栏行：行点击的 layout.selectPanel 要求 key 已注册，
  // 顺序与官方 ui-plugin-manager/ui-schedule 一致。
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: NS,
    inject: pageActions,
  }, ServicesPage))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: ORDER,
    locale: NS,
    label: () => t('panel'),
  }, ServicesPanelIcon))
}
