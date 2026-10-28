/** 浏览器半：在套件 Bundle 详情页注册配置区（plugins.bundle.config keyed 槽），
 *  经 kit 私有 /api 通道（宿主半 check 端点）检查 GitHub 新版本。 */

import type { Context } from '@deepseek-ai/cordis'
// 仅类型：引入声明本插件读取服务的 Context 合并。
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// plugins.bundle.config 槽位契约（keyed、owner props）由插件管理页声明。
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { callKitChannel } from '@dsh-kit/plugin-rpc'
import { CHANNEL, NAMESPACE, SUITE_PACKAGE } from '../shared.js'
import { SuiteUpdatesCard } from './SuiteUpdatesCard.js'
import type { SuiteUpdatesApi } from './SuiteUpdatesCard.js'
import { installStyles } from './styles.js'
import { en, zh } from './locales.js'
import type { LocaleKey } from './locales.js'

export { en, zh } from './locales.js'
export type { LocaleKey } from './locales.js'
export { SuiteUpdatesCard } from './SuiteUpdatesCard.js'
export type { SuiteUpdatesApi, SuiteUpdatesInjected } from './SuiteUpdatesCard.js'
export { installStyles } from './styles.js'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** 本插件的文案命名空间，与包名后缀一致。 */
    'dsh-plugin-suite-updates': LocaleKey
  }
}

/** 本插件拥有的文案命名空间。 */
const NS = NAMESPACE

/** 传输失败统一抛出的错误；细节在 message 里。 */
class SuiteUpdatesChannelError extends Error {}

/** 传输契约：经官方 /api 共享桥 POST `/api/suite-updates`（kit 信封，D16）。 */
async function call<T>(endpoint: string): Promise<T> {
  const result = await callKitChannel(CHANNEL, endpoint, {})
  if (!result.ok) throw new SuiteUpdatesChannelError(result.error.message)
  return result.value as T
}

/** 浏览器半使用的服务：slots 注册配置区，locale 取文案。 */
export const inject = ['slots', 'locale']

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'suite-updates: copy dictionaries')
  const t = ctx.locale.bind(NS)
  ctx.effect(installStyles, 'suite-updates: styles')
  const api: SuiteUpdatesApi = {
    check: () => call('check'),
  }

  ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
    name: 'plugins.bundle.config',
    key: SUITE_PACKAGE,
    locale: NS,
    inject: () => ({ t, api }),
  }, SuiteUpdatesCard))
}
