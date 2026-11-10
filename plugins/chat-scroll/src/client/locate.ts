/** dsh 用于助手消息的 Chat Node kind。 */
export const ASSISTANT_FLOW_KIND = 'assistant-step'

/**
 * 落点让锚点上沿停在滚动容器上沿下方 26px。锚点是 turn 头部（33px 行高）时，
 * 0 inset 会让「已完成，用时 X秒」紧贴视口顶边显得太挤；26px 留出一行左右的
 * 呼吸位。代价是顶部会露出上一条内容被裁切的一行——用户明确选择这个观感。
 */
export const LANDING_INSET_PX = 26

/** 滚动定位的最长稳定时间；超时不能闪出虚假的到达效果。 */
export const MAX_LANDING_WAIT_MS = 1_800

/** 等待会话切换 DOM commit 的最长时间，超时后放弃。 */
export const MAX_TARGET_WAIT_MS = 3_000

/** 查找一个已完成助手消息所需的 Chat snapshot 最小子集。 */
export interface ChatOrderSnapshot {
  readonly order: readonly string[]
  readonly nodes: {
    get(key: string): {
      readonly kind?: string
      readonly data?: unknown
    } | undefined
  }
}

/** 从一个已完成的助手 Chat Node 读取持久消息 id。 */
function finalizedAssistantMessageId(
  node: ReturnType<ChatOrderSnapshot['nodes']['get']>,
): string | null {
  if (node?.kind !== ASSISTANT_FLOW_KIND) return null
  const data = node.data
  if (typeof data !== 'object' || data === null) return null
  const finalNode = (data as { readonly finalNode?: unknown }).finalNode
  if (typeof finalNode !== 'object' || finalNode === null) return null
  const messageId = (finalNode as { readonly messageId?: unknown }).messageId
  return typeof messageId === 'string' ? messageId : null
}

/**
 * 每个 Chat snapshot 的 messageId → key 反查索引。
 * 每条已完成助手消息的操作按钮各挂一个 useChat selector，流式期间每次 store 通知
 * 都会对全部订阅者重跑 selector；按 snapshot 建一次索引把每次通知的总成本从
 * O(按钮数 × order 长度) 降为 O(order 长度 + 按钮数)。snapshot 被替换后随 WeakMap 回收。
 */
const assistantKeyIndexCache = new WeakMap<ChatOrderSnapshot, ReadonlyMap<string, string>>()

function assistantKeyIndex(snapshot: ChatOrderSnapshot): ReadonlyMap<string, string> {
  const cached = assistantKeyIndexCache.get(snapshot)
  if (cached !== undefined) return cached
  const index = new Map<string, string>()
  for (const key of snapshot.order) {
    if (key === undefined) continue
    const messageId = finalizedAssistantMessageId(snapshot.nodes.get(key))
    if (messageId !== null && !index.has(messageId)) index.set(messageId, key)
  }
  assistantKeyIndexCache.set(snapshot, index)
  return index
}

/** 查找一个已完成助手消息对应的 Chat Node key（order 中最先出现者）。 */
export function assistantMessageNodeKey(
  snapshot: ChatOrderSnapshot,
  messageId: string,
): string | null {
  return assistantKeyIndex(snapshot).get(messageId) ?? null
}

/** 查找一个已渲染的助手行，优先使用 snapshot 的稳定 key。 */
export function findAssistantMessageRow(root: ParentNode, preferredKey: string | null): HTMLElement | null {
  const rows = Array.from(root.querySelectorAll<HTMLElement>(`[data-chat-flow-kind="${ASSISTANT_FLOW_KIND}"]`))
  if (preferredKey !== null) {
    const index = rows.findIndex(row => row.dataset.chatFlowKey === preferredKey)
    if (index >= 0) {
      // 折叠的工具/过程分组里，消息的第一个 part 行可能 hidden 或零高（rect 全零，
      // 按它计算会把目标错位成「当前位置减一个视口上沿」）。同一消息的所有 part 行
      // 共享 data-chat-node-key：按 DOM 序找第一条可测量的行；都不行就等待。
      const nodeKey = rows[index]?.dataset.chatNodeKey
      for (const row of rows.filter(candidate => candidate.dataset.chatNodeKey === nodeKey)) {
        if (row.hidden || row.getBoundingClientRect().height === 0) continue
        return row
      }
      return null
    }
    return null
  }
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index]
    if (row !== undefined && !row.hidden) return row
  }
  return rows.at(-1) ?? null
}

/** 计算把锚点上沿贴到滚动容器上沿所需的 scrollTop。 */
export function scrollTopForMessage(
  currentScrollTop: number,
  rowTop: number,
  scrollportTop: number,
  inset = LANDING_INSET_PX,
): number {
  return Math.max(0, currentScrollTop + rowTop - scrollportTop - inset)
}

/** 判断锚点是否已到达落点（与动画的 2px 容差同口径）。 */
export function messageReachedLanding(
  rowTop: number,
  scrollportTop: number,
  inset = LANDING_INSET_PX,
  tolerance = 2,
): boolean {
  return Math.abs(rowTop - scrollportTop - inset) <= tolerance
}

/** 计算到达目标 scrollTop 还需要的临时 bottom cushion。 */
export function bottomCushionForTarget(
  targetScrollTop: number,
  scrollHeight: number,
  clientHeight: number,
): number {
  const naturalFloor = Math.max(0, scrollHeight - clientHeight)
  return Math.max(0, Math.ceil(targetScrollTop - naturalFloor))
}

/** 在 dsh 的两种会话布局中查找真正的滚动 owner。 */
export function findScrollport(row: HTMLElement): HTMLElement | null {
  const conversationScroll = row.closest<HTMLElement>('[data-conversation-scroll]')
  if (conversationScroll !== null) return conversationScroll

  const view = row.ownerDocument.defaultView
  let ancestor = row.parentElement
  while (ancestor !== null) {
    if (view !== null) {
      const overflow = view.getComputedStyle(ancestor).overflowY
      if (overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay') return ancestor
    }
    ancestor = ancestor.parentElement
  }
  return row.ownerDocument.scrollingElement as HTMLElement | null
}

/** 平滑移动真正的滚动 owner 并返回目标位置。 */
export function scrollMessageToTop(
  row: HTMLElement,
  scrollport: HTMLElement,
  behavior: ScrollBehavior,
  inset = LANDING_INSET_PX,
): number {
  const rowRect = row.getBoundingClientRect()
  const scrollportRect = scrollport.getBoundingClientRect()
  const target = scrollTopForMessage(
    scrollport.scrollTop,
    rowRect.top,
    scrollportRect.top,
    inset,
  )
  if (typeof scrollport.scrollTo === 'function') scrollport.scrollTo({ top: target, behavior })
  else scrollport.scrollTop = target
  return target
}

/** 将分界线裁剪到消息行可见的水平范围。 */
export function dividerGeometry(
  row: Pick<DOMRect, 'left' | 'right' | 'top'>,
  scrollport: Pick<DOMRect, 'left' | 'right'>,
): { left: number; top: number; width: number } {
  const left = Math.max(row.left, scrollport.left)
  const right = Math.min(row.right, scrollport.right)
  return { left, top: row.top, width: Math.max(1, right - left) }
}

/** dsh 用于 turn 头部（「已完成，用时 X秒」）的 Chat Node kind。 */
export const TURN_PROCESS_FLOW_KIND = 'turn-process'

/**
 * 查找目标行所属 turn 的原生分割线宿主（turn-process 头部按钮，其
 * border-bottom 就是「已完成，用时 X秒」下方的 hairline）。从行的祖先逐级
 * 上溯到包含同 turn 头部的 flow 层，不依赖分组嵌套形态；头部不可测量
 * （hidden 或零高，即整轮被折叠）时返回 null，由调用方退回消息行锚点。
 */
export function findTurnDividerHost(row: HTMLElement): HTMLElement | null {
  const turn = row.dataset.chatTurn
  if (turn === undefined || turn === '') return null
  let scope: HTMLElement | null = row.parentElement
  while (scope !== null) {
    const host = scope.querySelector<HTMLElement>(
      `[data-chat-flow-kind="${TURN_PROCESS_FLOW_KIND}"][data-chat-turn="${turn}"] button[data-turn-process]`,
    )
    if (host !== null) {
      return host.hidden || host.getBoundingClientRect().height === 0 ? null : host
    }
    scope = scope.parentElement
  }
  return null
}

/** 头部下沿（分割线）至少部分落在滚动可视区内，高亮才看得见。 */
export function dividerVisibleInScrollport(
  header: Pick<DOMRect, 'bottom'>,
  scrollport: Pick<DOMRect, 'top'>,
): boolean {
  return header.bottom >= scrollport.top
}
