/**
 * browser half：在 composer 工具排左侧组（`conversation.input.left` list 槽，
 * 官方扩展点——渲染于 [+] 按钮与 permission/plan 模式之后、右侧控制组之前）
 * 注册快捷指令按钮。RPC 走 `/quick-commands` kit 通道（宿主半存取
 * `$DSH_HOME/dsh-kit/quick-commands.json`），插入走 session 标准 prop
 * `inputActions` 的光标插入契约。
 *
 * @module @dsh-kit/dsh-plugin-quick-commands/client
 */

import type { Context } from '@deepseek-ai/cordis'
// 仅类型：引入声明本插件读取的 Context service merge（locale 文案服务）。
import type {} from '@deepseek-ai/dsh-client-locale/client'
// 仅类型：激活 conversation 的 SlotMap merge（input.left 槽位声明）。
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// 仅类型：引入声明 `ctx.slots` 的 renderer Context service merge。
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// 仅类型：激活 session 标准 kit merge（sessionId + inputActions）。
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { callKitChannel } from '@dsh-kit/plugin-rpc'
import { CHANNEL, SELF_NAMESPACE } from '../shared.js'
import type { QuickCommandDocument } from '../shared.js'
import { QuickCommandsEntry } from './button.js'
import { installStyles } from './styles.js'
import { en, zh } from './locales.js'
import type { QuickCommandsKey } from './locales.js'

export { QuickCommandsEntry } from './button.js'
export type { QuickCommandsEntryProps, QuickCommandsInjected } from './button.js'
export { QuickCommandsPanel, QuickCommandsPortal } from './panel.js'
export type { QuickCommandsPanelProps } from './panel.js'
export { insertAtCaret } from './insert.js'
export type { InsertActions } from './insert.js'
export { useCommands } from './use-commands.js'
export { installStyles, classes, stylesheet, STYLE_MARKER } from './styles.js'
export { en, zh, fill } from './locales.js'
export type { QuickCommandsKey } from './locales.js'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** 本插件的文案命名空间，与包名后缀一致。 */
    'dsh-plugin-quick-commands': QuickCommandsKey
  }
}

/** 本插件的文案 namespace。 */
const NS = SELF_NAMESPACE

/** browser half 使用的 service：`slots` 是工具排座位，`locale` 提供文案，`connection` 提供 RPC。 */
export const inject = ['slots', 'locale', 'connection']

/** RPC channel 错误。 */
export class QuickCommandsChannelError extends Error {}

/** 调用 `/quick-commands/<endpoint>` RPC，并将失败转换为 QuickCommandsChannelError。 */
const call = async (endpoint: string, payload: object): Promise<unknown> => {
  const result = await callKitChannel(CHANNEL, endpoint, payload)
  if (!result.ok) throw new QuickCommandsChannelError(result.error.message)
  return result.value
}

/** 注册文案、安装样式表，并在工具排左侧组注册快捷指令按钮。 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'quick-commands: copy dictionaries')

  const host = typeof document === 'undefined' ? undefined : document
  ctx.effect(() => installStyles(host), 'quick-commands: styles')

  const actions = {
    load: async () => await call('get', {}) as QuickCommandDocument,
    save: async (document: QuickCommandDocument) => {
      await call('put', { document })
    },
  }

  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: NS,
    order: 0,
    locale: NS,
    inject: () => actions,
  }, QuickCommandsEntry))
}

/** 保持 namespace 可供检查 package bundle 的 consumer 使用。 */
export const namespace = SELF_NAMESPACE
