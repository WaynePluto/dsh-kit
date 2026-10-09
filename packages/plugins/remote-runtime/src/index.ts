// relay/connector 的宿主内托管：dsh 由官方应用启动后，本插件负责
// 1) 把本进程的 dsh 登录令牌写入 <home>/dsh-token（relay 首访重定向读取）；
// 2) 以两级分离启动器拉起 relay 与 connector（L1 即退，L2 常驻并脱离
//    taskkill /T 的树枚举；spike 在官方桌面 0.2.0-rc.2 实测验证）；
// 3) 宿主重启后按 pid 注册表认领仍存活的子进程，不重复拉起；
// 4) 插件正常卸载时优雅停止两个子进程；宿主崩溃则保留现场等待认领。
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import {
  defaultMachineSlug,
  defaultStationHome,
  ensureJwtSecret,
  isProcessAlive,
  processRecordPath,
  readProcessRecord,
  readStationConfig,
  tokenFromAuthenticatedUrl,
  writeTokenFile,
  type ProcessRecord,
} from './shared.js'

interface MinimalContext {
  readonly connection?: { authenticatedUrl(baseUrl: string): string }
  readonly webServer?: { readonly port?: number }
  on(event: 'dispose', listener: () => void): void
  logger?: { warn(message: string): void } & Record<string, unknown>
}

export const inject = ['connection', 'webServer']

// L1：立即退出的跳板。它以 detached 方式拉起真正的 L2、写 pid 注册表后退出，
// 使 L2 的父进程已死、不在任何 taskkill /T 的存活子树枚举里。
// 通过 node -e 内联分发，避免携带额外产物文件。
const L1_PROGRAM = [
  "const {spawn}=require('node:child_process')",
  "const {writeFileSync,mkdirSync,openSync}=require('node:fs')",
  "const {dirname}=require('node:path')",
  // node -e 模式下附加参数从 argv[1] 开始（无 '[eval]' 占位）。
  "const argv=process.argv.slice(1)",
  "const marker=argv.indexOf('--record')",
  "const logMarker=argv.indexOf('--log')",
  "if(marker<1)process.exit(2)",
  "const cmd=argv[0]",
  // 子进程参数严格位于 cmd 与 --record 之间；--record/--log 是 L1 自己的标记。
  "const args=argv.slice(1,marker)",
  "const record=argv[marker+1]",
  // 常驻子进程的 stdout/stderr 必须落到日志文件：detached + stdio ignore 下
  // pino 的同步写会让进程直接退出（实测），且 relay 日志本就需要可查。
  "const logPath=logMarker===-1?null:argv[logMarker+1]",
  "let stdio='ignore'",
  "if(logPath){mkdirSync(dirname(logPath),{recursive:true});const fd=openSync(logPath,'a');stdio=['ignore',fd,fd]}",
  // 脚本文件不可直接 spawn：以本进程的可执行文件（node 或 ELECTRON_RUN_AS_NODE 下的
  // 宿主二进制）运行目标 CLI。
  "const child=spawn(process.execPath,[cmd,...args],{detached:true,stdio,env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}})",
  "if(typeof child.pid!=='number')process.exit(3)",
  "child.unref()",
  "mkdirSync(dirname(record),{recursive:true})",
  "writeFileSync(record,JSON.stringify({pid:child.pid,startedAtMs:Date.now()})+'\\n')",
].join(';')

function resolveWorkspaceCli(packageName: 'relay' | 'connector'): string {
  const require = createRequire(import.meta.url)
  const manifest = require.resolve(`${packageName === 'relay' ? '@dsh-station/relay' : '@dsh-station/connector'}/package.json`)
  return join(dirname(manifest), 'dist', 'cli.js')
}

function relayArguments(cli: string, home: string): string[] {
  const config = readStationConfig(home)
  const slug = defaultMachineSlug()
  return [
    cli, 'serve',
    '--host', config.domain === undefined ? '0.0.0.0' : '127.0.0.1',
    '--port', String(config.relayPort),
    '--direct-slug', slug,
    ...config.domain === undefined
      ? ['--scheme', 'http', '--lan-http']
      : ['--domain', config.domain, '--scheme', 'https'],
    '--data', join(home, 'relay.db'),
    '--home', home,
  ]
}

function connectorArguments(cli: string, home: string, dshPort: number): string[] {
  return [cli, '--home', home, '--dsh-port', String(dshPort)]
}

function ensureProcess(name: ProcessRecord['name'], cli: string, args: readonly string[], home: string): void {
  const existing = readProcessRecord(home, name)
  if (existing !== undefined && isProcessAlive(existing.pid)) return
  const l1 = spawn(process.execPath, [
    '-e', L1_PROGRAM, cli, ...args,
    '--record', processRecordPath(home, name),
    '--log', join(home, 'logs', `${name}.log`),
  ], {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      DSH_STATION_JWT_SECRET: ensureJwtSecret(home),
    },
  })
  l1.unref()
}

function stopProcessTree(pid: number): void {
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    killer.unref()
  } else {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      // 已退出。
    }
  }
}

export function apply(ctx: MinimalContext): void {
  const home = defaultStationHome()
  const dshPort = ctx.webServer?.port
  if (ctx.connection !== undefined) {
    const token = tokenFromAuthenticatedUrl(ctx.connection.authenticatedUrl(`http://127.0.0.1:${String(dshPort ?? 0)}/`))
    if (token !== undefined) writeTokenFile(home, token)
  }
  const relayCli = resolveWorkspaceCli('relay')
  ensureProcess('relay', relayCli, relayArguments(relayCli, home).slice(1), home)
  if (dshPort !== undefined) {
    const connectorCli = resolveWorkspaceCli('connector')
    ensureProcess('connector', connectorCli, connectorArguments(connectorCli, home, dshPort).slice(1), home)
  }
  ctx.on('dispose', () => {
    for (const name of ['relay', 'connector'] as const) {
      const record = readProcessRecord(home, name)
      if (record !== undefined && isProcessAlive(record.pid)) stopProcessTree(record.pid)
    }
  })
}
