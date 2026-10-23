/** 两半和 browser module loader 共用的产品 identity。 */
export const SELF_NAMESPACE = 'dsh-plugin-user-message-fork' as const

/** 纯 fork eligibility logic 使用的最小 Turn 边界形状。 */
export interface ForkTurnBoundary {
  readonly end?: { readonly seq: number } | undefined
}

/** 解析消息之前最近完成 turn 所需的数据。 */
export interface ForkTimeline {
  readonly turnOrder: readonly number[]
  readonly turns: ReadonlyMap<number, ForkTurnBoundary>
}

/** user-message fork control 不能激活的原因。 */
export type UserMessageForkUnavailableReason =
  | 'empty-text'
  | 'unsupported-content'

/** user-message fork 边界检查的纯结果。 */
export type UserMessageForkAvailability =
  | { readonly kind: 'ready'; readonly atSeq: number }
  /** 更早边界不在已加载窗口中；点击时需要分页加载。 */
  | { readonly kind: 'needs-history' }
  /** 消息之前没有可继承的已完成轮次：新建普通会话并回填这条消息。 */
  | { readonly kind: 'fresh' }
  | { readonly kind: 'unavailable'; readonly reason: UserMessageForkUnavailableReason }

/**
 * 每个 timeline 的 turn → 之前最近完成 turn 边界索引。每条已挂载 user message
 * 各挂一个 useChat selector，流式期间每次 store 通知都会对全部订阅者重跑；
 * 按 timeline 建一次索引把每次通知的总成本从 O(消息数 × turn 数) 降为
 * O(turn 数 + 消息数)。timeline 随 snapshot 替换，索引随 WeakMap 回收。
 */
const previousEndIndexCache = new WeakMap<ForkTimeline, ReadonlyMap<number, number | undefined>>()

function previousEndIndex(timeline: ForkTimeline): ReadonlyMap<number, number | undefined> {
  const cached = previousEndIndexCache.get(timeline)
  if (cached !== undefined) return cached
  const index = new Map<number, number | undefined>()
  // 从前向后滚动累积：每个 turn 的答案就是它之前最近完成 turn 的边界。
  let lastEnd: number | undefined
  for (const turn of timeline.turnOrder) {
    index.set(turn, lastEnd)
    const boundary = timeline.turns.get(turn)
    if (boundary?.end !== undefined) lastEnd = boundary.end.seq
  }
  previousEndIndexCache.set(timeline, index)
  return index
}

/**
 * 查找消息所属 turn 之前最近完成的 turn。dsh fork API 从 `atSeq` 之后首个 `turn/end` 截断，因此返回值正好排除被点击 turn 并保留更早的完成 turn。
 * @param timeline - Chat 不可变的 turn 顺序和边界。
 * @param currentTurn - 被点击普通 user message 所在 turn。
 * @returns 之前完成的 turn/end sequence；没有时为 undefined。
 */
export function previousCompletedTurnEnd(
  timeline: ForkTimeline,
  currentTurn: number,
): number | undefined {
  const currentIndex = timeline.turnOrder.indexOf(currentTurn)
  if (currentIndex <= 0) return undefined
  return previousEndIndex(timeline).get(currentTurn)
}

/** 从一条 user message 提取的文本和可能丢失内容事实。 */
export interface UserMessageContentFacts {
  readonly text: string
  /** setDraft 无法表示 attachments 和未知 blocks。 */
  readonly hasUnsupportedContent: boolean
}

/**
 * 提取可以安全放入 dsh plain composer 的文本。遇到 attachments 或未来/未知 block 时禁用操作，而不是 fork 时静默丢内容。
 * @param content - dsh user-message content blocks。
 * @returns 精确拼接文本及是否含有可能丢失的部分。
 */
export function userMessageContentFacts(content: readonly unknown[]): UserMessageContentFacts {
  const texts: string[] = []
  let hasUnsupportedContent = false
  for (const block of content) {
    if (typeof block !== 'object' || block === null) {
      hasUnsupportedContent = true
      continue
    }
    const candidate = block as { readonly type?: unknown; readonly text?: unknown }
    if (candidate.type === 'text' && typeof candidate.text === 'string') {
      texts.push(candidate.text)
    } else {
      hasUnsupportedContent = true
    }
  }
  return { text: texts.join(''), hasUnsupportedContent }
}

/**
 * 判断 user-message fork 是否能保留请求的编辑流程。
 * @param previousEndSeq - 被点击消息前的完成边界。
 * @param content - 提取后的消息事实。
 * @param previousHistoryMayBeUnloaded - 前面的边界可能还没分页进来。
 * @returns 安全 anchor、需要分页、无可继承前缀的新会话，或禁用 control 的稳定原因。
 */
export function userMessageForkAvailability(
  previousEndSeq: number | undefined,
  content: UserMessageContentFacts,
  previousHistoryMayBeUnloaded = false,
): UserMessageForkAvailability {
  if (content.text.trim() === '') {
    return { kind: 'unavailable', reason: 'empty-text' }
  }
  if (content.hasUnsupportedContent) {
    return { kind: 'unavailable', reason: 'unsupported-content' }
  }
  if (previousEndSeq !== undefined) return { kind: 'ready', atSeq: previousEndSeq }
  if (previousHistoryMayBeUnloaded) return { kind: 'needs-history' }
  return { kind: 'fresh' }
}
