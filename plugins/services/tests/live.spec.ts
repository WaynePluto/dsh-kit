/* oxlint-disable no-await-in-loop -- live 测试按进程生命周期顺序启动和回收服务。 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { isPidAlive, readRegistry } from '../src/core.js'
import { logsOf, refresh, snapshot, startService, stopService } from '../src/manager.js'

/** 进程与运行时契约：此处说明生命周期、身份核验、轮询或终端边界。（涉及：`node -e`、`process.execPath`） */

const roots: string[] = []

/** 实现说明：此处记录相关接口、边界和生命周期约束。 */
function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-services-live-'))
  roots.push(root)
  return root
}

/** 进程与运行时契约：此处说明生命周期、身份核验、轮询或终端边界。（涉及：`&`、`sh`、`node -e`） */
function nodeCommand(snippet: string): string {
  const quoted = `"${process.execPath}" --no-warnings -e "${snippet}"`
  return process.platform === 'win32' ? `& ${quoted}` : quoted
}

/** 进程与运行时契约：此处说明生命周期、身份核验、轮询或终端边界。 */
function stayAlive(banner: string): string {
  return nodeCommand(`console.log('${banner}');setInterval(()=>{},1000)`)
}

afterEach(() => {
  // 分离进程退出与句柄释放之间有竞态：Windows 把仍存活的进程 CWD 锁到临时目录，
  // 重试也等不到。测试结论取决于断言而非清理；清不掉的目录交给系统临时目录回收。
  for (const root of roots.splice(0)) {
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    } catch {
      // 故意留空：残留目录无害，不作为测试失败。
    }
  }
})

describe('a real detached service', () => {
  it('starts, reports ready from its log, records itself, and stops on request', async () => {
    const home = project()
    const root = project()

    const started = await startService({
      home,
      name: 'probe',
      command: stayAlive('SERVICE-UP'),
      root,
      cwd: root,
      readyLog: 'SERVICE-UP',
      readyTimeoutMs: 30_000,
    })

    expect(started.ok).toBe(true)
    expect(started.outcome).toBe('ready')
    const pid = started.record?.pid
    expect(pid).toBeTypeOf('number')

    // 实现说明：此处记录相关接口、边界和生命周期约束。
    expect(isPidAlive(pid as number)).toBe(true)

    // 进程与运行时契约：此处说明生命周期、身份核验、轮询或终端边界。
    expect(existsSync(started.record?.logFile as string)).toBe(true)
    // 方案一：日志在 dsh home，项目目录不承载服务的任何状态。
    expect(started.record?.logFile).toBe(join(home, 'dsh-kit', 'logs', 'probe.log'))
    expect(existsSync(join(root, '.agents'))).toBe(false)
    const tail = logsOf(home, root, 'probe').tail
    expect(tail).toContain('SERVICE-UP')
    // Node 的 experimental warning 可能由服务启动器在用户命令之前写入同一日志；
    // 首条业务输出仍必须是服务自己的就绪标记。
    const firstServiceLine = tail.split('\n').find(line => line !== ''
      && !line.includes('[UNDICI-EHPA]') && !line.startsWith('(Use `node --trace-warnings'))
    expect(firstServiceLine).toBe('SERVICE-UP')

    // 实现说明：此处记录相关接口、边界和生命周期约束。
    expect(readRegistry(home).services.map(row => row.name)).toEqual(['probe'])
    const view = snapshot(home, { cwd: root })
    expect(view.services).toHaveLength(1)
    expect(view.services[0]?.name).toBe('probe')
    // 进程与运行时契约：此处说明生命周期、身份核验、轮询或终端边界。
    expect(view.services[0]?.identity).toBe('ours')

    const stopped = stopService(home, 'probe')
    expect(stopped.ok).toBe(true)

    // 实现说明：此处记录相关接口、边界和生命周期约束。
    for (let attempt = 0; attempt < 40 && isPidAlive(pid as number); attempt++) {
      await new Promise<void>((resolve) => { setTimeout(resolve, 100) })
    }
    expect(isPidAlive(pid as number)).toBe(false)

    // 实现说明：此处记录相关接口、边界和生命周期约束。
    expect(readRegistry(home).services).toEqual([])
    expect(snapshot(home, { cwd: root }).stoppedLogs).toEqual(['probe'])
    expect(logsOf(home, root, 'probe').running).toBe(false)
  }, 90_000)

  it('refuses a duplicate name — from any workspace — instead of starting a second copy', async () => {
    const home = project()
    const root = project()
    const other = project()
    const first = await startService({
      home, name: 'dup', command: stayAlive('UP'), root, cwd: root, readyLog: 'UP', readyTimeoutMs: 30_000,
    })
    expect(first.ok).toBe(true)
    try {
      // 名称在整台部署内唯一：另一个工作区用同名启动同样被拒绝，文案指认属主项目。
      const second = await startService({
        home, name: 'dup', command: stayAlive('UP'), root: other, cwd: other, readyTimeoutMs: 1000,
      })
      expect(second.ok).toBe(false)
      expect(second.message).toContain('已在运行')
      expect(second.message).toContain(root)
      // 进程与运行时契约：此处说明生命周期、身份核验、轮询或终端边界。
      expect(readRegistry(home).services).toHaveLength(1)
      expect(readRegistry(home).services[0]?.pid).toBe(first.record?.pid)
      expect(readRegistry(home).services[0]?.root).toBe(root)
    } finally {
      stopService(home, 'dup')
    }
  }, 90_000)

  it('is visible from another workspace and stoppable there — the cross-workspace contract', async () => {
    const home = project()
    const root = project()
    const elsewhere = project()

    const started = await startService({
      home,
      name: 'remote-cwd',
      command: stayAlive('UP'),
      root,
      cwd: elsewhere,
      readyLog: 'UP',
      readyTimeoutMs: 30_000,
    })
    try {
      expect(started.ok).toBe(true)
      expect(started.record?.root).toBe(root)
      expect(started.record?.cwd).toBe(elsewhere)
      // 方案一：日志在 home；命令目录与拥有项目都不落任何文件。
      expect(started.record?.logFile).toBe(join(home, 'dsh-kit', 'logs', 'remote-cwd.log'))
      expect(existsSync(join(root, '.agents'))).toBe(false)
      expect(existsSync(join(elsewhere, '.agents'))).toBe(false)
      // 实现说明：此处记录相关接口、边界和生命周期约束。
      expect(logsOf(home, root, 'remote-cwd').tail).toContain('UP')

      // 从第三个工作区（既不是 root 也不是 cwd）看：all 快照能看到它，且带来源；
      // project 快照只显示本工作区的服务。
      const fromThird = project()
      const global = snapshot(home, { cwd: fromThird, all: true })
      expect(global.services.map(service => service.name)).toEqual(['remote-cwd'])
      expect(global.services[0]?.root).toBe(root)
      expect(snapshot(home, { cwd: fromThird }).services).toEqual([])
      expect(snapshot(home, { cwd: root }).services.map(service => service.name)).toEqual(['remote-cwd'])

      // 停止后从第三个工作区读日志：现行日志都在 home，无需知道任何项目目录。
      expect(readRegistry(home).roots).toContain(root)
      const stopped = stopService(home, 'remote-cwd')
      expect(stopped.ok).toBe(true)
      const after = logsOf(home, fromThird, 'remote-cwd')
      expect(after.tail).toContain('UP')
      expect(after.file).toBe(join(home, 'dsh-kit', 'logs', 'remote-cwd.log'))
    } finally {
      stopService(home, 'remote-cwd')
    }
  }, 90_000)

  it('claims a legacy v1 project registry on first sight and adopts the still-running service', async () => {
    const home = project()
    const root = project()
    // 直接 spawn 一个脱离测试进程的真实服务，把它的 pid 写进 v1 项目注册表。
    const child = spawn(process.execPath, ['-e', "console.log('LEGACY-UP');setInterval(()=>{},1000)"], {
      detached: true,
      stdio: ['ignore', 'ignore', 'ignore'],
    })
    child.unref()
    const pid = child.pid as number
    try {
      expect(isPidAlive(pid)).toBe(true)
      mkdirSync(join(root, '.agents', 'logs'), { recursive: true })
      writeFileSync(join(root, '.agents', 'logs', 'legacy.log'), 'LEGACY-UP\n', 'utf8')
      writeFileSync(join(root, '.agents', 'services.json'), JSON.stringify({
        version: 1,
        services: [{
          name: 'legacy', command: 'whatever', cwd: root, pid,
          startedAt: Date.now(), logFile: join(root, '.agents', 'logs', 'legacy.log'),
        }],
      }), 'utf8')

      // 该工作区的第一次快照就完成认领：文件消失、记录并入全局、可跨工作区停止。
      const view = snapshot(home, { cwd: root, all: true })
      expect(view.services.map(service => service.name)).toEqual(['legacy'])
      expect(view.services[0]?.root).toBe(root)
      expect(existsSync(join(root, '.agents', 'services.json'))).toBe(false)

      const stopped = stopService(home, 'legacy')
      expect(stopped.ok).toBe(true)
      for (let attempt = 0; attempt < 40 && isPidAlive(pid); attempt++) {
        await new Promise<void>((resolve) => { setTimeout(resolve, 100) })
      }
      expect(isPidAlive(pid)).toBe(false)
      // 旧版服务的日志文件留在项目里（运行中的 fd 不能搬）；停止后经 roots 索引回捞仍可读。
      const after = logsOf(home, root, 'legacy')
      expect(after.tail).toContain('LEGACY-UP')
      expect(after.file).toBe(join(root, '.agents', 'logs', 'legacy.log'))
    } finally {
      if (isPidAlive(pid)) {
        if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'])
        else process.kill(-pid, 'SIGKILL')
      }
    }
  }, 90_000)

  it('survives a taskkill /T of the process that started it', async () => {
    const home = project()
    const root = project()
    const parentFile = join(root, 'parent.mts')
    const managerUrl = pathToFileURL(join(import.meta.dirname, '..', 'src', 'manager.ts')).href
    writeFileSync(parentFile, [
      `import { startService } from ${JSON.stringify(managerUrl)}`,
      `const command = ${JSON.stringify(stayAlive('UP'))}`,
      `const started = await startService({ home: ${JSON.stringify(home)}, name: 'orphan', command,`,
      `  root: ${JSON.stringify(root)}, cwd: ${JSON.stringify(root)},`,
      `  readyLog: 'UP', readyTimeoutMs: 30000 })`,
      `console.log('SERVICE_PID=' + started.record.pid)`,
      `setInterval(() => {}, 1000)`,
    ].join('\n'), 'utf8')

    // 实现说明：此处记录相关接口、边界和生命周期约束。（涉及：`tsx`、`--experimental-strip-types`）
    // 实现说明：此处记录相关接口、边界和生命周期约束。（涉及：`.js`）
    // 实现说明：此处记录相关接口、边界和生命周期约束。（涉及：`.ts`）
    // 实现说明：此处记录相关接口、边界和生命周期约束。
    const parent = spawn(process.execPath, ['--import', 'tsx', parentFile], {
      cwd: join(import.meta.dirname, '..'),
      stdio: ['ignore', 'pipe', 'inherit'],
    })
    let servicePid = 0
    try {
      servicePid = await new Promise<number>((resolve, reject) => {
        let out = ''
        const timer = setTimeout(() => { reject(new Error(`no service pid:\n${out}`)) }, 60_000)
        parent.stdout.on('data', (chunk: Buffer) => {
          out += String(chunk)
          const match = /SERVICE_PID=(\d+)/u.exec(out)
          if (match === null) return
          clearTimeout(timer)
          resolve(Number(match[1]))
        })
      })
      expect(isPidAlive(servicePid)).toBe(true)

      // 实现说明：此处记录相关接口、边界和生命周期约束。
      if (process.platform === 'win32') {
        spawnSync('taskkill', ['/pid', String(parent.pid), '/T', '/F'], { stdio: 'ignore' })
      } else {
        parent.kill('SIGKILL')
      }
      for (let attempt = 0; attempt < 30 && isPidAlive(parent.pid as number); attempt++) {
        await new Promise<void>((resolve) => { setTimeout(resolve, 100) })
      }
      expect(isPidAlive(parent.pid as number)).toBe(false)
      // 实现说明：此处记录相关接口、边界和生命周期约束。
      await new Promise<void>((resolve) => { setTimeout(resolve, 1500) })

      expect(isPidAlive(servicePid)).toBe(true)
      // 进程与运行时契约：此处说明生命周期、身份核验、轮询或终端边界。
      expect(snapshot(home, { cwd: root }).services.map(item => item.name)).toEqual(['orphan'])
    } finally {
      if (servicePid > 0) stopService(home, 'orphan')
    }
  }, 120_000)

  it('reports a command that dies immediately and leaves no phantom row', async () => {
    const home = project()
    const root = project()
    const result = await startService({
      home,
      name: 'crash',
      command: nodeCommand("console.error('BOOM');process.exit(3)"),
      root,
      cwd: root,
      readyLog: 'never-appears',
      readyTimeoutMs: 30_000,
    })

    expect(result.ok).toBe(false)
    expect(result.outcome).toBe('exited')
    expect(result.message).toContain('BOOM')
    // 实现说明：此处记录相关接口、边界和生命周期约束。
    expect(readRegistry(home).services).toEqual([])
    expect(refresh(home)).toEqual([])
    // 进程与运行时契约：此处说明生命周期、身份核验、轮询或终端边界。
    expect(logsOf(home, root, 'crash').tail).toContain('BOOM')
  }, 90_000)
})
