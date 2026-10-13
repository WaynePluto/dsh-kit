/** 浏览器半：在设置 → 模型注册删除按钮（provider-card keyed 槽）与恢复入口（footer 槽）。 */

import type { Context } from '@deepseek-ai/cordis'
// 仅类型：引入声明本插件读取服务的 Context 合并。
// ctx.remote 的 pluginManager / pluginInventory 命名空间由对应 UI 包的
// typert remote-client 贡献文件扩展（TypertRemoteNamespaceMap）；
// settings.models.* 槽位契约由模型设置页包声明。
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-plugin-manager/remote'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-models/client'
import { NAMESPACE, SETTINGS_NAMESPACE } from '../shared.js'
import { DeepSeekOfficialCardActions } from './CardActions.js'
import { DeepSeekOfficialRestore } from './RestoreFooter.js'
import { OfficialSwitchController } from './controller.js'
import { installStyles } from './styles.js'
import { en, zh } from './locales.js'
import type { LocaleKey } from './locales.js'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** 本插件的文案命名空间；dsh 0.1.7 起与表单 entry id 不再是同一个字符串。 */
    'dsh-plugin-deepseek-official-switch': LocaleKey
  }
}

/** 所需 service：slots、locale，以及官方 pluginManager / pluginInventory 远程面。 */
export const inject = ['slots', 'locale', 'remote', 'remote.pluginManager', 'remote.pluginInventory']

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NAMESPACE, { zh, en }), 'deepseek-official-switch: copy dictionaries')
  const t = ctx.locale.bind(NAMESPACE)
  // 与 dsh 原生插件行开关同一官方途径：移除/恢复写进 dsh profile 的用户层补丁，
  // 本插件不落盘、不实现第二套插件管理。
  const controller = new OfficialSwitchController(ctx.remote)
  ctx.effect(installStyles, 'deepseek-official-switch: styles')

  ctx.slots.inject('settings.models.provider-card', () => ctx.slots.register({
    name: 'settings.models.provider-card',
    key: SETTINGS_NAMESPACE,
    locale: NAMESPACE,
    inject: () => ({ t, controller }),
  }, DeepSeekOfficialCardActions))
  ctx.slots.inject('settings.models.footer', () => ctx.slots.register({
    name: 'settings.models.footer',
    id: NAMESPACE,
    locale: NAMESPACE,
    inject: () => ({ t, controller }),
  }, DeepSeekOfficialRestore))
}
