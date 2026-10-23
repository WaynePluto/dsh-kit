import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readRegistry, writeRegistry } from '../src/core.js'
import type { Identity, ServiceRecord } from '../src/core.js'
import { claimLegacyRegistry } from '../src/registry.js'
import { formatSnapshot, logsOf, refresh, restartService, snapshot, stopService } from '../src/manager.js'

const roots: string[] = []

/** 实现说明：此处记录相关接口、边界和生命周期约束。 */
function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-services-mgr-'))
  roots.push(root)
  return root
}

/** 进程与运行时契约：此处说明生命周期、身份核验、轮询或终端边界。 */
function record(root: string, over: Partial<ServiceRecord> = {}): ServiceRecord {
  const name = over.name ?? 'web'
  return {
    name,
    command: 'pnpm dev',
    cwd: root,
    root,
    pid: 4242,
    startedAt: 1_000_000,
    logFile: join(root, '.agents', 'logs', `${name}.log`),
    ...over,
  }
}

/** 进程与运行时契约：此处说明生命周期、身份核验、轮询或终端边界。 */
function verdicts(table: Record<string, Identity>): (row: ServiceRecord) => Identity {
  return row => table[row.name] ?? 'gone'
}

/** 进程与运行时契约：此处说明生命周期、身份核验、轮询或终端边界。 */
function log(root: string, name: string, body: string): void {
  mkdirSync(join(root, '.agents', 'logs'), { recursive: true })
  writeFileSync(join(root, '.agents', 'logs', `${name}.log`), body, 'utf8')
}

/** 现行日志位置：home 日志目录（方案一）。 */
function homeLog(home: string, name: string, body: string): void {
  mkdirSync(join(home, 'dsh-kit', 'logs'), { recursive: true })
  writeFileSync(join(home, 'dsh-kit', 'logs', `${name}.log`), body, 'utf8')
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('refresh', () => {
  it('persists the repair when the OS says a recorded service is gone', () => {
    const home = project()
    const a = project()
    writeRegistry(home, { version: 2, services: [record(a, { name: 'web' }), record(a, { name: 'dead' })], roots: [a] })
    const live = refresh(home, { identify: verdicts({ web: 'ours', dead: 'gone' }) })
    expect(live.map(entry => entry.record.name)).toEqual(['web'])
    // 实现说明：此处记录相关接口、边界和生命周期约束。
    expect(readRegistry(home).services.map(row => row.name)).toEqual(['web'])
  })

  it('leaves the file alone when nothing changed', () => {
    const home = project()
    const a = project()
    writeRegistry(home, { version: 2, services: [record(a)], roots: [a] })
    expect(refresh(home, { identify: verdicts({ web: 'ours' }) })).toHaveLength(1)
    expect(readRegistry(home).services).toHaveLength(1)
  })

  it('identifies each record exactly once — every extra ask is a child-process probe', () => {
    const home = project()
    const a = project()
    writeRegistry(home, {
      version: 2,
      services: [record(a, { name: 'web' }), record(a, { name: 'api' })],
      roots: [a],
    })
    let calls = 0
    refresh(home, { identify: row => { calls += 1; return verdicts({ web: 'ours', api: 'ours' })(row) } })
    // 曾经的实现在这里判两遍（reconcile 一遍 + 结果 map 一遍）；这是性能回归的守卫。
    expect(calls).toBe(2)
  })
})

describe('snapshot — cross-workspace visibility', () => {
  it('shows every workspace in all mode with the session workspace first', () => {
    const home = project()
    const a = project()
    const b = project()
    writeRegistry(home, {
      version: 2,
      services: [record(a, { name: 'a-web' }), record(b, { name: 'b-api' })],
      roots: [a, b],
    })
    const value = snapshot(home, { cwd: b, all: true }, { identify: verdicts({ 'a-web': 'ours', 'b-api': 'ours' }) })
    expect(value.cwd).toBe(b)
    expect(value.services.map(service => service.name)).toEqual(['b-api', 'a-web'])
    expect(value.services.map(service => service.root)).toEqual([b, a])
  })

  it('defaults to the session workspace only', () => {
    const home = project()
    const a = project()
    const b = project()
    writeRegistry(home, {
      version: 2,
      services: [record(a, { name: 'a-web' }), record(b, { name: 'b-api' })],
      roots: [a, b],
    })
    const value = snapshot(home, { cwd: b }, { identify: verdicts({ 'a-web': 'ours', 'b-api': 'ours' }) })
    expect(value.services.map(service => service.name)).toEqual(['b-api'])
  })

  it('serves a cold session (no live agent) with the global list rather than nothing', () => {
    const home = project()
    const a = project()
    writeRegistry(home, { version: 2, services: [record(a, { name: 'web', port: 5173 })], roots: [a] })
    const value = snapshot(home, { cwd: null, all: true }, { identify: verdicts({ web: 'ours' }) })
    expect(value.cwd).toBeNull()
    expect(value.services).toEqual([{
      name: 'web',
      command: 'pnpm dev',
      cwd: a,
      root: a,
      pid: 4242,
      startedAt: 1_000_000,
      logFile: join(a, '.agents', 'logs', 'web.log'),
      port: 5173,
      identity: 'ours',
    }])
  })

  it('unions stopped-log hints from the home dir and legacy project roots', () => {
    const home = project()
    const a = project()
    const b = project()
    writeRegistry(home, { version: 2, services: [record(a, { name: 'web' })], roots: [a, b] })
    homeLog(home, 'web', 'up')
    homeLog(home, 'api', 'crashed')
    // b 的日志是 D17 前留在项目里的存量，靠 roots 索引回捞。
    log(b, 'worker', 'crashed')
    const value = snapshot(home, { cwd: b, all: true }, { identify: verdicts({ web: 'ours' }) })
    expect(value.stoppedLogs).toEqual(['api', 'worker'])
  })

  it('reports an unconfirmed pid as unknown so the page can warn', () => {
    const home = project()
    const a = project()
    writeRegistry(home, { version: 2, services: [record(a)], roots: [a] })
    expect(snapshot(home, { cwd: a }, { identify: verdicts({ web: 'unknown' }) }).services[0]?.identity)
      .toBe('unknown')
  })

  it('never lists a running service in the stopped-log hint', () => {
    const home = project()
    const a = project()
    writeRegistry(home, { version: 2, services: [record(a, { name: 'web' })], roots: [a] })
    homeLog(home, 'web', 'up')
    expect(snapshot(home, { cwd: a }, { identify: verdicts({ web: 'ours' }) }).stoppedLogs).toEqual([])
  })
})

describe('stopService', () => {
  it('stops a service by globally unique name without knowing its workspace', () => {
    const home = project()
    const a = project()
    writeRegistry(home, { version: 2, services: [record(a, { name: 'web' })], roots: [a] })
    const killed: number[] = []
    const result = stopService(home, 'web', { identify: verdicts({ web: 'ours' }), kill: pid => killed.push(pid) })
    expect(result.ok).toBe(true)
    expect(killed).toEqual([4242])
    expect(readRegistry(home).services).toEqual([])
  })

  it('refuses to kill a pid it cannot confirm, and says what to run by hand', () => {
    const home = project()
    const a = project()
    writeRegistry(home, { version: 2, services: [record(a, { pid: 4242 })], roots: [a] })
    const result = stopService(home, 'web', { identify: verdicts({ web: 'unknown' }) })
    expect(result.ok).toBe(false)
    expect(result.message).toContain('4242')
    expect(result.message).toMatch(/taskkill|kill --/u)
    // 进程与运行时契约：此处说明生命周期、身份核验、轮询或终端边界。
    expect(readRegistry(home).services).toHaveLength(1)
  })

  it('reports a name that is not running rather than pretending to stop it', () => {
    const home = project()
    expect(stopService(home, 'nope', { identify: verdicts({}) }))
      .toEqual({ ok: false, message: '没有名为 nope 的运行中服务' })
  })
})

describe('restartService', () => {
  it('aborts when the stop was refused, rather than starting a second copy', async () => {
    const home = project()
    const a = project()
    writeRegistry(home, { version: 2, services: [record(a)], roots: [a] })
    const result = await restartService(home, 'web', undefined, { identify: verdicts({ web: 'unknown' }) })
    expect(result.ok).toBe(false)
    expect(result.message).toContain('重启中止')
    // 实现说明：此处记录相关接口、边界和生命周期约束。
    expect(readRegistry(home).services).toHaveLength(1)
  })

  it('reports a name that is not running', async () => {
    const home = project()
    const result = await restartService(home, 'nope', undefined, { identify: verdicts({}) })
    expect(result).toEqual({ ok: false, message: '没有名为 nope 的运行中服务' })
  })
})

describe('logsOf', () => {
  it('finds a stopped service log in the home dir from any workspace', () => {
    const home = project()
    const b = project()
    writeRegistry(home, { version: 2, services: [], roots: [] })
    homeLog(home, 'api', 'line1\nboom\n')
    // 从工作区 B 读取：现行日志都在 home，与会话目录无关。
    const result = logsOf(home, b, 'api', 40, { identify: verdicts({}) })
    expect(result.running).toBe(false)
    expect(result.tail).toBe('line1\nboom')
    expect(result.file).toBe(join(home, 'dsh-kit', 'logs', 'api.log'))
  })

  it('still reaches a legacy project log through the roots index', () => {
    const home = project()
    const a = project()
    const b = project()
    writeRegistry(home, { version: 2, services: [], roots: [a] })
    log(a, 'api', 'line1\nboom\n')
    // home 没有该名字的日志时，按「会话目录 → roots」回捞项目内旧文件。
    const result = logsOf(home, b, 'api', 40, { identify: verdicts({}) })
    expect(result.running).toBe(false)
    expect(result.tail).toBe('line1\nboom')
    expect(result.file).toBe(join(a, '.agents', 'logs', 'api.log'))
  })

  it('prefers the home log over a legacy project log of the same name', () => {
    const home = project()
    const legacy = project()
    writeRegistry(home, { version: 2, services: [], roots: [legacy] })
    homeLog(home, 'api', 'from-home')
    log(legacy, 'api', 'from-legacy')
    expect(logsOf(home, legacy, 'api', 40, { identify: verdicts({}) }).tail).toBe('from-home')
  })

  it('prefers the session workspace when only legacy logs exist in several projects', () => {
    const home = project()
    const a = project()
    const b = project()
    writeRegistry(home, { version: 2, services: [], roots: [a] })
    log(a, 'api', 'from-a')
    log(b, 'api', 'from-b')
    expect(logsOf(home, b, 'api', 40, { identify: verdicts({}) }).tail).toBe('from-b')
  })

  it('returns an empty tail and the canonical home path when there is no log at all', () => {
    const home = project()
    const result = logsOf(home, null, 'ghost', 10, { identify: verdicts({}) })
    expect(result.tail).toBe('')
    expect(result.file).toBe(join(home, 'dsh-kit', 'logs', 'ghost.log'))
  })

  it('clamps an absurd line count instead of shipping a whole file', () => {
    const home = project()
    homeLog(home, 'api', Array.from({ length: 2000 }, (_, i) => `l${String(i)}`).join('\n'))
    const result = logsOf(home, null, 'api', 10_000, { identify: verdicts({}) })
    expect(result.tail.split('\n')).toHaveLength(500)
  })

  it('reads a running service log without reconciling the registry', () => {
    const home = project()
    const a = project()
    // pid 已死：读日志只做 signal 0 存活检查，不做全量对账——
    // 失效记录原样留在注册表里（由下一次 snapshot 清理），running 如实报告 false。
    writeRegistry(home, {
      version: 2,
      services: [record(a, { name: 'web', pid: 4_242_424, logFile: join(home, 'dsh-kit', 'logs', 'web.log') })],
      roots: [a],
    })
    homeLog(home, 'web', 'last line')
    const result = logsOf(home, null, 'web')
    expect(result.running).toBe(false)
    expect(result.tail).toBe('last line')
    expect(readRegistry(home).services.map(row => row.name)).toEqual(['web'])
  })

  it('reports running for a recorded service whose pid is still alive', () => {
    const home = project()
    const a = project()
    writeRegistry(home, {
      version: 2,
      services: [record(a, { name: 'web', pid: process.pid, logFile: join(home, 'dsh-kit', 'logs', 'web.log') })],
      roots: [a],
    })
    homeLog(home, 'web', 'alive line')
    expect(logsOf(home, null, 'web').running).toBe(true)
  })
})

describe('claimLegacyRegistry', () => {
  it('merges a v1 project registry into the global one once, then deletes the file', () => {
    const home = project()
    const a = project()
    writeRegistry(home, { version: 2, services: [], roots: [] })
    // v1 记录没有 root 字段。
    mkdirSync(join(a, '.agents'), { recursive: true })
    writeFileSync(join(a, '.agents', 'services.json'), JSON.stringify({
      version: 1,
      services: [{ name: 'legacy', command: 'pnpm dev', cwd: a, pid: 111, startedAt: 500, logFile: join(a, '.agents', 'logs', 'legacy.log') }],
    }), 'utf8')

    claimLegacyRegistry(a, home)
    const merged = readRegistry(home)
    expect(merged.services).toHaveLength(1)
    expect(merged.services[0]?.root).toBe(a)
    expect(merged.roots).toContain(a)
    expect(existsSync(join(a, '.agents', 'services.json'))).toBe(false)

    // 文件已删，之后的调用是纯 no-op：全局里的既有记录不被重放覆盖。
    claimLegacyRegistry(a, home)
    expect(readRegistry(home).services.map(row => row.name)).toEqual(['legacy'])
    expect(readRegistry(home).roots).toEqual([a])
  })

  it('skips names the global registry already owns', () => {
    const home = project()
    const a = project()
    writeRegistry(home, {
      version: 2,
      services: [record(a, { name: 'web', pid: 999 })],
      roots: [],
    })
    mkdirSync(join(a, '.agents'), { recursive: true })
    writeFileSync(join(a, '.agents', 'services.json'), JSON.stringify({
      version: 1,
      services: [{ name: 'web', command: 'old', cwd: a, pid: 111, startedAt: 500, logFile: 'old.log' }],
    }), 'utf8')

    claimLegacyRegistry(a, home)
    const merged = readRegistry(home)
    expect(merged.services).toHaveLength(1)
    expect(merged.services[0]?.pid).toBe(999)
  })

  it('is a no-op for a workspace that never had a legacy registry', () => {
    const home = project()
    const a = project()
    claimLegacyRegistry(a, home)
    expect(readRegistry(home).services).toEqual([])
    expect(readRegistry(home).roots).toEqual([])
  })

  it('is reached through snapshot, so a plain panel poll migrates a workspace', () => {
    const home = project()
    const a = project()
    mkdirSync(join(a, '.agents'), { recursive: true })
    writeFileSync(join(a, '.agents', 'services.json'), JSON.stringify({
      version: 1,
      services: [{ name: 'legacy', command: 'pnpm dev', cwd: a, pid: 111, startedAt: 500, logFile: join(a, '.agents', 'logs', 'legacy.log') }],
    }), 'utf8')
    // snapshot 从 a 发起；legacy 记录对 identify 是 gone（pid 111 不存在），对账后清理，
    // 但「认领」本身已经发生：roots 索引记录了 a，项目内的旧版已停止日志仍可经它发现。
    log(a, 'legacy', 'tail\n')
    const value = snapshot(home, { cwd: a, all: true }, { identify: verdicts({}) })
    expect(value.services).toEqual([])
    expect(value.stoppedLogs).toEqual(['legacy'])
    expect(readRegistry(home).roots).toEqual([a])
  })
})

describe('formatSnapshot', () => {
  it('says plainly when nothing runs, and still names readable logs', () => {
    expect(formatSnapshot({ cwd: 'C:\\p', services: [], stoppedLogs: ['api'], now: 0 }))
      .toBe('没有正在运行的服务\n已停止但日志可读：api')
  })

  it('lists each service with its port, pid, command and log path', () => {
    const text = formatSnapshot({
      cwd: 'C:\\p',
      services: [{
        name: 'web', command: 'pnpm dev', cwd: 'C:\\p', root: 'C:\\p', pid: 7, startedAt: 0,
        logFile: 'C:\\p\\.agents\\logs\\web.log', port: 5173, identity: 'ours',
      }],
      stoppedLogs: [],
      now: 0,
    })
    expect(text).toContain('运行中 1 个服务')
    expect(text).toContain(':5173')
    expect(text).toContain('pid 7')
    expect(text).toContain('pnpm dev')
    expect(text).toContain('web.log')
  })

  it('labels services that belong to another workspace with their project', () => {
    const text = formatSnapshot({
      cwd: 'C:\\mine',
      services: [{
        name: 'web', command: 'pnpm dev', cwd: 'C:\\other', root: 'C:\\other', pid: 7, startedAt: 0,
        logFile: 'x', identity: 'ours',
      }],
      stoppedLogs: [],
      now: 0,
    })
    expect(text).toContain('项目 C:\\other')
  })

  it('marks an unconfirmed pid in the model-facing report too', () => {
    const text = formatSnapshot({
      cwd: 'C:\\p',
      services: [{
        name: 'web', command: 'pnpm dev', cwd: 'C:\\p', root: 'C:\\p', pid: 7, startedAt: 0,
        logFile: 'x', identity: 'unknown',
      }],
      stoppedLogs: [],
      now: 0,
    })
    expect(text).toContain('身份待确认')
  })
})
