/**
 * 把一张卡片的任务文本发送到目标工作区的新对话（浏览器半）。
 * 路径与 user-message-fork 同款官方 API：`sessions.create()` 在 Host 登记目录行并
 * 复用可复用的空白会话 → `uiWorkspace.openSession()` retain 并把 mainView 切过去
 * （reveal 语义会把面板选中态清回会话）→ 会话 scope 物化后经 `conversation.input`
 * 回填草稿并 submit。不触碰宿主半会话 API，不写会话事件。
 *
 * @module @dsh-kit/dsh-plugin-task-board/client/send-task
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** submit 所需的最小 session-scoped conversation 接口。 */
interface ConversationInputFace {
  input: {
    for(scope: unknown): {
      setDraft(text: string): void
      submit(mode?: 'queue' | 'steer', source?: 'click' | 'enter'): void
    }
  }
}

/** 发送所需的 client service 最小面（真实形状由 dsh Context 合并提供）。 */
export interface SendTaskDeps {
  readonly sessions: {
    create(options?: { workspaceId?: string }): Promise<SessionId>
    scope(id: SessionId): { get(name: 'conversation'): ConversationInputFace | undefined } | undefined
  }
  readonly uiWorkspace: {
    openSession(target: SessionId): void
  }
}

/**
 * 在目标工作区新建对话、回填任务文本并立即发送。
 * @param deps - dsh client 服务面。
 * @param text - 任务文本（发送正文）。
 * @param workspaceId - 目标工作区；缺省 = dsh 默认落点（当前/最近工作区）。
 * @returns 新会话 id。
 * @throws 会话创建失败或 scope 未物化时抛错，由页面转为错误文案。
 */
export async function sendTaskToWorkspace(
  deps: SendTaskDeps,
  text: string,
  workspaceId?: string,
): Promise<SessionId> {
  const trimmed = text.trim()
  if (trimmed === '') throw new Error('task text is empty')
  const sessionId = await deps.sessions.create(
    workspaceId === undefined || workspaceId === '' ? {} : { workspaceId },
  )
  // openSession 同步 retain 并物化 client scope；reveal 顺带把面板切回会话。
  deps.uiWorkspace.openSession(sessionId)
  const scope = deps.sessions.scope(sessionId)
  const conversation = scope?.get('conversation')
  if (conversation === undefined) {
    throw new Error(`task-board: session "${String(sessionId)}" has no conversation scope`)
  }
  const input = conversation.input.for(scope)
  input.setDraft(trimmed)
  input.submit('queue', 'click')
  return sessionId
}
