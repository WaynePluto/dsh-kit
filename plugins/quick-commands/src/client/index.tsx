/**
 * browser half：在 composer 工具排左侧组（`conversation.input.left` list 槽，
 * 官方扩展点——渲染于 [+] 按钮与 permission/plan 模式之后、右侧控制组之前）
 * 注册快捷指令按钮。RPC 走 `/quick-commands` kit 通道（宿主半存取
 * `$DSH_HOME/dsh-kit/quick-commands.json`），插入走 session 标准 prop
 * `inputActions` 的光标插入契约；插入成功后经 conversation 服务的
 * `SessionInput.focus()` 把键盘交回输入框，光标停在刚插入的指令之后。
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

/** conversation 服务上用到的最小面：按会话 scope 解析输入面并交回键盘焦点。 */
interface ConversationFocusFace {
  readonly input: {
    /**
     * 解析一个会话 scope 的输入面。
     * @param scope - 会话 scope 上下文。
     * @returns 该会话的输入面。
     */
    for(scope: unknown): { focus(): void }
  }
}

/** sessions 服务上用到的最小面：只借出会话 scope，不 retain。 */
interface SessionsScopeFace {
  /**
   * @param id - 会话 id。
   * @returns 该会话的 scope 上下文，未物化时 undefined。
   */
  scope(id: string): unknown
}

/**
 * 插入成功后把键盘与光标交回输入框（光标停在刚插入的文本之后）。
 *
 * 插入走 `insertText()`，编辑器选区已经落在插入文本末尾，但面板行按钮持焦点时
 * composer 编辑器处于失焦态（上游 `preserveExternalSelection` 会跳过 DOM 选区同步），
 * 光标不可见、打字也进不去。上游 `SessionInput.focus()` 正是为「浮层拿走焦点后交还」
 * 准备的公开面：先 DOM focus 再让 Lexical 把记忆的选区（即插入文本末尾）落回 DOM。
 *
 * 服务跨 fiber 现取（`ui-workspace/src/client/navigation.ts` 同款 `ctx.get`），
 * 不在 apply 时缓存；会话已切走或服务缺席时静默跳过，已插入的文本不受影响。
 * @param ctx - 插件 apply 上下文。
 * @param sessionId - 槽位注入的当前会话 id。
 */
function focusComposer(ctx: Context, sessionId: string): void {
  const sessions = ctx.get('sessions') as unknown as SessionsScopeFace | undefined
  const conversation = ctx.get('conversation') as unknown as ConversationFocusFace | undefined
  if (sessions === undefined || conversation === undefined) return
  const scope = sessions.scope(sessionId)
  if (scope === undefined) return
  try {
    conversation.input.for(scope).focus()
  } catch {
    // 会话 generation 已释放（切走/关闭）时 for() 抛错：焦点回填尽力而为，不打扰用户
  }
}

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
    // 严格 session 槽：框架按会话绑定注入 sessionId（每次插入后回焦用）。
    inject: sessionId => ({
      ...actions,
      focusInput: () => { focusComposer(ctx, sessionId) },
    }),
  }, QuickCommandsEntry))
}

/** 保持 namespace 可供检查 package bundle 的 consumer 使用。 */
export const namespace = SELF_NAMESPACE
