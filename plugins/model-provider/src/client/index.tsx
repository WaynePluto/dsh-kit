/** browser half：占用 `conversation.input.right`，在模型选择座位左侧渲染当前提供商名。 */

import type { Context } from '@deepseek-ai/cordis'
// 仅类型：激活本插件使用的 locale、conversation 槽位声明、renderer/slot 与 session 的 Context merge。
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { ModelDirectoryResolver } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import { ModelProviderLabel } from './ModelProviderLabel.js'
import { providerDisplayName } from './label.js'
import { en, zh } from './locales.js'
import type { ModelProviderKey } from './locales.js'

export { ModelProviderLabel } from './ModelProviderLabel.js'
export type { ModelProviderLabelInjected } from './ModelProviderLabel.js'
export { providerDisplayName } from './label.js'

/** 本插件拥有的 locale 命名空间。 */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'dsh-plugin-model-provider': ModelProviderKey
  }
}

/** 本插件拥有的文案 namespace。 */
const NAMESPACE = 'dsh-plugin-model-provider'

/** 所需 service：槽位注册、文案与共享模型目录。 */
export const inject = ['slots', 'locale', 'modelDirectories', 'sessions']

/** modelDirectories.directoryFor 的参数类型（branded SessionId）。 */
type DirectorySessionId = Parameters<ModelDirectoryResolver['directoryFor']>[0]

/** 注册文案与 composer 右侧控件槽占用者。 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NAMESPACE, { zh, en }), 'model-provider: copy dictionaries')

  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right',
    id: NAMESPACE,
    order: 0,
    locale: NAMESPACE,
    inject: (sessionId: DirectorySessionId) => ({
      directory: ctx.modelDirectories.directoryFor(sessionId).store,
      available: ctx.sessions.subagentAddress(sessionId) === undefined,
    }),
  }, ModelProviderLabel))
}
