/**
 * `dsh-plugin-model-provider` namespace dictionaries.
 *
 * `provider.account` 复制 ui-model-selection 原生 `model` 命名空间的同名键
 * （packages/client/ui-model-selection/src/client/locales.ts）：目录组的
 * `deepseek-account` 在原生菜单标题同样特判为账号显示名，跨插件 namespace
 * 不能互相取键，升级 dsh 时同步这对文案。
 */

/** 简体中文词典（键集事实源）。 */
export const zh = {
  'provider.account': 'DeepSeek 账号',
} satisfies Record<string, string>

/** 本插件 locale 键联合。 */
export type ModelProviderKey = keyof typeof zh

/** 英文词典，与 zh 键集核对一致。 */
export const en = {
  'provider.account': 'DeepSeek Account',
} satisfies Record<ModelProviderKey, string>
