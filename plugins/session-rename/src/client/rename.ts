/** 重命名请求的纯逻辑：目标解析与种子标题。 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** 一次待弹窗确认的重命名请求（对齐 dsh 原生侧栏的 SessionRenameTarget）。 */
export interface SessionRenameRequest {
  readonly sessionId: SessionId
  readonly currentTitle: string
}

/** 浏览器半读取会话目录行所需的最小形状。 */
export interface SessionSummaryLike {
  /** 最新持久标题；宿主投影出标题前缺省。 */
  readonly title?: string
  /** 空白新会话占位（尚未发过消息），原生入口对这类行不提供重命名。 */
  readonly blank: boolean
}

/**
 * 从会话目录行推导重命名目标。
 *
 * 与原生侧栏行双击同一口径：空白（尚未发过消息的「新会话」）不响应；
 * 种子用持久标题（`title`），不用 `displayTitle`——后者在没有标题时回落
 * 工作区目录名/裸 id，会把目录名误当草稿提交成新标题。
 * @param sessionId - 当前会话。
 * @param summary - 会话目录行。
 * @returns 可弹窗的请求；会话不在目录或为空白时 undefined。
 */
export function renameRequestFromSummary(
  sessionId: SessionId,
  summary: SessionSummaryLike | undefined,
): SessionRenameRequest | undefined {
  if (summary === undefined || summary.blank) return undefined
  return { sessionId, currentTitle: summary.title?.trim() ?? '' }
}
