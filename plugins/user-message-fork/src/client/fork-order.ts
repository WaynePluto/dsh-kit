/**
 * fork 子会话在侧边栏里的落点：所属工作区分组的第一个位置（未归组时「未分组」的第一位）
 * 与扁平列表第一位，**不写宿主 pin**，因此它仍是普通会话。
 *
 * dsh 没有「只移动位置不要置顶」的公共 API：分组显示顺序在手动模式（`orderBy: 'manual'`）
 * 下由浏览器本地视图 store（localStorage `dsh.workspace.view.v5` 的
 * `sessionOrderByAccount`）决定，宿主 `workspace.insertSessionBefore` 不参与显示。
 * 所以这里从 `sidebar.workspaces` 槽位条目取到 ui-workspace 自己的视图 store，调用它的
 * `pinSessionOrder` 动作——原生「置顶」按钮写顺序用的就是这一个动作，只是本插件不调用
 * `uiWorkspace.pinSession`。上游依据：`packages/client/ui-workspace/src/client/`
 * `{stores.ts,tree.ts,pin-order.ts,navigation.ts}`。
 *
 * 依赖是跨插件的内部契据，全部运行时探测：store 缺失或动作改名时只降级为「不生效」
 * （`waiting`），不抛错、不影响 fork 本身。
 */
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** 侧边栏扁平列表的顺序账户键（同 ui-workspace `FLAT_SESSION_ORDER_KEY`）。 */
export const FLAT_SESSION_ORDER_KEY = '__flat_session_order__'

/** 未归入任何工作区的会话所在分组键（同 ui-workspace `UNGROUPED_KEY`）。 */
export const UNGROUPED_KEY = ''

/** 排序只关心工作区身份与成员顺序。 */
export type ForkOrderWorkspace = Pick<WorkspaceView, 'workspaceId' | 'sessionIds'>

/** 手动顺序重算需要的全局 pin / 归档集合。 */
export interface ForkOrderRowState {
  readonly pinnedSessionIds: readonly SessionId[]
  readonly archivedSessionIds: readonly SessionId[]
}

/** ui-workspace 重排动作要的顺序来源（同 `pinOrderSource` 的产物）。 */
export interface ForkOrderSource {
  /** 每个账户的完整成员：每个工作区、未分组、扁平列表。 */
  readonly members: Readonly<Record<string, readonly SessionId[]>>
  readonly summaries: SessionListState['byId']
  readonly rowState: ForkOrderRowState
}

/** 视图 store 的写面：只取重排动作与一次快照读取。 */
export interface ForkOrderStoreInstance {
  readonly actions?: {
    readonly pinSessionOrder?: (
      sessionId: SessionId,
      accountKeys: readonly string[],
      source: ForkOrderSource,
    ) => void
  } | undefined
  getSnapshot?(): { readonly sessionOrderByAccount?: Readonly<Record<string, readonly string[]>> } | undefined
}

/** 视图 store 句柄：`create()` 恒返回同一个原生实例。 */
export interface ForkOrderStore {
  create(): ForkOrderStoreInstance
}

/** 槽位条目中本模块唯一需要的字段。 */
export interface ForkOrderEntry {
  readonly store?: unknown
}

/** 一次落位尝试的结果：`waiting` 表示依赖还没就绪，等下一次快照通知。 */
export type ForkOrderPlacement = 'placed' | 'waiting' | 'failed'

/** 落位所需的应用侧读取面。 */
export interface ForkOrderRuntime {
  /** `ctx.slots.entries('sidebar.workspaces')`。 */
  entries(): readonly ForkOrderEntry[]
  workspaces(): readonly ForkOrderWorkspace[]
  list(): SessionListState
  rowState(): ForkOrderRowState
  /** 订阅工作区与会话列表变化。 */
  subscribe(listener: () => void): () => void
}

/**
 * 会话所在的分组键：所属工作区，或未分组。
 * @param workspaces - 当前工作区快照。
 * @param sessionId - 目标会话。
 * @returns 工作区 id，或 {@link UNGROUPED_KEY}。
 */
export function owningGroupKey(
  workspaces: readonly ForkOrderWorkspace[],
  sessionId: SessionId,
): string {
  return workspaces.find(workspace => workspace.sessionIds.includes(sessionId))?.workspaceId ?? UNGROUPED_KEY
}

/**
 * 扁平列表成员：跳过 subagent，blank 只保留当前选中的那一个（同 dsh `sessionMemberIds`）。
 * @param list - 会话列表快照。
 * @returns 扁平账户的成员 id。
 */
function flatOrderMembers(list: SessionListState): SessionId[] {
  const current = Object.values(list.byId).find(summary => (summary.retainedBy.mainView ?? 0) > 0)?.id
  return list.ids.filter((id) => {
    const summary = list.byId[id]
    if (summary === undefined || summary.origin === 'subagent') return false
    return summary.blank ? id === current : true
  })
}

/**
 * 每个账户的完整成员表：每个工作区、未分组、扁平列表。
 * @param workspaces - 当前工作区快照。
 * @param list - 会话列表快照。
 * @returns 账户键 → 成员 id。
 */
export function forkOrderMembers(
  workspaces: readonly ForkOrderWorkspace[],
  list: SessionListState,
): Readonly<Record<string, readonly SessionId[]>> {
  const accounted = new Set(workspaces.flatMap(workspace => workspace.sessionIds))
  const members: Record<string, readonly SessionId[]> = {}
  for (const workspace of workspaces) members[workspace.workspaceId] = [...workspace.sessionIds]
  members[UNGROUPED_KEY] = list.ids.filter(id => list.byId[id] !== undefined && !accounted.has(id))
  members[FLAT_SESSION_ORDER_KEY] = flatOrderMembers(list)
  return members
}

/**
 * 从槽位条目里挑出带 `create()` 的视图 store 句柄。
 * @param entries - `sidebar.workspaces` 的注册条目。
 * @returns 可用的 store 句柄；没有则 undefined。
 */
export function pickForkOrderStore(entries: readonly ForkOrderEntry[]): ForkOrderStore | undefined {
  for (const entry of entries) {
    const store: unknown = entry.store
    if (typeof store !== 'object' || store === null) continue
    if (typeof (store as { create?: unknown }).create !== 'function') continue
    return store as ForkOrderStore
  }
  return undefined
}

/** 动作调用后核对两个账户的第一位；读不到快照时按成功处理（动作没抛错即已写入）。 */
function placedInEveryAccount(
  instance: ForkOrderStoreInstance,
  accountKeys: readonly string[],
  sessionId: SessionId,
): boolean {
  if (typeof instance.getSnapshot !== 'function') return true
  let orders: Readonly<Record<string, readonly string[]>> | undefined
  try {
    orders = instance.getSnapshot()?.sessionOrderByAccount
  } catch {
    return true
  }
  if (orders === undefined) return false
  return accountKeys.every(key => orders[key]?.[0] === sessionId)
}

/**
 * 把一个会话排到其分组与扁平列表的第一位（普通会话，不进 pin 集合）。
 * @param runtime - 应用侧读取面。
 * @param sessionId - 目标会话。
 * @param options - `allowUngrouped` 允许把尚未归入工作区的会话写进「未分组」账户。
 * @returns `placed` 已确认落位；`waiting` 成员关系或 store 尚未就绪；`failed` 写入被拒或未生效。
 */
export function placeSessionFirst(
  runtime: ForkOrderRuntime,
  sessionId: SessionId,
  options: { readonly allowUngrouped?: boolean } = {},
): ForkOrderPlacement {
  const workspaces = runtime.workspaces()
  const list = runtime.list()
  const groupKey = owningGroupKey(workspaces, sessionId)
  // fork 子会话的宿主 attach 帧可能晚于 fork 返回：分组未知时先等下一帧，
  // 否则会把它写进「未分组」账户，attach 到达后分组里仍然沉底。
  if (groupKey === UNGROUPED_KEY && options.allowUngrouped !== true) return 'waiting'
  const members = forkOrderMembers(workspaces, list)
  const member = Object.values(members).some((ids) => {
    return ids.includes(sessionId)
  })
  if (!member) return 'waiting'
  const store = pickForkOrderStore(runtime.entries())
  if (store === undefined) return 'waiting'
  let instance: ForkOrderStoreInstance
  try {
    instance = store.create()
  } catch {
    return 'waiting'
  }
  const actions = instance.actions
  const place = actions?.pinSessionOrder
  if (actions === undefined || typeof place !== 'function') return 'waiting'
  const accountKeys = [groupKey, FLAT_SESSION_ORDER_KEY]
  try {
    place.call(actions, sessionId, accountKeys, { members, summaries: list.byId, rowState: runtime.rowState() })
  } catch {
    return 'failed'
  }
  return placedInEveryAccount(instance, accountKeys, sessionId) ? 'placed' : 'failed'
}

/**
 * 单行判定：这是一条「刚 fork 出来的子会话」吗（非 blank、非 subagent、updatedAt 在近期窗口内）。
 * fork 子会话的 header `createdAt` 是 fork 时刻，冷历史摘要不会命中。
 * @param summary - 会话行；未知时判负。
 * @param now - 当前时间（epoch ms）。
 * @param windowMs - 「刚创建」的时间窗口。
 * @returns 需要落位时为 true。
 */
export function isFreshForkChild(
  summary: SessionListState['byId'][SessionId] | undefined,
  now: number,
  windowMs: number,
): boolean {
  if (summary === undefined || summary.blank || summary.origin === 'subagent') return false
  return summary.updatedAt >= now - windowMs
}

/** 落位器可调参数。 */
export interface ForkOrderPlacerOptions {
  /** 同一会话的最大落位失败次数（按快照通知计）。 */
  readonly maxAttempts?: number
  /** 等待工作区成员关系的宽限次数：超过后把它当作「未分组」会话落位。 */
  readonly ungroupedGrace?: number
  readonly now?: () => number
  /** 判定「刚 fork 出来」的 updatedAt 窗口。 */
  readonly freshWindowMs?: number
  readonly warn?: (message: string, error?: unknown) => void
}

/** fork 子会话落位器。 */
export interface ForkOrderPlacer {
  /** 已知新会话 id 时直接入队（本插件自己的 fork 路径）。 */
  enqueue(sessionId: SessionId): void
  /** 仍在等待落位的会话数（诊断与测试用）。 */
  pending(): number
  dispose(): void
}

/** 默认窗口：fork 后宿主 attach 帧与会话投影都在秒级到达。 */
const DEFAULT_FRESH_WINDOW_MS = 120_000

/** 默认重试上限：每次快照通知算一次。 */
const DEFAULT_MAX_ATTEMPTS = 40

/** 默认宽限次数：工作区 attach 帧通常在两三次快照通知内到达。 */
const DEFAULT_UNGROUPED_GRACE = 8

/**
 * 创建落位器：观察会话列表发现原生「在新对话中分叉」/侧栏「分叉会话」创建的子会话，
 * 并按快照通知重试落位。
 * @param runtime - 应用侧读取面。
 * @param options - 重试与窗口参数。
 * @returns 入队、查询与释放入口。
 */
export function createForkOrderPlacer(
  runtime: ForkOrderRuntime,
  options: ForkOrderPlacerOptions = {},
): ForkOrderPlacer {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  const ungroupedGrace = options.ungroupedGrace ?? DEFAULT_UNGROUPED_GRACE
  const now = options.now ?? (() => Date.now())
  const freshWindowMs = options.freshWindowMs ?? DEFAULT_FRESH_WINDOW_MS
  const warn = options.warn ?? ((message: string): void => { console.warn(message) })
  /** 会话 id → 已消耗的等待/失败次数。 */
  const pending = new Map<SessionId, number>()
  let known: Set<string> | undefined
  let stopped = false

  const flush = (): void => {
    if (pending.size === 0) return
    // 迭代中只删除或改写已有键，不会新增键，因此可以直接遍历 Map。
    for (const [sessionId, attempts] of pending) {
      const outcome = placeSessionFirst(runtime, sessionId, { allowUngrouped: attempts >= ungroupedGrace })
      if (outcome === 'placed') {
        pending.delete(sessionId)
        continue
      }
      const next = attempts + 1
      if (next >= maxAttempts) {
        pending.delete(sessionId)
        warn(`user-message-fork: could not move "${String(sessionId)}" to the top of its workspace`)
        continue
      }
      pending.set(sessionId, next)
    }
  }

  const onChange = (): void => {
    if (stopped) return
    try {
      const list = runtime.list()
      if (known === undefined) {
        // 第一份 ready 快照只当基线：它里面的会话都不是这次插件运行中 fork 出来的。
        if (list.phase !== 'ready') return
        known = new Set(list.ids)
      } else {
        // 逐条记录新 id（不重建整张表）；判负的 id 也只判一次，避免重复入队。
        const moment = now()
        for (const sessionId of list.ids) {
          if (known.has(sessionId)) continue
          known.add(sessionId)
          if (!isFreshForkChild(list.byId[sessionId], moment, freshWindowMs)) continue
          if (!pending.has(sessionId)) pending.set(sessionId, 0)
        }
      }
      flush()
    } catch (error) {
      warn('user-message-fork: fork order observation failed', error)
    }
  }

  let unsubscribe: (() => void) | undefined
  try {
    unsubscribe = runtime.subscribe(onChange)
  } catch (error) {
    warn('user-message-fork: fork order subscription unavailable', error)
  }
  onChange()

  return {
    enqueue(sessionId: SessionId): void {
      if (stopped) return
      if (!pending.has(sessionId)) pending.set(sessionId, 0)
      flush()
    },
    pending: () => pending.size,
    dispose(): void {
      stopped = true
      pending.clear()
      unsubscribe?.()
      unsubscribe = undefined
    },
  }
}
