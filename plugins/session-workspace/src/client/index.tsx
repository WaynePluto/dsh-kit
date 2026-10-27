/**
 * session-workspace 的 browser half：在 composer 统计栏（`conversation.composer.dock`
 * list 槽）最左注册工作区 pill。槽位是官方设计内扩展点（原生 StatsPills 按 id 各占一条，
 * 注释明示插件可新增 pill），session 作用域让组件直接收到 `sessionId` 与 `useSessions`
 * 标准props，cwd 全程取自浏览器半的 sessions 服务，不经宿主半。
 *
 * @module @dsh-kit/dsh-plugin-session-workspace/client
 */

import type { Context } from '@deepseek-ai/cordis'
// 仅类型：引入声明本插件读取的 Context service merge（locale 文案服务）。
import type {} from '@deepseek-ai/dsh-client-locale/client'
// 仅类型：引入声明 `ctx.slots` 的 renderer Context service merge。
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// 仅类型：激活 conversation 的 SlotMap merge（composer.dock 槽位声明）。
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// 仅类型：激活 session 标准 kit merge（sessionId + useSessions）。
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { SELF_NAMESPACE } from '../shared.js'
import { WorkspacePill } from './pill.js'
import { installPillStyles } from './styles.js'
import { en, zh } from './locales.js'
import type { SessionWorkspaceKey } from './locales.js'

export { WorkspacePill } from './pill.js'
export type { WorkspacePillProps } from './pill.js'
export { workspaceLabel } from './label.js'
export {
  ANCHOR_CLASS, LABEL_CLASS, PILL_CLASS, STYLE_MARKER, installPillStyles, pillStylesheet,
} from './styles.js'
export type { StyleHost } from './styles.js'
export { en, zh } from './locales.js'
export type { SessionWorkspaceKey } from './locales.js'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** 本插件的文案命名空间，与包名后缀一致。 */
    'dsh-plugin-session-workspace': SessionWorkspaceKey
  }
}

/** 本插件的文案 namespace。 */
const NS = SELF_NAMESPACE

/** browser half 使用的 service：`slots` 是统计栏座位，`locale` 提供 pill 文案。 */
export const inject = ['slots', 'locale']

/**
 * 在统计栏 entries 中的位置。官方 activity 为 0、usage 为 1；-1 使工作区 pill 排在
 * 最左（用户指定的显示位置）。列表排序是纯数值升序（`ui-slots/src/index.ts` 的
 * entries 排序，tie 保持注册序），负值合法。
 */
const ORDER = -1

/** 注册文案、安装样式表，并在统计栏最左注册工作区 pill。 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'session-workspace: dictionaries')

  const host = typeof document === 'undefined' ? undefined : document
  ctx.effect(() => installPillStyles(host), 'session-workspace: styles')

  ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
    name: 'conversation.composer.dock',
    id: 'dsh-plugin-session-workspace',
    order: ORDER,
    locale: NS,
  }, WorkspacePill))
}
