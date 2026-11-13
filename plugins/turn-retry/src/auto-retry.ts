/**
 * Host half：模型请求失败的在环自动重试（固定行为，无设置项）。
 *
 * 1) `PI_AI_ERROR`（pi-ai 无法分类的上游错误，如中转返回的非标准文案）在同一
 *    turn/step 内自动重试一次，重试前等待 2 秒；官方 llm-retry 对该码本就放弃，
 *    两条路径互不影响。
 * 2) 官方 llm-retry normal 模式的瞬态重试全局封顶为 2 次：监听器以 prepend 挂到
 *    `agent/request-error` waterfall 最前，预算耗尽时不调 `next` 直接返回
 *    undefined，官方 llm-retry 被短路；预算未耗尽时原样 `next`，事件、退避与
 *    持久化仍是官方的。`mode:'always'` 是用户显式配置的无限重试，不封顶。
 *
 * 不追加任何 session 事件（铁律）；封顶计数来自折叠官方 `llm/retry` 事件的投影，
 * 未知错误计数只在内存中（重启后重来一次，可接受）。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent, RequestErrorAction } from '@deepseek-ai/dsh-agent'
// 仅类型：`agent/request-error` 的事件声明在 dsh-agent。
import type {} from '@deepseek-ai/dsh-agent'
import type { ProjectionHandle } from '@deepseek-ai/dsh-session-projection'
// 仅类型：`llm/retry` / `llm/retry-started` 的 SessionEventMap 声明合并在 dsh-llm-retry。
import type {} from '@deepseek-ai/dsh-llm-retry'
import { z as zod } from 'zod'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { LlmFailure, ResolvedRetryPolicy } from '@deepseek-ai/dsh-llm'

/**
 * `agent/request-error` 的载荷形状（与 dsh-agent runtime-types 的声明一致；
 * 不用 `Parameters<Events<...>>` 内联索引，oxc 解析器对字符串字面量泛型实参误报）。
 */
export interface RequestErrorPayload {
  agent: Agent
  turn: number
  step: number
  provider: string
  failure: LlmFailure
  retryPolicy: ResolvedRetryPolicy | undefined
  signal: AbortSignal
}

/** 封顶投影的 state schema；registry 会调用 `.parse()`。 */
const autoCapSchema = zod.object({ retry: zod.number().int().nonnegative() })

/** 封顶投影的空初始状态。 */
export const AUTO_CAP_INITIAL: AutoCapState = Object.freeze({ retry: 0 })

/** 官方瞬态重试的全局上限（对默认 5 次的收紧）。 */
export const MAX_TRANSIENT_RETRIES = 2

/** 未知错误自动重试前的等待毫秒数。 */
export const UNKNOWN_RETRY_DELAY_MS = 2000

/** 封顶投影 key；只折叠官方 `llm/retry` 事件，与 llm-retry 自己的投影同口径按 step 重置。 */
export const AUTO_CAP_PROJECTION_KEY = 'turnRetryAutoCap'

/** 封顶投影状态：当前 step 内官方已排程的最大重试序号。 */
export interface AutoCapState {
  retry: number
}

/**
 * 折叠一个持久 session event：`llm/retry` 记录其 retry 序号，`step/start` 与
 * `turn/end` 重置（与官方 llm-retry 投影的边界一致）；未知事件返回原引用。
 */
export function foldAutoCap(state: AutoCapState, event: SessionEvent): AutoCapState {
  switch (event.type) {
    case 'llm/retry': {
      const retry = event.data.retry
      return retry > state.retry ? { retry } : state
    }
    case 'step/start':
    case 'turn/end':
      return { retry: 0 }
    default:
      return state
  }
}

/** 可注入的等待实现；测试用假时钟替换。 */
export type CancellableWait = (delayMs: number, signal: AbortSignal) => Promise<boolean>

/** 生产等待：到时返回 true，signal 先中止返回 false。 */
function realWait(delayMs: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false)
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve(true)
    }, delayMs)
    function onAbort(): void {
      clearTimeout(timer)
      resolve(false)
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/** 未知错误重试的内存计数；按 session 对象弱引用，turn/step 变化即重置。 */
interface UnknownRetrySlot {
  turn: number
  step: number
  retried: boolean
}

/** 默认内存表；测试可传入自己的 WeakMap 隔离。 */
const unknownSlots = new WeakMap<object, UnknownRetrySlot>()

/** 读取或初始化某个 session 在指定 turn/step 的未知错误重试槽位。 */
function unknownSlot(
  slots: WeakMap<object, UnknownRetrySlot>,
  session: object,
  turn: number,
  step: number,
): UnknownRetrySlot {
  const existing = slots.get(session)
  if (existing !== undefined && existing.turn === turn && existing.step === step) return existing
  const slot: UnknownRetrySlot = { turn, step, retried: false }
  slots.set(session, slot)
  return slot
}

/** 判断失败码是否属于官方 normal 策略会重试的码。 */
function isOfficiallyRetryable(payload: RequestErrorPayload): boolean {
  const policy = payload.retryPolicy
  return policy !== undefined
    && policy.mode === 'normal'
    && policy.retryableCodes.includes(payload.failure.code)
}

/**
 * 生成 `agent/request-error` 的拦截监听器。
 * @param stateOf - 读取封顶投影（接收 agent.session，返回当前 step 的官方重试序号）。
 * @param wait - 可取消等待，默认真实计时。
 * @returns waterfall 监听器；决策顺序见模块注释。
 */
export function createAutoRetryInterceptor(
  stateOf: (session: Agent['session']) => AutoCapState | undefined,
  wait: CancellableWait = realWait,
  slots: WeakMap<object, UnknownRetrySlot> = unknownSlots,
): (payload: RequestErrorPayload, next: () => Promise<RequestErrorAction>) => Promise<RequestErrorAction> {
  return async (payload, next) => {
    const { agent, turn, step, failure, signal } = payload
    if (signal.aborted) return undefined

    if (isOfficiallyRetryable(payload)) {
      const cap = stateOf(agent.session)
      if (cap !== undefined && cap.retry >= MAX_TRANSIENT_RETRIES) return undefined
      return next()
    }

    // 用户显式配置 always 或已把 PI_AI_ERROR 加入可重试码时，尊重官方策略。
    const policy = payload.retryPolicy
    const ownedByOfficial = policy !== undefined
      && (policy.mode === 'always' || policy.retryableCodes.includes(failure.code))
    if (failure.code === 'PI_AI_ERROR' && !ownedByOfficial) {
      const slot = unknownSlot(slots, agent.session, turn, step)
      if (slot.retried) return next()
      slot.retried = true
      if (!await wait(UNKNOWN_RETRY_DELAY_MS, signal) || signal.aborted) return undefined
      return { kind: 'retry' }
    }

    return next()
  }
}

/**
 * 在插件 ctx 上装配自动重试：注册封顶投影 + prepend 挂载拦截监听器。
 * 返回的 Promise 在投影注册完成后结算。
 */
export async function installAutoRetry(ctx: Context): Promise<ProjectionHandle<AutoCapState>> {
  const ready = ctx.sessionProjections.register({
    key: AUTO_CAP_PROJECTION_KEY,
    stateVersion: 1,
    stateSchema: autoCapSchema as unknown as zod.ZodType<AutoCapState>,
    init: () => AUTO_CAP_INITIAL,
    apply: foldAutoCap,
  })
  const handle = await ready
  ctx.on('agent/request-error', (payload, next) =>
    createAutoRetryInterceptor(session => handle.stateOf(session))(payload, next)
  , { prepend: true })
  return handle
}
