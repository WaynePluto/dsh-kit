import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { previousCompletedTurnEnd, type ForkTimeline } from '../shared.js'

/** draft hand-off 所需的 session-scoped conversation input 接口。 */
export interface ForkConversationScope {
  input: {
    for(scope: unknown): { setDraft(text: string): void }
  }
}

/** 新会话的目标位置：优先工作区（会话归组），其次源会话目录。 */
export interface FreshConversationTarget {
  readonly workspaceId?: string
  readonly cwd?: string
}

/** controller 和测试使用的最小 client session 接口。 */
export interface ForkSessions {
  fork(options: { sessionId: SessionId; atSeq: number; increaseTitle: boolean }): Promise<SessionId>
  create(options?: FreshConversationTarget): Promise<SessionId>
  scope(id: SessionId): { get(name: 'conversation'): ForkConversationScope | undefined } | undefined
}

/**
 * 解析安全 fork 边界；必要时把未加载的历史前缀分页进 Chat window。
 * @param loadedEndSeq - 当前 Chat timeline 已可见的边界。
 * @param currentTurn - 被点击 user message 所在 turn。
 * @param turnStartSeq - 该 turn `turn/start` 的 durable seq（若已知）。
 * @param loadThrough - session history pager。
 * @param readTimeline - 分页后的 Chat timeline reader。
 * @returns 之前完成的 `turn/end` sequence。
 */
export async function resolvePreviousTurnEnd(
  loadedEndSeq: number | undefined,
  currentTurn: number,
  turnStartSeq: number | undefined,
  loadThrough: (seq: number) => Promise<void>,
  readTimeline: () => ForkTimeline | undefined,
): Promise<number> {
  if (loadedEndSeq !== undefined) return loadedEndSeq
  if (currentTurn <= 1 || turnStartSeq === undefined || turnStartSeq <= 0) {
    throw new Error('user-message-fork: the clicked message has no earlier turn')
  }
  await loadThrough(turnStartSeq - 1)
  const after = readTimeline()
  const resolved = after === undefined ? undefined : previousCompletedTurnEnd(after, currentTurn)
  if (resolved === undefined) {
    throw new Error('user-message-fork: no completed turn before the clicked message')
  }
  return resolved
}

/**
 * 把被点击的用户文本写入某个会话的 composer。
 *
 * 必须在会话已经被 retain 之后调用：dsh 只为已 retain 的会话物化 client scope，
 * `sessions.fork()`/`sessions.create()` 只登记目录行，`sessions.scope()` 此时仍是 undefined
 * （见 docs/dsh/conversation.md）。
 * @param sessions - dsh client session service。
 * @param sessionId - 已打开（retained）的目标会话。
 * @param text - 被点击用户文本。
 */
function seedDraft(sessions: ForkSessions, sessionId: SessionId, text: string): void {
  const scope = sessions.scope(sessionId)
  if (scope === undefined) throw new Error(`user-message-fork: session "${String(sessionId)}" has no client scope`)
  const conversation = scope.get('conversation')
  if (conversation === undefined) {
    throw new Error(`user-message-fork: session "${String(sessionId)}" has no conversation service`)
  }
  conversation.input.for(scope).setDraft(text)
}

/**
 * 在普通 user message 之前 fork：先打开 child（dsh 只有 retain 后才物化 scope），再向 child composer 写入 draft。
 * @param sessions - dsh client session service。
 * @param sessionId - source session。
 * @param atSeq - 之前完成的 turn/end sequence。
 * @param text - 被点击用户文本，写入 child composer。
 * @returns 新 child session id。
 */
export async function forkAndSeedUserMessage(
  sessions: ForkSessions,
  openSession: (id: SessionId) => void,
  sessionId: SessionId,
  atSeq: number,
  text: string,
): Promise<SessionId> {
  const childId = await sessions.fork({ sessionId, atSeq, increaseTitle: true })
  openSession(childId)
  seedDraft(sessions, childId, text)
  return childId
}

/**
 * 被点击消息之前没有可继承的已完成轮次时：新建一个普通会话（同工作区/目录，不带 parentSession），
 * 打开后把这条消息回填进 composer。
 * @param sessions - dsh client session service。
 * @param openSession - 导航到新会话。
 * @param target - 新会话的工作区或目录。
 * @param text - 被点击用户文本，写入新会话 composer。
 * @returns 新会话 id。
 */
export async function createAndSeedUserMessage(
  sessions: ForkSessions,
  openSession: (id: SessionId) => void,
  target: FreshConversationTarget,
  text: string,
): Promise<SessionId> {
  const sessionId = await sessions.create(target)
  openSession(sessionId)
  seedDraft(sessions, sessionId, text)
  return sessionId
}
