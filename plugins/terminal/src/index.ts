/** Host half：装配配置、tap backend、interactive_terminal contract、RPC 与流式路由。 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { release } from 'node:os'
import { Config } from './config.js'
import { CHANNEL, STREAM_PATH, encodeStreamFrame, isStreamAttachRequest } from './shared.js'
import { interactiveTerminalContract } from './interactive-terminal-tools.js'
import { mountTerminalBackend, fullBashConfig } from './terminal-backend.js'
import { dispatch } from './terminal-rpc.js'
import { agentOf } from './terminal-runtime.js'
import { TerminalTapRegistry, subscribeTap } from './terminal-tap.js'
import { registerKitChannel } from '@dsh-kit/plugin-rpc'

/** Cordis 插件名，出现在 dsh 插件树和诊断信息中。 */
export const name = 'dsh-kit-terminal'

/** 所需 service；terminals 由本插件按需挂载，不能在 inject 中等待自己。
 * sandboxPolicy/subprocess/workingDirectory 是 TapTerminalBackend 内上游
 * BashTerminalBackend.spawn 的执行环境（围栏、argv 解析、会话目录），必须显式声明，
 * 否则属性访问报 cannot get property without inject（旧路径 ctx.plugin(terminalBash)
 * 由 terminal-bash 自己的 inject 解析，手工构造后归属本插件声明）。 */
export const inject = ['connection', 'webServer', 'agents', 'tools', 'systemPrompt', 'sandboxPolicy', 'subprocess', 'workingDirectory']

/** 共享 wire contract 的显式 re-export。 */
export {
  BAD_PAYLOAD_CODE, CHANNEL, ENDPOINTS, INTERNAL_CODE, MAX_COLS, MAX_ROWS,
  MAX_WRITE_BYTES, SELF_NAMESPACE, STREAM_PATH, UNKNOWN_ENDPOINT_CODE,
  decodeStreamFrame, encodeStreamFrame, isCloseRequest, isListRequest,
  isResizeRequest, isTerminalEndpoint, isWriteRequest,
} from './shared.js'
export type {
  Endpoint, ListRequest, SpawnRequest, StreamFrame, TerminalCloseRequest,
  TerminalOpResult, TerminalPlatform, TerminalResizeRequest, TerminalSpawnView, TerminalView,
  TerminalWriteRequest, TerminalsSnapshot, TerminalsUnavailable,
} from './shared.js'

/** Host 文案的显式 re-export。 */
export { NOTES } from './notes.js'

/** 配置 schema 与类型的显式 re-export。 */
export { Config }

/** interactive_terminal model contract 的显式 re-export。 */
export {
  INTERACTIVE_TERMINAL_ACTIONS, INTERACTIVE_TERMINAL_DESCRIPTION,
  INTERACTIVE_TERMINAL_GUIDANCE, INTERACTIVE_TERMINAL_OPEN_DESCRIPTION,
  INTERACTIVE_TERMINAL_PARAMETERS, INTERACTIVE_TERMINAL_TOOL_NAME,
  UPSTREAM_TERMINAL_TOOL_NAMES,
} from './interactive-terminal-contract.js'
export type { InteractiveTerminalAction } from './interactive-terminal-contract.js'

/** interactive_terminal wrapper 的显式 re-export。 */
export {
  SSH_KEEPALIVE_COUNT_MAX, SSH_KEEPALIVE_INTERVAL_SECONDS,
  applyInteractiveTerminalTools, interactiveTerminalTools, withSshKeepAlive,
} from './interactive-terminal-tools.js'

/** terminal backend public helper 的显式 re-export。 */
export {
  PROMPT_TAIL_MARKER, PWSH_READLINE_SETUP, TERMINAL_TYPE, TapTerminalBackend, backendConfig,
  fullBashConfig, installStartupRetry, mountTerminalBackend, pwshShellArgs, resolveDialect,
} from './terminal-backend.js'

/** tap registry 的显式 re-export。 */
export { BoundedRing, RING_MAX_BYTES, TerminalTapRegistry, subscribeTap } from './terminal-tap.js'
export type { TapEntry, TapFrame } from './terminal-tap.js'

/** RPC dispatch 的显式 re-export。 */
export { dispatch }

/** 会话快照的显式 re-export。 */
export { agentOf, snapshot, toView } from './terminal-runtime.js'

/**
 * 处理一条流式 attach：请求体 `{ sessionId, terminalId }`，响应为换行分隔的 JSON 帧
 * （ring 重放 → 实时 → exit）。官方 /api 桥对响应体做增量写入与背压；
 * 客户端断开由 request.signal 感知并即时解绑。
 * tap 按 terminalId 键控；terminalId 必须属于 sessionId 的 live agent（跨会话隔离，
 * 与 write/close 同一校验语义）。
 */
export async function serveStream(ctx: Context, request: Request, taps: TerminalTapRegistry): Promise<Response> {
  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    payload = undefined
  }
  if (!isStreamAttachRequest(payload)) {
    return Response.json(
      { ok: false, error: { code: 'terminal/bad-payload', message: 'body must be JSON { sessionId: string, terminalId: string }', details: {} } },
      { status: 400 },
    )
  }
  const { sessionId, terminalId } = payload
  // 归属校验：终端必须在请求会话的 live agent 名下（exited 但未 kill 的记录也在 list 里，可重放）。
  const owner = agentOf(ctx, sessionId)
  const listed = owner === undefined
    ? undefined
    : ctx.get('terminals')?.list(owner).find(entry => String(entry.sessionId) === terminalId)
  if (owner === undefined || listed === undefined) {
    return Response.json(
      { ok: false, error: { code: 'terminal/unknown-terminal', message: 'no such terminal in this session', details: {} } },
      { status: 404 },
    )
  }
  const entry = taps.entryOf(terminalId)
  if (entry === undefined) {
    return Response.json(
      { ok: false, error: { code: 'terminal/unknown-terminal', message: 'no such terminal in this session', details: {} } },
      { status: 404 },
    )
  }
  const encoder = new TextEncoder()
  let closed = false
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const push = (frame: Parameters<typeof encodeStreamFrame>[0]): void => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(encodeStreamFrame(frame)))
        } catch {
          closed = true
        }
      }
      // 1) size 几何帧（含平台语义与 Windows 内部版本号：客户端据此启用 xterm 的 conpty
      // 兼容档位——长行不随变窄 reflow，与 ConPTY 内部布局对齐，避免逐键回显整体错行）；
      // 2) ring 重放；3) live 标记（客户端此后才 fit + resize PTY）；
      // 4) 已退出则补 exit 帧收尾；5) 接实时帧，退出后收尾。
      push({
        t: 'size', cols: entry.size.cols, rows: entry.size.rows,
        platform: process.platform === 'win32' ? 'windows' : 'posix',
        ...(process.platform === 'win32' ? { build: windowsBuildNumber() } : {}),
      })
      const snapshot = entry.ring.snapshot()
      if (snapshot.length > 0) push({ t: 'ring', b64: bufferToBase64(snapshot) })
      if (entry.exited) {
        push({ t: 'exit', code: entry.exitCode })
        closed = true
        controller.close()
        return
      }
      const detach = subscribeTap(entry, (frame) => {
        if (frame.kind === 'data') push({ t: 'data', b64: bufferToBase64(frame.bytes) })
        else {
          push({ t: 'exit', code: frame.exitCode })
          finish()
        }
      })
      push({ t: 'live' })
      const finish = (): void => {
        if (closed) return
        closed = true
        detach()
        try {
          controller.close()
        } catch {
          /* 已被客户端取消。 */
        }
      }
      request.signal.addEventListener('abort', finish, { once: true })
    },
    cancel() {
      closed = true
    },
  })
  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson',
      'cache-control': 'no-store',
    },
  })
}

/** 字节转 base64（宿主 Node 环境）。 */
function bufferToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

/** Windows 内部版本号（`os.release()` 末段，如 19045）；xterm `windowsPty` 档位判定用。 */
export function windowsBuildNumber(): number {
  return Number.parseInt(release().split('.').at(-1) ?? '0', 10)
}

/** 挂载 backend、组合工具、RPC channel、流式路由与生命周期清理。 */
export function apply(ctx: Context, config: Config): void {
  const taps = new TerminalTapRegistry()
  if (config.mountBackend) mountTerminalBackend(ctx, config, taps)
  if (config.mountTools) {
    if (config.mountBackend) {
      interactiveTerminalContract.apply(ctx, { enableRunInBackground: false })
    } else {
      ctx.plugin(interactiveTerminalContract.plugin)
    }
  }

  const backendType = fullBashConfig(config).backendType
  const dispose = registerKitChannel(
    ctx,
    CHANNEL,
    async (endpoint, requestPayload) => await dispatch(ctx, endpoint, requestPayload, taps, backendType),
  )
  ctx.effect(() => () => void dispose(), 'terminal: channel')

  ctx.inject(['connection'], scope => {
    scope.effect(() => scope.connection.fetch.register({
      path: `/api${STREAM_PATH}`,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async request => await serveStream(ctx, request, taps),
    }), 'terminal: stream route')
  })

  ctx.effect(() => () => { taps.clear() }, 'terminal: taps')
}
