/**
 * browser half：shadow dsh user-message renderer，增加安全的“从这条消息 fork”操作。因为 dsh 只有 assistant-actions list slot，没有对应的 user-actions slot，所以必须 shadow renderer。
 *
 * @module @dsh-kit/dsh-plugin-user-message-fork/client
 */

import type { Context } from '@deepseek-ai/cordis'
// 仅类型 import：激活 dsh public Context 和 SlotMap declaration merge。
// oxlint-disable-next-line unicorn/require-module-specifiers -- 激活 locale Context 合并
import type {} from '@deepseek-ai/dsh-client-locale/client'
// oxlint-disable-next-line unicorn/require-module-specifiers -- 激活 Chat SlotMap 合并
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
// oxlint-disable-next-line unicorn/require-module-specifiers -- 激活 Conversation SlotMap 合并
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// oxlint-disable-next-line unicorn/require-module-specifiers -- 激活 renderer Context 合并
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// oxlint-disable-next-line unicorn/require-module-specifiers -- 激活 Session Context 合并
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// oxlint-disable-next-line unicorn/require-module-specifiers -- 激活 uiWorkspace Context 合并（openSession 导航）
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
// 类型 import 同时激活 workspaces Context 合并（新会话归组）与落位器要的 WorkspaceSnapshot。
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {
  InjectFace, PropsLocale, PropsRenderFactories, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId, SessionSeq } from '@deepseek-ai/dsh-session/types'
import { SELF_NAMESPACE } from '../shared.js'
import {
  createAndSeedUserMessage, forkAndSeedUserMessage, resolvePreviousTurnEnd, type FreshConversationTarget,
} from './fork.js'
import { createForkOrderPlacer, type ForkOrderEntry, type ForkOrderPlacer, type ForkOrderRuntime } from './fork-order.js'
import { UserMessageForkNodeView } from './UserMessageForkNodeView.js'
import { en, NS, zh, type UserMessageForkKey } from './locales.js'
import { installUserMessageForkStyles } from './styles.js'

export {
  createAndSeedUserMessage, forkAndSeedUserMessage, resolvePreviousTurnEnd,
  type FreshConversationTarget,
} from './fork.js'
export { previousCompletedTurnEnd, userMessageContentFacts, userMessageForkAvailability } from '../shared.js'
export { UserMessageForkNodeView } from './UserMessageForkNodeView.js'
export type { UserMessageForkKey } from './locales.js'

/** 让 locale service 可以使用本包文案。 */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'dsh-plugin-user-message-fork': UserMessageForkKey
  }
}

/** 从消息之前最后一个已完成轮次创建子会话。 */
export interface UserMessageForkRequestAtTurn {
  readonly mode: 'fork'
  /** 已解析的 `turn/end` 边界；缺省时由插件先分页补齐前缀。 */
  readonly atSeq?: number
  readonly currentTurn: number
  readonly turnStartSeq?: number
  readonly text: string
}

/** 消息之前没有可继承前缀：新建普通会话并回填这条消息。 */
export interface UserMessageForkRequestFresh {
  readonly mode: 'fresh'
  readonly text: string
}

/** user message 分叉按钮的一次点击意图。 */
export type UserMessageForkRequest = UserMessageForkRequestAtTurn | UserMessageForkRequestFresh

/** 提供给 shadow user-message renderer 的 runtime 接口。 */
export interface UserMessageForkInjected {
  forkMessage: (request: UserMessageForkRequest) => Promise<void>
}

/** shadow 普通 user message renderer 的 props；与官方 ChatNodeViewProps 同构（含 renderFactorySlot）。 */
export type UserMessageForkNodeProps =
  & PropsRuntime<'conversation.chat.node', 'user'>
  & PropsRenderFactories
  & InjectFace<UserMessageForkInjected>
  & PropsLocale<typeof NS>

/** browser half 使用的 service。 */
export const inject = ['slots', 'locale', 'sessions', 'uiConversation', 'uiWorkspace', 'workspaces']

/** keyed shadow priority；dsh 自己的 user renderer 位于默认 priority 0。 */
export const USER_RENDERER_PRIORITY = -1

/** 空列表兜底：宿主服务尚未装载时读取面必须仍可调用。 */
const EMPTY_LIST: SessionListState = { ids: [], byId: {}, phase: 'ready', projectionsBySession: {} }

/** 只读快照源：落位器需要的两个列表读取面。 */
interface SnapshotSource<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

/** 冒烟脚本与宿主服务缺席时的防御读取：dsh 装载完成后这些字段必然存在。 */
interface OptionalForkOrderServices {
  readonly sessions?: { readonly list?: SnapshotSource<SessionListState> } | undefined
  readonly workspaces?: { readonly list?: SnapshotSource<WorkspaceSnapshot> } | undefined
  readonly slots?: { entries?: (key: string) => readonly ForkOrderEntry[] } | undefined
}

/**
 * 落位器读取侧：工作区/会话快照 + 侧边栏槽位条目（视图 store 从条目里取）。
 * 全部运行时探测，缺服务时只降级为「不落位」，不影响 fork 本身。
 * @param ctx - client 根 context。
 * @returns {@link ForkOrderRuntime}。
 */
function forkOrderRuntime(ctx: Context): ForkOrderRuntime {
  const services = ctx as unknown as OptionalForkOrderServices
  return {
    entries: () => services.slots?.entries?.('sidebar.workspaces') ?? [],
    workspaces: () => services.workspaces?.list?.getSnapshot().items ?? [],
    list: () => services.sessions?.list?.getSnapshot() ?? EMPTY_LIST,
    rowState: () => {
      const snapshot = services.workspaces?.list?.getSnapshot()
      return {
        pinnedSessionIds: snapshot?.pinnedSessionIds ?? [],
        archivedSessionIds: snapshot?.archivedSessionIds ?? [],
      }
    },
    subscribe: (listener: () => void) => {
      const stops: (() => void)[] = []
      const sessions = services.sessions?.list
      if (sessions !== undefined) stops.push(sessions.subscribe(listener))
      const workspaces = services.workspaces?.list
      if (workspaces !== undefined) stops.push(workspaces.subscribe(listener))
      return () => { for (const stop of stops) stop() }
    },
  }
}

/**
 * 新会话的落点：优先源会话所在工作区（新对话与源会话同组），不属于任何工作区时退回源会话目录。
 * @param ctx - client 根 context。
 * @param sessionId - 被点击消息所在会话。
 * @returns `sessions.create()` 的目标位置。
 */
function freshConversationTarget(ctx: Context, sessionId: SessionId): FreshConversationTarget {
  const workspace = ctx.workspaces.list.getSnapshot().items
    .find(item => item.sessionIds.includes(sessionId))
  if (workspace !== undefined) return { workspaceId: workspace.workspaceId }
  const cwd = ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd
  return cwd === undefined ? {} : { cwd }
}

/** 注册 renderer、字典、stylesheet 和 fork 子会话落位。 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'user-message-fork: copy dictionaries')

  const host = typeof document === 'undefined' ? undefined : document
  ctx.effect(() => installUserMessageForkStyles(host), 'user-message-fork: styles')

  // 原生「在新对话中分叉」、侧边栏「分叉会话」和本插件的按钮都走 sessions.fork：观察会话列表
  // 新出现的子会话并排到分组第一位（普通会话，不写宿主 pin），自身路径另按已知 id 直接入队。
  const placer: ForkOrderPlacer = createForkOrderPlacer(forkOrderRuntime(ctx))
  ctx.effect(() => () => { placer.dispose() }, 'user-message-fork: fork order observation')

  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'user',
    priority: USER_RENDERER_PRIORITY,
    locale: NS,
    inject: (sessionId: SessionId): UserMessageForkInjected => ({
      forkMessage: async request => {
        const source = ctx.sessions.binding(sessionId)
        if (source === undefined) throw new Error(`user-message-fork: source "${String(sessionId)}" has no binding`)
        if (request.mode === 'fresh') {
          const createdId = await createAndSeedUserMessage(
            ctx.sessions,
            id => ctx.uiWorkspace.openSession(id),
            freshConversationTarget(ctx, sessionId),
            request.text,
          )
          placer.enqueue(createdId)
          return
        }
        const chat = ctx.uiConversation.binding(source).target('chat')
        const anchor = await resolvePreviousTurnEnd(
          request.atSeq,
          request.currentTurn,
          request.turnStartSeq,
          seq => source.session.loadThrough(seq as SessionSeq),
          () => {
            const snapshot = chat.getSnapshot()
            return snapshot === undefined ? undefined : snapshot.timeline
          },
        )
        const childId = await forkAndSeedUserMessage(ctx.sessions, id => ctx.uiWorkspace.openSession(id), sessionId, anchor, request.text)
        placer.enqueue(childId)
      },
    }),
  }, UserMessageForkNodeView))
}

/** 保持 namespace 可供检查 package bundle 的 consumer 使用。 */
export const namespace = SELF_NAMESPACE
