/** 在环自动重试：未知错误一次 + 官方瞬态重试封顶 2 的决策与投影折叠。 */

import { describe, expect, it, vi } from 'vitest'
import {
  AUTO_CAP_INITIAL, createAutoRetryInterceptor, foldAutoCap, MAX_TRANSIENT_RETRIES,
  UNKNOWN_RETRY_DELAY_MS,
} from '../src/auto-retry.js'
import type { AutoCapState, RequestErrorPayload } from '../src/auto-retry.js'
import type { RequestErrorAction } from '@deepseek-ai/dsh-agent'

/** 官方 normal 策略默认可重试码集合（与 dsh 0.2.2 默认一致）。 */
const DEFAULT_RETRYABLE = ['EMPTY_RESPONSE', 'RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT']

interface PayloadOptions {
  code?: string
  retryableCodes?: string[] | null
  mode?: 'normal' | 'always'
  cap?: AutoCapState | undefined
  turn?: number
  step?: number
  aborted?: boolean
}

function buildPayload(options: PayloadOptions = {}, session?: object): RequestErrorPayload {
  return {
    agent: { session: session ?? { id: 's1' } },
    turn: options.turn ?? 1,
    step: options.step ?? 1,
    provider: 'openai',
    failure: { code: options.code ?? 'PI_AI_ERROR', message: 'boom' },
    retryPolicy: options.retryableCodes === null
      ? undefined
      : {
        mode: options.mode ?? 'normal',
        maxRetries: 5,
        retryableCodes: options.retryableCodes ?? DEFAULT_RETRYABLE,
        initialDelayMs: 500,
        maxDelayMs: 10_000,
        jitterRatio: 0.1,
      },
    signal: new AbortController().signal,
  } as unknown as RequestErrorPayload
}

interface HarnessOptions extends PayloadOptions {
  session?: object
  waitResult?: boolean
}

function buildHarness(options: HarnessOptions = {}): {
  run: (overrides?: PayloadOptions) => Promise<RequestErrorAction>
  next: ReturnType<typeof vi.fn>
  waits: number[]
  session: object
} {
  const waits: number[] = []
  const next = vi.fn(async () => undefined as RequestErrorAction)
  const session = options.session ?? {}
  const listener = createAutoRetryInterceptor(
    candidate => candidate === session ? (options.cap ?? AUTO_CAP_INITIAL) : undefined,
    async (delayMs) => {
      waits.push(delayMs)
      return options.waitResult ?? true
    },
  )
  return {
    session,
    next,
    waits,
    run: (overrides: PayloadOptions = {}) => listener(
      buildPayload({ ...options, ...overrides }, session),
      next,
    ),
  }
}

describe('foldAutoCap', () => {
  it('tracks the highest scheduled retry ordinal', () => {
    let state = foldAutoCap(AUTO_CAP_INITIAL, { type: 'llm/retry', data: { retry: 1 } } as never)
    state = foldAutoCap(state, { type: 'llm/retry', data: { retry: 2 } } as never)
    expect(state).toEqual({ retry: 2 })
    // 乱序回放不降低计数。
    state = foldAutoCap(state, { type: 'llm/retry', data: { retry: 1 } } as never)
    expect(state).toEqual({ retry: 2 })
  })

  it('resets on step/start and turn/end', () => {
    let state: AutoCapState = { retry: 2 }
    state = foldAutoCap(state, { type: 'step/start' } as never)
    expect(state).toEqual({ retry: 0 })
    state = foldAutoCap(state, { type: 'llm/retry', data: { retry: 1 } } as never)
    state = foldAutoCap(state, { type: 'turn/end', data: {} } as never)
    expect(state).toEqual({ retry: 0 })
  })

  it('returns the same reference for unrelated events', () => {
    const event = { type: 'user/message' } as never
    expect(foldAutoCap(AUTO_CAP_INITIAL, event)).toBe(AUTO_CAP_INITIAL)
  })
})

describe('createAutoRetryInterceptor', () => {
  it('retries PI_AI_ERROR once after a 2s wait, then defers', async () => {
    const harness = buildHarness()
    await expect(harness.run()).resolves.toEqual({ kind: 'retry' })
    expect(harness.next).not.toHaveBeenCalled()
    expect(harness.waits).toEqual([UNKNOWN_RETRY_DELAY_MS])

    // 同一 session 同一 turn/step 的第二次失败：放行给官方链（官方放弃）。
    await expect(harness.run()).resolves.toBeUndefined()
    expect(harness.next).toHaveBeenCalledTimes(1)
    expect(harness.waits).toEqual([UNKNOWN_RETRY_DELAY_MS])
  })

  it('retries PI_AI_ERROR again in a new turn/step', async () => {
    const harness = buildHarness()
    await expect(harness.run()).resolves.toEqual({ kind: 'retry' })
    await expect(harness.run({ step: 2 })).resolves.toEqual({ kind: 'retry' })
    await expect(harness.run({ turn: 2, step: 1 })).resolves.toEqual({ kind: 'retry' })
  })

  it('respects an official policy that already covers PI_AI_ERROR', async () => {
    const harness = buildHarness({ retryableCodes: ['PI_AI_ERROR', 'SERVER'] })
    await expect(harness.run()).resolves.toBeUndefined()
    expect(harness.next).toHaveBeenCalledTimes(1)
    expect(harness.waits).toEqual([])
  })

  it('respects mode:always without capping', async () => {
    const harness = buildHarness({ mode: 'always', cap: { retry: 4 }, code: 'SERVER' })
    await expect(harness.run()).resolves.toBeUndefined()
    expect(harness.next).toHaveBeenCalledTimes(1)
  })

  it('lets official retries through below the cap', async () => {
    await Promise.all([AUTO_CAP_INITIAL, { retry: 1 } as const].map(async cap => {
      const harness = buildHarness({ code: 'SERVER', cap })
      await expect(harness.run()).resolves.toBeUndefined()
      expect(harness.next).toHaveBeenCalledTimes(1)
    }))
  })

  it(`blocks official retries at ${String(MAX_TRANSIENT_RETRIES)} without calling next`, async () => {
    const harness = buildHarness({ code: 'SERVER', cap: { retry: MAX_TRANSIENT_RETRIES } })
    await expect(harness.run()).resolves.toBeUndefined()
    expect(harness.next).not.toHaveBeenCalled()
  })

  it('does not cap codes outside the official retryable set', async () => {
    const harness = buildHarness({ code: 'AUTH', cap: { retry: 9 } })
    await expect(harness.run()).resolves.toBeUndefined()
    expect(harness.next).toHaveBeenCalledTimes(1)
  })

  it('gives up when the pre-retry wait is cancelled', async () => {
    const harness = buildHarness({ waitResult: false })
    await expect(harness.run()).resolves.toBeUndefined()
    expect(harness.next).not.toHaveBeenCalled()
  })

  it('passes non-retryable unknown-class failures through', async () => {
    const harness = buildHarness({ code: 'INVALID_REQUEST' })
    await expect(harness.run()).resolves.toBeUndefined()
    expect(harness.next).toHaveBeenCalledTimes(1)
  })
})
