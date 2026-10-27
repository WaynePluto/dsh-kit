/** workspace-collapse 的文案；中文遵循 `docs/01-decisions.md` 词表。 */

/** 英文文案；同时作为本 namespace 的 key 集合。 */
export const en = {
  collapseAll: 'Collapse all workspaces',
  expandAll: 'Expand all workspaces',
  focusUpdates: 'Focus workspaces with updates',
} as const

/** 本 namespace 的文案 key 类型。 */
export type WorkspaceCollapseKey = keyof typeof en

/** 中文文案，按 `en` 的 key 集合实现。 */
export const zh: Record<WorkspaceCollapseKey, string> = {
  collapseAll: '收起全部工作区',
  expandAll: '展开全部工作区',
  focusUpdates: '聚焦有提醒的工作区',
}
