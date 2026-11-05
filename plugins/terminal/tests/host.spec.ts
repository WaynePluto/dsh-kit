/** 测试：interactive_terminal 工具契约、guidance、backend 组装与 kit 通道 dispatch。 */
/* oxlint-disable consistent-function-scoping -- 测试 helper 保持在对应 describe 内，避免共享可变测试语境。 */

import { EventEmitter } from 'node:events'
import type { Context } from '@deepseek-ai/cordis'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BAD_PAYLOAD_CODE, Config, INTERNAL_CODE, INTERACTIVE_TERMINAL_DESCRIPTION, INTERACTIVE_TERMINAL_GUIDANCE,
  INTERACTIVE_TERMINAL_TOOL_NAME, NOTES, UNKNOWN_ENDPOINT_CODE, UPSTREAM_TERMINAL_TOOL_NAMES,
  PWSH_READLINE_SETUP, TERMINAL_TYPE, applyInteractiveTerminalTools,
  backendConfig, dispatch, fullBashConfig, installStartupRetry, pwshShellArgs, resolveDialect, snapshot, toView,
} from '../src/index.js'
import { TERMINAL_TAB_ID, TERMINAL_TAB_KIND } from '../src/client/terminal-tab.js'
import { TerminalTapRegistry } from '../src/terminal-tap.js'

/** 用上游 Config schema 构造运行时配置（defaults 由 schema 填）。 */
function resolved(overrides: Record<string, unknown> = {}): Config {
  return new (Config as unknown as new (value: unknown) => Config)(overrides)
}

/** fake PTY 句柄：output 是 EventEmitter。 */
function fakeHandle() {
  const output = new EventEmitter()
  const writes: string[] = []
  const resized: [number, number][] = []
  return {
    output,
    writes,
    resized,
    pid: 1,
    done: Promise.resolve({ exitCode: null, signal: null }),
    write: async (data: string) => { writes.push(data) },
    resize: async (cols: number, rows: number) => { resized.push([cols, rows]) },
    terminate: async () => {},
  }
}

/** 构造带 fake terminals registry 的宿主 context；registry 对象被缓存，测试可替换其方法。 */
function fakeContext(options: { agent?: unknown } = {}): Context & {
  terminalList: () => { sessionId: string, type: string, status: { kind: 'running' } }[]
  killed: string[]
} {
  const sessions: { sessionId: string, type: string, status: { kind: 'running' } }[] = []
  const killed: string[] = []
  const terminals = {
    list: () => sessions,
    spawn: async () => ({ sessionId: 'pty-new', type: 'shell', status: { kind: 'running' }, motd: '' }),
    kill: async (_owner: unknown, id: string) => {
      killed.push(id)
      return sessions.some(entry => String(entry.sessionId) === id)
    },
  }
  const ctx = {
    agents: { get: (id: string) => (id === 'session-a' ? options.agent ?? { id } : undefined) },
    get(name: string) {
      return name === 'terminals' ? terminals : undefined
    },
  }
  return Object.assign(ctx, { terminalList: () => sessions, killed, terminals }) as never
}

/** 断言 ok 并取回 value；不成立时抛错给出清晰信息。 */
function okValue(result: { ok: boolean, value?: unknown, error?: { code?: string } }): unknown {
  if (!result.ok) throw new Error('expected ok result, got ' + JSON.stringify(result.error))
  return result.value
}

/** 断言失败并取回 error code。 */
function errCode(result: { ok: boolean, value?: unknown, error?: { code?: string } }): string {
  if (result.ok) throw new Error('expected failed result')
  return result.error?.code ?? ''
}

describe('interactive_terminal tool contract', () => {
  let registered: { name: string }[]
  let sectionText: string

  beforeEach(() => {
    registered = []
    sectionText = ''
    const ctx = {
      tools: { register: (tool: { name: string }) => { registered.push(tool) } },
      systemPrompt: { section: (section: { text?: string }) => { sectionText = section.text ?? '' } },
      get: () => undefined,
    } as unknown as Context
    // fake 上游：注册六个原名字具 + tool:pty section，形状满足 wrapper 捕获校验。
    const fakeUpstream = (facade: Context): void => {
      const face = facade as unknown as {
        tools: { register: (tool: Record<string, unknown>) => unknown }
        systemPrompt: { section: (section: Record<string, unknown>) => unknown }
      }
      for (const name of UPSTREAM_TERMINAL_TOOL_NAMES) {
        face.tools.register({
          name,
          description: 'upstream',
          parameters: { type: 'object' },
          output: {
            schema: { type: 'object' },
            render: () => null,
          },
          execute: async () => ({}),
        })
      }
      face.systemPrompt.section({ name: 'tool:pty', order: 0, text: 'upstream guidance' })
    }
    applyInteractiveTerminalTools(ctx, {}, fakeUpstream)
  })

  it('publishes exactly one composite tool and leaks no upstream alias', () => {
    expect(registered.map(tool => tool.name)).toStrictEqual([INTERACTIVE_TERMINAL_TOOL_NAME])
    for (const upstream of UPSTREAM_TERMINAL_TOOL_NAMES) {
      expect(registered.some(tool => tool.name === upstream)).toBe(false)
    }
  })

  it('keeps the model-facing guidance honest about boundaries', () => {
    expect(sectionText).toBe(INTERACTIVE_TERMINAL_GUIDANCE)
    expect(INTERACTIVE_TERMINAL_GUIDANCE).toContain('Use interactive_terminal for every Linux sudo command')
    expect(INTERACTIVE_TERMINAL_GUIDANCE).toContain('ordinary commands')
    expect(INTERACTIVE_TERMINAL_GUIDANCE).toContain('poll read')
    expect(INTERACTIVE_TERMINAL_GUIDANCE).toContain('Close a terminal with the')
    expect(INTERACTIVE_TERMINAL_GUIDANCE).toContain('start a fresh one when needed')
    expect(INTERACTIVE_TERMINAL_GUIDANCE).toContain('sudo -i')
  })

  it('documents that the composite tool is user-input only in its description', () => {
    expect(INTERACTIVE_TERMINAL_DESCRIPTION).toContain('direct human input')
    expect(INTERACTIVE_TERMINAL_DESCRIPTION).toContain('pwsh or bash')
  })
})

describe('backend config assembly', () => {
  it('resolves the dialect and hardens pwsh by default', () => {
    expect(resolveDialect('auto', 'win32')).toBe('pwsh')
    expect(resolveDialect('auto', 'linux')).toBe('bash')
    expect(resolveDialect('bash', 'win32')).toBe('bash')
    const partial = backendConfig(resolved())
    expect(partial.shellDialect).toBe(process.platform === 'win32' ? 'pwsh' : 'bash')
    if (partial.shellDialect === 'pwsh') {
      expect(partial.shellArgs).toContain('-NoExit')
      expect(partial.shellArgs?.join(' ')).toContain('Remove-Module PSReadLine')
    }
    expect(pwshShellArgs().join(' ')).toContain(PWSH_READLINE_SETUP)
  })

  it('assembles the full upstream defaults with a 256color terminal type', () => {
    const full = fullBashConfig(resolved())
    expect(full.backendType).toBe('shell')
    expect(full.rows).toBe(40)
    expect(full.cols).toBe(160)
    expect(full.scrollbackLines).toBe(10_000)
    expect(full.timeoutMs).toBe(300_000)
    expect(TERMINAL_TYPE).toBe('xterm-256color')
    if (full.shellDialect === 'pwsh') {
      expect(full.shellPath.toLowerCase()).toContain('pwsh')
    }
  })

  it('wraps registry.spawn with bounded startup retries', () => {
    const registry = { spawn: vi.fn() }
    const ctx = { get: (name: string) => name === 'terminals' ? registry : undefined } as unknown as Context
    const dispose = installStartupRetry(ctx, resolved({ startupAttempts: 2, startupTimeoutMs: 1000 }))
    expect(typeof registry.spawn).toBe('function')
    expect(registry.spawn).not.toBe(vi.fn())
    dispose()
  })
})

describe('kit channel dispatch', () => {
  const taps = new TerminalTapRegistry()

  it('answers list from the live agent registry', async () => {
    const ctx = fakeContext()
    const result = await dispatch(ctx as unknown as Context, 'list', { sessionId: 'session-a' }, taps, 'shell')
    expect(result.ok).toBe(true)
    expect((okValue(result) as { terminals: unknown[] }).terminals).toStrictEqual([])
  })

  it('reports no-agent for sessions without a live agent', async () => {
    const ctx = fakeContext({ agent: undefined })
    const result = await dispatch(ctx as unknown as Context, 'list', { sessionId: 'ghost' }, taps, 'shell')
    expect(result.ok).toBe(true)
    expect((okValue(result) as { unavailable?: string }).unavailable).toBe('no-agent')
  })

  it('rejects unknown endpoints and malformed payloads', async () => {
    const ctx = fakeContext()
    const unknownEndpoint = await dispatch(ctx as unknown as Context, 'send', { sessionId: 's' }, taps, 'shell')
    expect(unknownEndpoint.ok).toBe(false)
    expect(errCode(unknownEndpoint)).toBe(UNKNOWN_ENDPOINT_CODE)
    const malformed = await dispatch(ctx as unknown as Context, 'write', { sessionId: 's' }, taps, 'shell')
    expect(malformed.ok).toBe(false)
    expect(errCode(malformed)).toBe(BAD_PAYLOAD_CODE)
    const internalShape = await dispatch(ctx as unknown as Context, 'list', { sessionId: 'session-a' }, taps, 'shell')
    expect(internalShape.ok).toBe(true)
    expect(errCode({ ok: false, error: { code: INTERNAL_CODE } })).toBe(INTERNAL_CODE)
  })

  it('routes write to the tapped handle', async () => {
    const ctx = fakeContext()
    const handle = fakeHandle()
    taps.bind('pty-9', handle as never, { cols: 160, rows: 40 })
    const result = await dispatch(
      ctx as unknown as Context,
      'write',
      { sessionId: 'session-a', terminalId: 'pty-9', data: 'ls\r' },
      taps,
      'shell',
    )
    expect(result.ok).toBe(true)
    expect(handle.writes).toStrictEqual(['ls\r'])
    taps.remove('pty-9')
  })

  it('refuses write to unknown or exited terminals', async () => {
    const ctx = fakeContext()
    const handle = fakeHandle()
    const entry = taps.bind('pty-x', handle as never, { cols: 160, rows: 40 })
    entry.exited = true
    const exited = await dispatch(
      ctx as unknown as Context,
      'write',
      { sessionId: 'session-a', terminalId: 'pty-x', data: 'x' },
      taps,
      'shell',
    )
    expect(exited.ok).toBe(true)
    expect((okValue(exited) as { ok: boolean, message: string }).ok).toBe(false)
    expect((okValue(exited) as { ok: boolean, message: string }).message).toBe(NOTES.terminalExited)
    const ghost = await dispatch(
      ctx as unknown as Context,
      'write',
      { sessionId: 'session-a', terminalId: 'pty-ghost', data: 'x' },
      taps,
      'shell',
    )
    expect(ghost.ok).toBe(true)
    expect((okValue(ghost) as { ok: boolean, message: string }).ok).toBe(false)
    expect((okValue(ghost) as { ok: boolean, message: string }).message).toBe(NOTES.noTerminal)
  })

  it('routes resize to the tapped handle with grid bounds pre-validated', async () => {
    const ctx = fakeContext()
    const handle = fakeHandle()
    taps.bind('pty-r', handle as never, { cols: 160, rows: 40 })
    const result = await dispatch(
      ctx as unknown as Context,
      'resize',
      { sessionId: 'session-a', terminalId: 'pty-r', cols: 120, rows: 30 },
      taps,
      'shell',
    )
    expect(result.ok).toBe(true)
    expect(handle.resized).toStrictEqual([[120, 30]])
    taps.remove('pty-r')
  })

  it('close kills via the registry and clears the tap', async () => {
    const ctx = fakeContext()
    ctx.terminalList().push({ sessionId: 'pty-k', type: 'shell', status: { kind: 'running' } })
    const handle = fakeHandle()
    taps.bind('pty-k', handle as never, { cols: 160, rows: 40 })
    const result = await dispatch(
      ctx as unknown as Context,
      'close',
      { sessionId: 'session-a', terminalId: 'pty-k' },
      taps,
      'shell',
    )
    expect(result.ok).toBe(true)
    expect(ctx.killed).toStrictEqual(['pty-k'])
    expect(taps.entryOf('pty-k')).toBeUndefined()
  })

  it('spawn goes through the registry with the configured backend type', async () => {
    const ctx = fakeContext()
    const registry = (ctx.get('terminals') as unknown as {
      spawn: (owner: unknown, request: { type: string }, signal?: AbortSignal) => Promise<unknown>
    })
    const spawns: string[] = []
    registry.spawn = async (owner, request) => {
      spawns.push(request.type)
      return { sessionId: 'pty-new', type: request.type, status: { kind: 'running' }, motd: '' }
    }
    const result = await dispatch(ctx as unknown as Context, 'spawn', { sessionId: 'session-a' }, taps, 'shell')
    expect(result.ok).toBe(true)
    expect((okValue(result) as { id: string }).id).toBe('pty-new')
    expect(spawns).toStrictEqual(['shell'])
  })
})

describe('snapshot projection', () => {
  it('projects registry entries to wire views', () => {
    const view = toView({ sessionId: 'pty-1' as never, type: 'shell', status: { kind: 'running' } })
    expect(view).toStrictEqual({ id: 'pty-1', type: 'shell', running: true })
    const exited = toView({
      sessionId: 'pty-2' as never, type: 'shell', status: { kind: 'exited', exitCode: 2, signal: null },
    })
    expect(exited.running).toBe(false)
    expect(exited.exitCode).toBe(2)
  })

  it('reports unavailable without a service or without a live agent', () => {
    const noService = snapshot({ get: () => undefined } as unknown as Context, 's')
    expect(noService.unavailable).toBe('no-service')
    const empty = { agents: { get: () => undefined }, get: () => ({ list: () => [] }) }
    const noAgent = snapshot(empty as unknown as Context, 's')
    expect(noAgent.unavailable).toBe('no-agent')
  })
})

describe('sidebar tab identity', () => {
  it('uses a plugin-prefixed kind that cannot collide with the native terminal', () => {
    expect(TERMINAL_TAB_KIND).toBe('dsh-kit-terminal')
    expect(TERMINAL_TAB_ID).toBe('@dsh-kit/dsh-plugin-terminal')
  })
})
