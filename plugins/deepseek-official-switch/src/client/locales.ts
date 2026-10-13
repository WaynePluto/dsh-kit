/** 浏览器半文案；`en` 是 key 的唯一来源，`zh` 必须逐键对应。 */

export const en = {
  remove: 'Remove',
  removeTitle: 'Remove DeepSeek (official API key)',
  lockedManagement: 'The official build protects this row; it cannot be changed here.',
  lockedUnaddressable: 'This row cannot be addressed through the profile patch; it cannot be changed here.',
  dialogTitle: 'Remove DeepSeek (official API key)?',
  dialogDescription: 'This disables the built-in provider row that serves DeepSeek with an API key'
    + ' (route deepseek-official). After dsh restarts, its card and models leave the list.'
    + ' Your stored API key and the DeepSeek account card are untouched;'
    + ' restore anytime from the bottom of this page.',
  cancel: 'Cancel',
  confirm: 'Remove',
  deleting: 'Removing…',
  disabledPending: 'Removed. This card disappears after dsh restarts.',
  hintRemoved: 'Removed.',
  hintRestart: 'Saved. Restart dsh to apply.',
  hintOverridden: 'Another configuration overrides this change; the effective state is unchanged.',
  readFailed: 'Could not read the current state: {detail}',
  writeFailed: 'Failed: {detail}',
  writeFailedCode: 'Failed ({code}).',
  footerRemoved: 'The built-in DeepSeek (API key) provider is removed.',
  footerPending: 'Removal saved. It applies after dsh restarts.',
  restore: 'Restore',
  restoring: 'Restoring…',
} as const

export type LocaleKey = keyof typeof en

export const zh: Record<LocaleKey, string> = {
  remove: '删除',
  removeTitle: '删除 DeepSeek（官方 API 密钥）',
  lockedManagement: '官方构建将这一行列为受保护，不能在这里修改。',
  lockedUnaddressable: '这一行无法通过 profile 补丁寻址，不能在这里修改。',
  dialogTitle: '删除 DeepSeek（官方 API 密钥）？',
  dialogDescription: '将停用内置的 DeepSeek（API 密钥）供应商行（路由 deepseek-official）。'
    + '重启 dsh 后，它的卡片与模型会从列表消失。已存的 API 密钥与「DeepSeek 账号」不受影响；'
    + '随时可在本页底部恢复。',
  cancel: '取消',
  confirm: '删除',
  deleting: '删除中…',
  disabledPending: '已停用，重启 dsh 后这张卡片会消失。',
  hintRemoved: '已停用。',
  hintRestart: '已写入配置，重启 dsh 后生效。',
  hintOverridden: '有其他配置覆盖了这次修改，实际状态未变化。',
  readFailed: '读取状态失败：{detail}',
  writeFailed: '操作失败：{detail}',
  writeFailedCode: '操作失败（{code}）。',
  footerRemoved: '内置 DeepSeek（API 密钥）供应商已移除。',
  footerPending: '已提交移除，重启 dsh 后生效。',
  restore: '恢复',
  restoring: '恢复中…',
}

export function fill(text: string, values: Readonly<Record<string, string | number>>): string {
  return text.replace(/\{(\w+)\}/gu, (match, key: string) =>
    Object.hasOwn(values, key) ? String(values[key]) : match)
}
