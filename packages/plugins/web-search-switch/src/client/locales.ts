/** 浏览器半文案；`en` 是 key 的唯一来源，`zh` 必须逐键对应。 */

export const en = {
  title: 'Official web search',
  statusOn: 'On — the model can use the official web search.',
  statusOff: 'Off — the model no longer uses the official web search.',
  loading: 'Reading state…',
  unavailable: 'Plugin management is not available in this dsh, so the official plugin cannot be changed here.',
  unsupported: 'This dsh does not ship the official web search plugin; there is nothing to switch.',
  lockedManagement: 'The official build protects this row; it cannot be changed here.',
  lockedUnaddressable: 'This row cannot be addressed through the profile patch; it cannot be changed here.',
  readFailed: 'Could not read the current state: {detail}',
  writeFailed: 'Failed: {detail}',
  writeFailedCode: 'Failed ({code}).',
  hintRestart: 'Saved. Restart dsh to apply.',
  hintOverridden: 'Another configuration overrides this change; the effective state is unchanged.',
} as const

export type LocaleKey = keyof typeof en

export const zh: Record<LocaleKey, string> = {
  title: '官方网页搜索',
  statusOn: '已启用——模型可以使用官方网页搜索。',
  statusOff: '已停用——模型不再使用官方网页搜索。',
  loading: '正在读取状态…',
  unavailable: '当前 dsh 未启用插件管理，无法在这里修改。',
  unsupported: '当前 dsh 没有官方网页搜索插件，无需开关。',
  lockedManagement: '官方构建将这一行列为受保护，不能在这里修改。',
  lockedUnaddressable: '这一行无法通过 profile 补丁寻址，不能在这里修改。',
  readFailed: '读取状态失败：{detail}',
  writeFailed: '操作失败：{detail}',
  writeFailedCode: '操作失败（{code}）。',
  hintRestart: '已写入配置，重启 dsh 后生效。',
  hintOverridden: '有其他配置覆盖了这次修改，实际状态未变化。',
}

export function fill(text: string, values: Readonly<Record<string, string | number>>): string {
  return text.replace(/\{(\w+)\}/gu, (match, key: string) =>
    Object.hasOwn(values, key) ? String(values[key]) : match)
}
