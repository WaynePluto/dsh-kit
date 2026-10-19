/** 浏览器半文案。中文与 dsh 原生侧栏重命名弹窗（ui-workspace locale 的
 * `rename.session.title` 等）逐字一致：两个入口打开的是同一个动作，
 * 文案不应出现第二种说法。 */

export const zh = {
  'dialog.title': '重命名会话',
  'dialog.field': '会话名称',
  'dialog.cancel': '取消',
  'dialog.rename': '重命名',
  'dialog.close': '关闭',
} as const

export const en = {
  'dialog.title': 'Rename session',
  'dialog.field': 'Session name',
  'dialog.cancel': 'Cancel',
  'dialog.rename': 'Rename',
  'dialog.close': 'Close',
} as const

export type SessionRenameKey = keyof typeof zh
