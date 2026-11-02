/** quick-commands 面板文案；中文遵循 `docs/01-decisions.md` 词表。 */

/** 英文文案；同时作为本 namespace 的 key 集合。 */
export const en = {
  button: 'Quick commands',
  menuAria: 'Quick commands',
  loading: 'Loading…',
  empty: 'No quick commands yet — add one below.',
  addPlaceholder: 'Add a quick command…',
  editPlaceholder: 'Edit command',
  edit: 'Edit command',
  delete: 'Delete command',
  insertFailed: 'Could not insert: the draft changed. Try again.',
  loadFailed: 'Failed to load quick commands: {message}',
  saveFailed: 'Changes could not be saved: {message}',
  retry: 'Retry',
  limitReached: 'Up to {count} commands.',
} as const

/** 本 namespace 的文案 key 类型。 */
export type QuickCommandsKey = keyof typeof en

/** 中文文案，按 `en` 的 key 集合实现。 */
export const zh: Record<QuickCommandsKey, string> = {
  button: '快捷指令',
  menuAria: '快捷指令',
  loading: '正在读取…',
  empty: '还没有快捷指令，在下方添加一条。',
  addPlaceholder: '新增快捷指令…',
  editPlaceholder: '编辑指令',
  edit: '编辑指令',
  delete: '删除指令',
  insertFailed: '插入失败：草稿已变化，请重试。',
  loadFailed: '快捷指令读取失败：{message}',
  saveFailed: '改动尚未保存成功：{message}',
  retry: '重试',
  limitReached: '最多 {count} 条。',
}

/** 填充 `{name}` 等文案占位符；未知占位符保持原样。 */
export function fill(text: string, values: Readonly<Record<string, string | number>>): string {
  return text.replace(/\{(\w+)\}/gu, (match, key: string) =>
    Object.hasOwn(values, key) ? String(values[key]) : match)
}
