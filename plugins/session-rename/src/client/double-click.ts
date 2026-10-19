/** 顶栏双击 → 重命名请求的监听器装配。 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { isConversationTitleTarget } from './header-target.js'
import { renameRequestFromSummary, type SessionRenameRequest, type SessionSummaryLike } from './rename.js'

/** 监听器所需的外部事实（依赖注入，便于单测）。 */
export interface HeaderTitleDoubleClickFacts {
  /** 当前主视图会话；无选择时 undefined。 */
  readonly currentSessionId: () => SessionId | undefined
  /** 会话目录行读取。 */
  readonly summaryOf: (sessionId: SessionId) => SessionSummaryLike | undefined
  /** 弹出重命名弹窗。 */
  readonly requestRename: (request: SessionRenameRequest) => void
}

/**
 * 组装 dblclick 监听：命中当前会话标题且会话可重命名（非空白、在目录内）时
 * 清掉双击选词高亮（标题 span 不是 user-select:none）并弹出弹窗。
 * @param facts - 当前会话与目录事实。
 * @returns 可直接挂到 document 的 dblclick 监听器。
 */
export function createHeaderTitleDoubleClickListener(
  facts: HeaderTitleDoubleClickFacts,
): (event: MouseEvent) => void {
  return (event: MouseEvent) => {
    if (!isConversationTitleTarget(event.target)) return
    const sessionId = facts.currentSessionId()
    if (sessionId === undefined) return
    const request = renameRequestFromSummary(sessionId, facts.summaryOf(sessionId))
    if (request === undefined) return
    document.getSelection()?.removeAllRanges()
    facts.requestRename(request)
  }
}
