/* oxlint-disable no-await-in-loop -- terminal 启动重试必须串行等待上一次失败和退避。 */
import type { Context } from '@deepseek-ai/cordis'
import TerminalSessionService from '@deepseek-ai/dsh-terminal'
import type {
  TerminalBackend, TerminalBackendSession, TerminalBackendSpawnSpec,
} from '@deepseek-ai/dsh-terminal'
import { BashTerminalBackend } from '@deepseek-ai/dsh-terminal-bash'
import { resolvePwshPath } from '@deepseek-ai/dsh-pwsh-local'
import type { SubprocessTerminalSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import type { Config } from './config.js'
import type { TerminalTapRegistry } from './terminal-tap.js'

/** 启动失败重试之间的间隔。 */
const STARTUP_RETRY_DELAY_MS = 1500

/** pwsh 启动时移除 PSReadLine，避免重绘破坏 terminal-bash 的就绪探测。 */
export const PWSH_READLINE_SETUP = 'Remove-Module PSReadLine -Force -ErrorAction SilentlyContinue'

/** 传给交互式 pwsh backend 的稳定启动参数。 */
export function pwshShellArgs(): string[] {
  return ['-NoLogo', '-NoProfile', '-NoExit', '-Command', PWSH_READLINE_SETUP]
}

/** 给每次 terminal_open 提供独立的启动超时与重试。 */
export function installStartupRetry(
  ctx: Context,
  config: Config,
  sleep: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms)),
): () => void {
  const terminals = ctx.get('terminals')
  if (terminals === undefined) return () => {}
  const registry = terminals as unknown as {
    spawn: (owner: unknown, request: unknown, signal?: AbortSignal) => Promise<unknown>
  }
  const original = registry.spawn
  const invoke = original.bind(registry)
  const attempts = Math.max(1, config.startupAttempts)
  registry.spawn = async (owner, request, signal) => {
    let failure: unknown
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      signal?.throwIfAborted()
      const deadline = AbortSignal.timeout(config.startupTimeoutMs)
      const combined = signal === undefined ? deadline : AbortSignal.any([signal, deadline])
      try {
        return await invoke(owner, request, combined)
      } catch (error: unknown) {
        if (signal?.aborted === true) throw error
        failure = error
        if (attempt < attempts) await sleep(STARTUP_RETRY_DELAY_MS)
      }
    }
    throw failure
  }
  return () => { registry.spawn = original }
}

/** 解析 terminal-bash 使用的具体 shell dialect。 */
export function resolveDialect(
  configured: Config['shellDialect'],
  platform: string = process.platform,
): 'bash' | 'pwsh' {
  if (configured !== 'auto') return configured
  return platform === 'win32' ? 'pwsh' : 'bash'
}

/** 组合传给 terminal-bash 的 backend 配置，保留 bash 上游默认 argv。 */
export function backendConfig(
  config: Config,
  platform: string = process.platform,
): { shellDialect: 'bash' | 'pwsh', timeoutMs: number, shellArgs?: string[] } {
  const shellDialect = resolveDialect(config.shellDialect, platform)
  const explicit = config.shellArgs.length > 0
  const harden = !explicit && shellDialect === 'pwsh' && config.hardenPwshReadLine
  return {
    shellDialect,
    timeoutMs: config.timeoutMs,
    ...explicit ? { shellArgs: config.shellArgs } : harden ? { shellArgs: pwshShellArgs() } : {},
  }
}

/** PTY 向子进程宣告的终端类型；`xterm-256color` 让程序输出 ANSI 彩色（`dumb` 会关闭）。 */
export const TERMINAL_TYPE = 'xterm-256color'

/**
 * 上游受控提示符（terminal-bash `sanitize.ts` 的 `CONTROLLED_PROMPT`，包入口不导出，
 * dsh-upgrade 复核）。spawn 就绪后 tap ring 裁到它最后一次出现处：pwsh 方言的编码
 * preamble / prompt 安装命令回显（用户手开终端满屏初始化命令）不进重放画面；bash
 * 方言提示符由环境安装，ring 本就只有提示符，裁剪幂等。
 */
export const PROMPT_TAIL_MARKER = new TextEncoder().encode('dsh> ')

/** `BashTerminalBackend` 构造参数第二项的类型（包入口未导出该类型别名，从构造签名推导）。 */
type ResolvedBashConfig = ConstructorParameters<typeof BashTerminalBackend>[1]

/**
 * 显式组装 terminal-bash 的完整 backend 配置（与 `@deepseek-ai/dsh-terminal-bash`
 * 的 `Config` z-schema 默认值一字不差）。手工构造 backend 不经过 cordis 的 schema
 * 解析，而包入口不导出 `resolveConfig`/`validateConfig`（发布物只有主入口），
 * 因此默认层在这里负责；shellPath 沿用上游同源解析（pwsh 走 `resolvePwshPath`）。
 * 上游默认值变化由 dsh-upgrade 复核。
 */
export function fullBashConfig(config: Config, platform: string = process.platform): ResolvedBashConfig {
  const partial = backendConfig(config, platform)
  const shellPath = partial.shellDialect === 'pwsh' ? resolvePwshPath() : '/bin/bash'
  const shellArgs = partial.shellArgs
    ?? (partial.shellDialect === 'pwsh' ? ['-NoLogo', '-NoProfile'] : ['--noprofile', '--norc', '-i'])
  const resolved: ResolvedBashConfig = {
    backendType: 'shell',
    shellDialect: partial.shellDialect,
    shellPath,
    shellArgs,
    rows: 40,
    cols: 160,
    scrollbackLines: 10_000,
    scrollbackMaxBytes: 4 * 1024 * 1024,
    maxReadBytes: 256 * 1024,
    pollIntervalMs: 50,
    exactProbeAfterMs: 150,
    idleSilenceMs: 3_000,
    handoffGraceMs: 500,
    promptTailGraceMs: 0,
    timeoutMs: partial.timeoutMs,
    disposeGraceMs: 3_000,
  }
  return resolved
}

/**
 * 带 tap 的 shell backend：spawn 路径、沙箱围栏、就绪探测、read 分页全部是上游
 * `BashTerminalBackend` 原版，只在 `spawnTerminal` 注入点拦截——把 `terminalType`
 * 改写为 `xterm-256color` 并把句柄登记进 tap registry（挂第二个 `output` listener，
 * 不改变上游 session 的消费）。每次 spawn 用独立闭包捕获句柄，天然并发安全；
 * `spec.sessionId` 由 registry 先铸好传入，tap 由此与 session 精确配对。
 */
export class TapTerminalBackend implements TerminalBackend {
  readonly type: string

  constructor(
    private readonly ctx: Context,
    private readonly resolved: ResolvedBashConfig,
    private readonly taps: TerminalTapRegistry,
  ) {
    this.type = resolved.backendType
  }

  async spawn(spec: TerminalBackendSpawnSpec): Promise<TerminalBackendSession> {
    // tap 必须在句柄返回时立即登记（闭包持有外层 spec 的 sessionId）：pwsh 横幅/提示符在
    // 后续就绪探测等待期间输出，若等 inner.spawn（含 startupSession）完成再挂 listener，
    // 启动期输出全部丢失，guide 入口新开的终端会一片空白。
    const inner = new BashTerminalBackend(this.ctx, this.resolved as never, async (innerSpec: SubprocessTerminalSpawnSpec) => {
      // 上游给 pwsh 方言的子环境写死 NO_COLOR=1（渲染安静），bash 方言没有——删掉它恢复
      // ANSI 彩色（parity）：TERM 由 subprocess-local 用 terminalType 强制覆盖，无需改。
      const env = innerSpec.env === undefined
        ? undefined
        : Object.fromEntries(Object.entries(innerSpec.env).filter(([key]) => key !== 'NO_COLOR'))
      const handle = await this.ctx.subprocess.spawnTerminal({ ...innerSpec, env, terminalType: TERMINAL_TYPE })
      this.taps.bind(String(spec.sessionId), handle, { cols: innerSpec.cols, rows: innerSpec.rows })
      return handle
    })
    const session = await inner.spawn(spec)
    // Windows：ConPTY 的逐键回显是绝对定位（\e[r;cH，DSR 应答同样基于它的内部缓冲），
    // 浏览器重放必须与该缓冲逐行对齐，否则输入行画错位/重复。启动噪声（编码 preamble +
    // prompt 安装命令的回显）占据 ConPTY 缓冲前几行——经会话 send 一条 Clear-Host 清掉，
    // 提示符回到第 1 行，再 trim ring 到最后一个受控提示符：两边同步且画面干净。
    // 实测 ConPTY 对 resize 不重绘（字节捕获验证），「重放裁剪 + 事后清屏」没有别的路。
    // POSIX bash 的回显是行内式，无此问题，trim 即可。
    if (this.resolved.shellDialect === 'pwsh') {
      const clear = session.startSend({ text: 'Clear-Host', submit: true })
      await clear.done
    }
    // 就绪探测通过（提示符已印出）后裁剪重放缓冲：启动期回显留在 ring 外，
    // 手开/guide 入口的终端画面只剩一个干净的受控提示符；启动失败走 throw，不裁剪。
    this.taps.markReady(String(spec.sessionId), PROMPT_TAIL_MARKER)
    return session
  }
}

/** 挂载 dsh PTY registry、tap 包装的 shell backend 与启动补偿。 */
export function mountTerminalBackend(ctx: Context, config: Config, taps: TerminalTapRegistry): void {
  // oxlint-disable-next-line no-new -- 构造函数通过 ctx 注册 terminal service，实例本身不需要保留。
  new TerminalSessionService(ctx)
  // backend 注册必须等 terminals service 就绪（ctx.get 在服务 fiber 未起时返回 undefined，
  // 曾致桌面端 "no PTY backend registered for shell"——ctx.inject 保证时序）；backend 实例
  // 仍绑宿主根 ctx（inject 的派生 scope 只声明了 terminals，没有 sandboxPolicy 等执行环境）。
  ctx.inject(['terminals'], scope => {
    scope.effect(() => scope.terminals.registerBackend(new TapTerminalBackend(ctx, fullBashConfig(config), taps)), 'terminal: tap backend')
  })
  ctx.inject(['terminals'], scope => {
    scope.effect(() => installStartupRetry(scope, config), 'terminal: startup retry')
  })
}
