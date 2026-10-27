/** session-workspace 的文案；中文遵循 `docs/01-decisions.md` 词表。 */

/** 英文文案；同时作为本 namespace 的 key 集合。 */
export const en = {
  copyWorkspace: 'Copy workspace path',
  copied: 'Copied',
} as const

/** 本 namespace 的文案 key 类型。 */
export type SessionWorkspaceKey = keyof typeof en

/** 中文文案，按 `en` 的 key 集合实现。 */
export const zh: Record<SessionWorkspaceKey, string> = {
  copyWorkspace: '复制工作区路径',
  copied: '已复制',
}
