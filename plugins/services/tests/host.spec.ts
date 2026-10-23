/* oxlint-disable no-await-in-loop -- 宿主进程测试逐项等待生命周期结束，避免测试进程互相抢端口和临时目录。 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { writeRegistry } from '../src/core.js'
import type { ServiceRecord } from '../src/core.js'
import { cwdOf, dispatch, gateSpawn } from '../src/index.js'
import type { Config } from '../src/index.js'
import { BAD_PAYLOAD_CODE, UNKNOWN_ENDPOINT_CODE } from '../src/shared.js'
import type { ServicesSnapshot } from '../src/shared.js'

const roots: string[] = []

/** 实现说明：此处记录相关接口、边界和生命周期约束。 */
function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-services-host-'))
  roots.push(root)
  return root
}

/** 进程与运行时契约：此处说明生命周期、身份核验、轮询或终端边界。 */
function record(root: string, over: Partial<ServiceRecord> = {}): ServiceRecord {
  return {
    name: over.name ?? 'web',
    command: 'pnpm dev',
    cwd: root,
    root,
    pid: 4242,
    startedAt: 1_000_000,
    logFile: join(root, '.agents', 'logs', `${over.name ?? 'web'}.log`),
    ...over,
  }
}

/** 实现说明：此处记录相关接口、边界和生命周期约束。 */
const ON: Config = { approvalInConfinedSandbox: true }

/** 测试契约：此处说明本测试锁定的行为和回归边界。 */
interface CtxOptions {
  /** 实现说明：此处记录相关接口、边界和生命周期约束。 */
  cwd?: string | undefined
  /** 安全与权限契约：此处说明固定权限、审批边界及异常回退。 */
  mode?: string | undefined
  /** 安全与权限契约：此处说明固定权限、审批边界及异常回退。 */
  approval?: 'allowed-once' | 'rejected' | 'unavailable' | 'cancelled' | undefined
}

/** 测试契约：此处说明本测试锁定的行为和回归边界。 */
interface Harness {
  ctx: Context
  agent: object | undefined
  request: ReturnType<typeof vi.fn>
}

/** 测试契约：此处说明本测试锁定的行为和回归边界。 */
function fakeCtx(options: CtxOptions = {}): Harness {
  const agent = options.cwd === undefined
    ? undefined
    : { session: { header: { cwd: options.cwd } } }
  const request = vi.fn(() => Promise.resolve(options.approval ?? 'allowed-once'))
  const services: Record<string, unknown> = {}
  if (options.mode !== undefined) {
    services['sandboxPolicy'] = { resolve: () => ({ mode: options.mode }) }
  }
  if (options.approval !== undefined) services['approval'] = { request }
  const ctx = {
    agents: { get: () => agent },
    get: (name: string) => services[name],
  } as unknown as Context
  return { ctx, agent, request }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('cwdOf', () => {
  it('reads the project directory off the live agent session header', () => {
    expect(cwdOf(fakeCtx({ cwd: 'C:\\p' }).ctx, 's1')).toBe('C:\\p')
  })

  it('returns undefined for a session with no live agent rather than resuming one', () => {
    expect(cwdOf(fakeCtx().ctx, 's1')).toBeUndefined()
  })
})

describe('gateSpawn — the sandbox escape gate', () => {
  it('asks nobody under danger-full-access, because bash already grants this', async () => {
    const harness = fakeCtx({ cwd: 'C:\\p', mode: 'danger-full-access', approval: 'allowed-once' })
    await expect(gateSpawn(harness.ctx, harness.agent as never, 'start', ON)).resolves.toBeUndefined()
    expect(harness.request).not.toHaveBeenCalled()
  })

  it('asks nobody when the composition mounts no sandbox at all', async () => {
    const harness = fakeCtx({ cwd: 'C:\\p' })
    await expect(gateSpawn(harness.ctx, harness.agent as never, 'start', ON)).resolves.toBeUndefined()
  })

  it('asks for approval under a confined mode and proceeds once granted', async () => {
    const harness = fakeCtx({ cwd: 'C:\\p', mode: 'workspace-write', approval: 'allowed-once' })
    await expect(gateSpawn(harness.ctx, harness.agent as never, 'start web', ON)).resolves.toBeUndefined()
    expect(harness.request).toHaveBeenCalledOnce()
    const req = harness.request.mock.calls[0]?.[0] as { reason: string; toolName: string }
    // 安全与权限契约：此处说明固定权限、审批边界及异常回退。
    expect(req.reason).toContain('沙箱之外')
    expect(req.reason).toContain('workspace-write')
    expect(req.toolName).toBe('service_start')
  })

  it('refuses when the human rejects', async () => {
    const harness = fakeCtx({ cwd: 'C:\\p', mode: 'read-only', approval: 'rejected' })
    await expect(gateSpawn(harness.ctx, harness.agent as never, 'start', ON))
      .resolves.toContain('启动被拒绝')
  })

  it('fails closed when no answerer is available', async () => {
    const harness = fakeCtx({ cwd: 'C:\\p', mode: 'read-only', approval: 'unavailable' })
    const refusal = await gateSpawn(harness.ctx, harness.agent as never, 'start', ON)
    expect(refusal).toContain('unavailable')
  })

  it('fails closed when the deployment mounts a sandbox but no approval service', async () => {
    const harness = fakeCtx({ cwd: 'C:\\p', mode: 'read-only' })
    await expect(gateSpawn(harness.ctx, harness.agent as never, 'start', ON))
      .resolves.toContain('没有装批准服务')
  })

  it('fails closed for a confined call with no owning session to ask on behalf of', async () => {
    const harness = fakeCtx({ mode: 'read-only', approval: 'allowed-once' })
    await expect(gateSpawn(harness.ctx, undefined, 'start', ON))
      .resolves.toContain('没有归属会话')
  })

  it('honours the opt-out without ever weakening danger-full-access', async () => {
    const harness = fakeCtx({ cwd: 'C:\\p', mode: 'read-only', approval: 'rejected' })
    await expect(gateSpawn(harness.ctx, harness.agent as never, 'start', { approvalInConfinedSandbox: false }))
      .resolves.toBeUndefined()
    expect(harness.request).not.toHaveBeenCalled()
  })
})

describe('dispatch — channel contract', () => {
  it('rejects an endpoint this channel does not serve', async () => {
    const home = project()
    const result = await dispatch(fakeCtx().ctx, 'start', { sessionId: 's' }, ON, home)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe(UNKNOWN_ENDPOINT_CODE)
  })

  it('rejects a payload whose session id is not a non-empty string', async () => {
    const home = project()
    for (const sessionId of [5, '', null]) {
      const result = await dispatch(fakeCtx().ctx, 'list', { sessionId }, ON, home)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe(BAD_PAYLOAD_CODE)
    }
  })

  it('answers list without a session id — the global page has no session binding', async () => {
    const home = project()
    const result = await dispatch(fakeCtx().ctx, 'list', {}, ON, home)
    expect(result.ok).toBe(true)
    if (result.ok) expect((result.value as ServicesSnapshot).cwd).toBeNull()
  })

  it('rejects a named endpoint with no service name', async () => {
    const home = project()
    const result = await dispatch(fakeCtx({ cwd: 'C:\\p' }).ctx, 'stop', { sessionId: 's' }, ON, home)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe(BAD_PAYLOAD_CODE)
  })

  it('rejects a non-positive line count instead of coercing it', async () => {
    const home = project()
    const result = await dispatch(fakeCtx({ cwd: 'C:\\p' }).ctx, 'logs', { sessionId: 's', name: 'web', lines: 0 }, ON, home)
    expect(result.ok).toBe(false)
  })

  it('answers list with the global snapshot even when the session has no live agent', async () => {
    const home = project()
    const a = project()
    // pid/startedAt 取测试进程自身：真实 identify 判定为存活（ours 或 unknown 都保留），无需注入 probe。
    writeRegistry(home, { version: 2, services: [record(a, { pid: process.pid, startedAt: Date.now() })], roots: [a] })
    const result = await dispatch(fakeCtx().ctx, 'list', { sessionId: 'no-such-session' }, ON, home)
    expect(result.ok).toBe(true)
    if (result.ok) {
      const value = result.value as ServicesSnapshot
      // 冷会话也能看到全局服务：registry 与会话无关，这正是跨工作区可见性的要点。
      expect(value.cwd).toBeNull()
      expect(value.services.map(service => service.name)).toEqual(['web'])
    }
  })

  it('answers list with every workspace, session workspace first', async () => {
    const home = project()
    const a = project()
    const b = project()
    const pid = process.pid
    const startedAt = Date.now()
    writeRegistry(home, {
      version: 2,
      services: [
        record(a, { name: 'a-web', pid, startedAt }),
        record(b, { name: 'b-api', pid, startedAt }),
      ],
      roots: [a, b],
    })
    const result = await dispatch(fakeCtx({ cwd: b }).ctx, 'list', { sessionId: 's' }, ON, home)
    expect(result.ok).toBe(true)
    if (result.ok) {
      const value = result.value as ServicesSnapshot
      expect(value.cwd).toBe(b)
      expect(value.services.map(service => service.name)).toEqual(['b-api', 'a-web'])
    }
  })

  it('serves named endpoints without a session project directory', async () => {
    const home = project()
    const result = await dispatch(fakeCtx().ctx, 'stop', { sessionId: 's', name: 'ghost' }, ON, home)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toEqual({ ok: false, message: '没有名为 ghost 的运行中服务' })
  })

  it('puts panel-driven restart behind the same sandbox gate as the tool', async () => {
    const home = project()
    const harness = fakeCtx({ cwd: project(), mode: 'read-only', approval: 'rejected' })
    const result = await dispatch(harness.ctx, 'restart', { sessionId: 's', name: 'web' }, ON, home)
    expect(result.ok).toBe(true)
    if (result.ok) expect((result.value as { message: string }).message).toContain('启动被拒绝')
    expect(harness.request).toHaveBeenCalledOnce()
  })

  it('has no start endpoint at all — creating a service stays with the gated tool', async () => {
    const home = project()
    for (const endpoint of ['start', 'create', 'spawn']) {
      const result = await dispatch(fakeCtx({ cwd: 'C:\\p' }).ctx, endpoint, { sessionId: 's', name: 'x' }, ON, home)
      expect(result.ok).toBe(false)
    }
  })
})
