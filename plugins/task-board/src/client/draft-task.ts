/**
 * 把一张卡片的任务文本与图片填入目标工作区新对话的输入框（浏览器半），不自动发送。
 * 路径与 user-message-fork 同款官方 API：`sessions.create()` 在 Host 登记目录行并
 * 复用可复用的空白会话 → `uiWorkspace.openSession()` retain 并把 mainView 切过去
 * （reveal 语义会把面板选中态清回会话）→ 会话 scope 物化后经 `conversation.input`
 * 回填草稿文本；图片经官方 conversation 服务的 `createDrafts()` 登记为浏览器侧
 * 图片草稿附件，再由 `SessionInput.addAttachments()` 追加到该会话的输入状态，
 * 原生附件栏随即显示缩略图，发送时由 dsh 自己编码成 image 内容块。
 * 卡片标题是纯展示字段，不参与任何回填。
 * 不触碰宿主半会话 API，不写会话事件。
 *
 * 上游契约（0.2.2-rc.1）：`packages/client/ui-conversation/src/client/service.ts`
 * 的 `ConversationController.createDrafts()`（第三参 uploadImages 开图片预上载）与
 * `contract/input.ts` 的
 * `SessionInput.addAttachments()`；跨 fiber 取服务走 `ctx.get('conversation')`
 * （`ui-workspace/src/client/navigation.ts` 同款）。
 *
 * @module @dsh-kit/dsh-plugin-task-board/client/draft-task
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { BoardCardImage } from '../shared.js'
import { cardImageToFile } from './image-files.js'

/** 官方图片草稿附件描述符（仅取 id，其余字段由 dsh 自己持有）。 */
export interface DraftAttachmentRef {
  readonly id: string
}

/** conversation 服务上用到的最小附件面（运行时由 `ctx.get('conversation')` 提供）。 */
export interface ConversationAttachmentFace {
  /** dsh 0.2.2 起第三参 uploadImages 决定图片草稿是否走预上载；主会话输入与原生 composer 一致取 true。 */
  createDrafts(sessionId: SessionId, files: readonly File[], uploadImages: boolean): readonly DraftAttachmentRef[]
  releaseDraftAttachments(attachments: readonly DraftAttachmentRef[]): void
}

/** 回填草稿所需的最小 session-scoped conversation 接口。 */
interface ConversationInputFace {
  input: {
    for(scope: unknown): {
      setDraft(text: string): void
      /** 追加浏览器侧图片草稿附件 id；提交期被锁定时返回 false。 */
      addAttachments(ids: readonly string[]): boolean
    }
  }
}

/** 填草稿所需的 client service 最小面（真实形状由 dsh Context 合并提供）。 */
export interface DraftTaskDeps {
  readonly sessions: {
    create(options?: { workspaceId?: string }): Promise<SessionId>
    scope(id: SessionId): { get(name: 'conversation'): ConversationInputFace | undefined } | undefined
  }
  readonly uiWorkspace: {
    openSession(target: SessionId): void
  }
  /** 图片草稿附件服务；无图片或缺省时不触碰。 */
  readonly attachments?: ConversationAttachmentFace | undefined
}

/** 一次回填请求。 */
export interface DraftTaskRequest {
  /** 任务文本（草稿正文）。 */
  readonly text: string
  /** 目标工作区；缺省/undefined = dsh 默认落点（当前/最近工作区）。 */
  readonly workspaceId?: string | undefined
  /** 卡片图片；按顺序作为图片附件加入草稿。 */
  readonly images?: readonly BoardCardImage[] | undefined
}

/**
 * 在目标工作区新建对话、把任务文本与图片填入输入框（不发送）。
 * @param deps - dsh client 服务面。
 * @param request - 文本、目标工作区与图片；标题不在其中。
 * @returns 新会话 id。
 * @throws 会话创建失败、scope 未物化或图片附件服务不可用时抛错，由页面转为错误文案。
 */
export async function draftTaskToWorkspace(
  deps: DraftTaskDeps,
  request: DraftTaskRequest,
): Promise<SessionId> {
  const trimmed = request.text.trim()
  if (trimmed === '') throw new Error('task text is empty')
  const images = request.images ?? []
  if (images.length > 0 && deps.attachments === undefined) {
    throw new Error('task-board: conversation attachment service is unavailable')
  }
  const sessionId = await deps.sessions.create(
    request.workspaceId === undefined || request.workspaceId === '' ? {} : { workspaceId: request.workspaceId },
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
  if (images.length > 0 && deps.attachments !== undefined) {
    const files = images.map(cardImageToFile)
    const drafts = deps.attachments.createDrafts(sessionId, files, true)
    if (drafts.length > 0 && !input.addAttachments(drafts.map(draft => draft.id))) {
      // 提交期锁住或 scope 已换：不要让 object URL 与运行时附件泄漏。
      deps.attachments.releaseDraftAttachments(drafts)
      throw new Error('task-board: new conversation refused image attachments')
    }
  }
  return sessionId
}
