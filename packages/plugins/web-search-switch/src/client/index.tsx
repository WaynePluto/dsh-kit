/** 浏览器半：在插件管理页为本 Bundle 详情页注册配置区（plugins.bundle.config keyed 槽）。 */

import type { Context } from '@deepseek-ai/cordis'
// 仅类型：引入声明本插件读取服务的 Context 合并。
// ctx.remote 的 pluginManager / pluginInventory 命名空间由对应 UI 包的
// typert remote-client 贡献文件扩展（TypertRemoteNamespaceMap）。
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-plugin-manager/remote'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// plugins.bundle.config 槽位契约（keyed、owner props）由插件管理页声明。
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { BUNDLE_PACKAGE, NAMESPACE } from '../shared.js'
import { WebSearchController } from './controller.js'
import { WebSearchSwitchCard } from './WebSearchSwitchCard.js'
import { installStyles } from './styles.js'
import { en, zh } from './locales.js'
import type { LocaleKey } from './locales.js'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** 本插件的文案命名空间；dsh 0.1.7 起与表单 entry id 不再是同一个字符串。 */
    'dsh-plugin-web-search-switch': LocaleKey
  }
}

/** 本插件拥有的文案命名空间。 */
const NS = NAMESPACE

export const inject = ['slots', 'locale', 'remote', 'remote.pluginManager', 'remote.pluginInventory']

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'web-search-switch: copy dictionaries')
  const t = ctx.locale.bind(NS)
  // 与 dsh 原生插件行开关同一官方途径：停用状态写进 dsh profile 的用户层补丁，本插件不落盘。
  const controller = new WebSearchController(ctx.remote)
  ctx.effect(installStyles, 'web-search-switch: styles')

  ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
    name: 'plugins.bundle.config',
    key: BUNDLE_PACKAGE,
    locale: NS,
    inject: () => ({ t, controller }),
  }, WebSearchSwitchCard))
}
