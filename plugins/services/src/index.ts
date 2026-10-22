/**
 * dsh-kit services 插件：管理可活过 turn、session 和 dsh 的 dev server、backend、watcher，并在 composer 上方提供可折叠 panel。
 * registry 以 `$DSH_HOME` 为作用域，整台部署（同一用户、同一 home）的所有工作区共享：
 * 任何会话的 panel 都能看到全部存活服务，stop/restart/logs 按全局唯一名称跨工作区寻址。
 * Host 半使用磁盘 registry、OS liveness/identity probe 和显式 sandbox approval；browser 半通过 shared RPC channel 读取和操作。
 * 服务 spawn 位于本模块的安全 gate 之后；所有入口最终复用 `manager` 的实现。
 *
 * @module @dsh-kit/dsh-plugin-services
 */

import type { Context } from '@deepseek-ai/cordis'
import zs from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ParameterPropertySpec } from '@deepseek-ai/dsh-tools'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
// 仅类型：激活本插件读取的 Context service merge。插件之间禁止 value import，service 是协作接缝。
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { ConnectionRpcResult } from '@deepseek-ai/dsh-client-connection'
import { formatSnapshot, logsOf, restartService, snapshot, startService, stopService } from './manager.js'
import {
  BAD_PAYLOAD_CODE, CHANNEL, DEFAULT_LOG_LINES, INTERNAL_CODE, MAX_LOG_LINES,
  UNKNOWN_ENDPOINT_CODE, isListRequest, isNamedRequest, isServicesEndpoint,
} from './shared.js'
import { registerKitChannel } from '@dsh-kit/plugin-rpc'

export * from './shared.js'
export {
  DEFAULT_READY_TIMEOUT_MS, MAX_READY_TIMEOUT_MS, formatSnapshot, logsOf,
  refresh, restartService, snapshot, startService, stopService,
} from './manager.js'
export type { ServiceRecord } from './core.js'

/** Cordis 插件名，出现在 dsh 插件树和诊断信息中。 */
export const name = 'dsh-kit-services'

/**
 * 所需 service。`tools` 注册五个工具，`connection` 提供 panel channel，`agents` 按 session id 找到带项目 cwd 的 live agent；sandbox/approval 按调用时可选读取，以兼容没有该 gate 的 composition。
 */
export const inject = ['tools', 'connection', 'webServer', 'agents']

/** 本插件的配置。 */
export interface Config {
  /**
   * 受限 session 启动服务前是否必须取得人工批准。关闭是有意承担风险的 unattended 部署选项，不会改变 `danger-full-access` 无需批准的行为。
   */
  approvalInConfinedSandbox: boolean
}

/** {@link Config} 的 runtime schema；schemastery 3.18 起常量不再显式注解 `zs<Config>`，类型由上方 interface 单独声明。 */
export const Config = zs.object({
  approvalInConfinedSandbox: zs.boolean().default(true),
})

/**
 * 解析 session 服务所属的项目目录。读取 `session.header.cwd` 而不是 `meta`；没有 live agent 时返回 undefined。
 * 冷 session 仍能看到全局服务（registry 与会话无关），只是日志发现少了会话目录这个优先候选。
 * @param ctx - Host plugin context。
 * @param sessionId - 要解析的 session。
 * @returns 项目目录；没有时返回 undefined。
 */
export function cwdOf(ctx: Context, sessionId: string): string | undefined {
  return ctx.agents.get(sessionId as SessionId)?.session.header.cwd
}

/**
 * 判断 agent 是否可以 spawn 一个绕过 sandbox、且活过 session 的进程。受限模式需要通过 `ctx.approval` 请求人工批准；拒绝以句子返回而非抛错，便于 tool 和 RPC 使用调用方自己的文案。
 * 跨工作区操作同一 gate 不变：门控读的是**调用方**会话的沙箱模式，受限会话在任何工作区发起 start/restart 都要自己的批准。
 * @param ctx - Host plugin context。
 * @param agent - 代表服务启动方的 agent。
 * @param what - approval prompt 的动作描述。
 * @param config - 解析后的插件配置。
 * @returns 拒绝句子；允许时为 undefined。
 */
export async function gateSpawn(
  ctx: Context,
  agent: Agent | undefined,
  what: string,
  config: Config,
): Promise<string | undefined> {
  if (!config.approvalInConfinedSandbox) return undefined
  const sandboxPolicy = ctx.get('sandboxPolicy')
  // composition 没有 sandbox，表示没有可被绕过的限制。
  if (sandboxPolicy === undefined) return undefined
  const mode = sandboxPolicy.resolve(agent === undefined ? {} : { session: agent.session }).mode
  if (mode === 'danger-full-access') return undefined

  // 处于受限模式，spawn 会越过 sandbox，必须人工批准。没有 agent 就没有可代表请求的 session；没有 approval service 就无人可问，两者都 fail closed。
  if (agent === undefined) {
    return `当前沙箱模式是 ${mode}，启动常驻服务会绕过沙箱，需要人工批准；但这次调用没有归属会话，无法征求批准。`
  }
  const approval = ctx.get('approval')
  if (approval === undefined) {
    return `当前沙箱模式是 ${mode}，启动常驻服务会绕过沙箱，需要人工批准；但这个部署没有装批准服务。`
  }
  const outcome = await approval.request({
    agent,
    toolName: 'service_start',
    reason: `${what}。常驻服务在沙箱之外直接启动，并且会活过这一轮、这个会话，以及 dsh 本身`
      + `（当前沙箱模式：${mode}）。`,
  })
  // 只有 `allowed-once` 是授权；`unavailable` 是文档规定的 fail-closed 值，`rejected` 是 `never` policy 返回的结果。
  if (outcome === 'allowed-once') return undefined
  return outcome === 'rejected'
    ? `启动被拒绝：当前沙箱模式是 ${mode}，常驻服务会绕过沙箱，需要人工批准。`
    : `启动未获批准（${outcome}）：当前沙箱模式是 ${mode}，常驻服务会绕过沙箱，需要人工批准。`
}

/**
 * 解析 tool call 操作所用的项目目录。
 * @param exec - tool execution。
 * @returns 项目目录；没有 session 时返回 undefined。
 */
function toolCwd(exec: { agent?: Agent }): string | undefined {
  return exec.agent?.session.header.cwd
}

/** `service_start` / `service_list` 没有项目目录可归属时返回的句子：日志与项目过滤都需要它。 */
const NO_CWD = '这次调用没有归属会话的项目目录，无法管理常驻服务。'

type ReportOutput = { report: string }

const renderReport = (_args: unknown, value: ReportOutput) => [
  { type: 'text' as const, text: value.report },
]

function reportOutput<const P extends Record<string, ParameterPropertySpec>>(properties: P) {
  return {
    schema: {
      type: 'object' as const,
      additionalProperties: false as const,
      properties: {
        ...properties,
        report: { type: 'string' as const, required: true as const },
      },
    },
    render: renderReport,
  }
}

/**
 * 注册五个工具。全部无条件注册，因为 dsh 没有 pi 的 `setActiveTools` seam；每个调用仍经过 dsh 的 `tools/pre-execute` waterfall，与 `bash` 一样接受 hooks 和 policy gate。
 * @param ctx - Host plugin context。
 * @param config - 解析后的插件配置。
 */
function registerTools(ctx: Context, config: Config): void {
  ctx.tools.register(defineTool({
    name: 'service_start',
    description:
      'Start a long-running service (dev server, backend, watcher, shared infra like a local S3) '
      + 'as a detached background process and return immediately. Output is written to '
      + '<dsh-home>/dsh-kit/logs/<name>.log; the process survives this tool call, this session, '
      + 'and dsh itself. Service names are unique across every workspace on this machine, '
      + 'so pick a descriptive name. Use this instead of bash/pwsh for any command that does not '
      + 'exit on its own. Under a confined sandbox mode this requires human approval, because '
      + 'a service runs outside the sandbox.',
    parameters: {
      name: { type: 'string', required: true, description: 'Globally unique service name, also used as the log file name.' },
      command: { type: 'string', required: true, description: "Shell command to run, e.g. 'pnpm dev'." },
      cwd: { type: 'string', description: 'Working directory; defaults to the session project directory.' },
      port: { type: 'integer', description: 'TCP port the service listens on; used as the readiness probe when given.' },
      readyLog: { type: 'string', description: 'Regex matched against the log to detect readiness when no port is given.' },
      readyTimeoutMs: { type: 'integer', description: 'Readiness probe timeout in ms (default 8000, max 120000).' },
      shell: {
        type: 'string',
        description:
          'Shell used to run the command. Defaults to the same shell as the pwsh/bash tool, so commands '
          + 'use one syntax everywhere. Override only when this specific command needs a different shell.',
      },
    },
    output: reportOutput({
      ok: { type: 'boolean', required: true },
    }),
    async execute(args, exec) {
      const cwd = toolCwd(exec)
      if (cwd === undefined) return { ok: false, report: NO_CWD }
      const refusal = await gateSpawn(ctx, exec.agent, `启动常驻服务 ${args.name}：${args.command}`, config)
      if (refusal !== undefined) return { ok: false, report: refusal }
      const result = await startService({
        home: resolveDshHome(),
        name: args.name,
        command: args.command,
        // root 标记归属工作区（面板徽标、重启归属）；registry 与日志都在 dsh home。
        root: cwd,
        cwd: args.cwd ?? cwd,
        ...args.port === undefined ? {} : { port: args.port },
        ...args.readyLog === undefined ? {} : { readyLog: args.readyLog },
        ...args.readyTimeoutMs === undefined ? {} : { readyTimeoutMs: args.readyTimeoutMs },
        ...args.shell === undefined ? {} : { shell: args.shell },
      })
      return { ok: result.ok, report: result.message }
    },
    presentCall: args => ({ card: 'generic', title: `Start service ${args.name}`, kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'service_list',
    description:
      'List running services and the logs left behind by stopped ones. This is the live source of '
      + 'truth for whether a service exists: it reconciles the registry against the operating system '
      + 'on every call, so a service that died on its own is reported as stopped. Defaults to the '
      + 'current project; pass scope "all" to see services from every workspace on this machine — '
      + 'that is the fastest way to find out which project owns the process holding a port.',
    parameters: {
      scope: { type: 'string', enum: ['project', 'all'], description: 'Visibility: "project" (default) or "all" workspaces.' },
    },
    output: reportOutput({
      running: { type: 'integer', required: true },
    }),
    execute(args, exec) {
      const cwd = toolCwd(exec)
      if (cwd === undefined) return Promise.resolve({ running: 0, report: NO_CWD })
      const value = snapshot(resolveDshHome(), { cwd, all: args.scope === 'all' })
      return Promise.resolve({ running: value.services.length, report: formatSnapshot(value) })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'service_logs',
    description:
      "Return the tail of a service's log file. Also works for a service that already exited, which "
      + 'is the fastest way to find out why it died. Services are addressed by globally unique name, '
      + 'so logs of a service started in another workspace are readable too.',
    parameters: {
      name: { type: 'string', required: true, description: 'Service name.' },
      lines: { type: 'integer', description: `Number of trailing lines (default ${String(DEFAULT_LOG_LINES)}, max ${String(MAX_LOG_LINES)}).` },
    },
    output: reportOutput({
      file: { type: 'string', required: true },
      running: { type: 'boolean', required: true },
    }),
    execute(args, exec) {
      const result = logsOf(resolveDshHome(), toolCwd(exec) ?? null, args.name, args.lines ?? DEFAULT_LOG_LINES)
      const head = `${result.file}${result.running ? '' : '（服务未在运行）'}`
      return Promise.resolve({
        file: result.file,
        running: result.running,
        report: result.tail === '' ? `${head}\n(空)` : `${head}\n${result.tail}`,
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'service_stop',
    description:
      'Stop a service started by service_start, killing its whole process tree. Services are '
      + 'addressed by globally unique name, so a service started in another workspace can be '
      + 'stopped from here too. Refuses to act when the recorded pid can no longer be confirmed '
      + 'to be that service, because the operating system recycles pids and killing the wrong '
      + 'tree cannot be undone.',
    parameters: {
      name: { type: 'string', required: true, description: 'Service name.' },
    },
    output: reportOutput({
      ok: { type: 'boolean', required: true },
    }),
    execute(args) {
      const result = stopService(resolveDshHome(), args.name)
      return Promise.resolve({ ok: result.ok, report: result.message })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'service_restart',
    description:
      'Stop a running service and start it again with the command recorded at start time. Use this '
      + 'after changing code the service must pick up, instead of pairing service_stop with '
      + 'service_start. Works from any workspace by globally unique name; whether you may start it '
      + 'again is still decided by your own session\'s sandbox mode.',
    parameters: {
      name: { type: 'string', required: true, description: 'Service name.' },
      readyTimeoutMs: { type: 'integer', description: 'Readiness probe timeout in ms (default 8000, max 120000).' },
    },
    output: reportOutput({
      ok: { type: 'boolean', required: true },
    }),
    async execute(args, exec) {
      const refusal = await gateSpawn(ctx, exec.agent, `重启常驻服务 ${args.name}`, config)
      if (refusal !== undefined) return { ok: false, report: refusal }
      const result = await restartService(resolveDshHome(), args.name, args.readyTimeoutMs)
      return { ok: result.ok, report: result.message }
    },
  }))
}

/**
 * 分发 panel 解码后的 RPC call。panel 刻意不能 START 服务：页面任意命令输入框会形成不同的安全边界；启动只留给带 approval gate 和转录记录的 model-facing tool。
 * list 返回整台部署的全部存活服务（当前工作区排前）；named endpoint 按全局唯一名称寻址，不再要求会话有项目目录。
 * @param ctx - Host plugin context。
 * @param endpoint - 相对 channel 的 endpoint 名称。
 * @param payload - browser payload。
 * @param config - 解析后的插件配置。
 * @param home - dsh home；默认实时解析 `$DSH_HOME`，测试注入显式目录。
 * @returns 结果或带错误码的失败。
 */
export async function dispatch(
  ctx: Context,
  endpoint: string,
  payload: unknown,
  config: Config,
  home: string = resolveDshHome(),
): Promise<ConnectionRpcResult<unknown>> {
  if (!isServicesEndpoint(endpoint)) {
    return {
      ok: false,
      error: { code: UNKNOWN_ENDPOINT_CODE, message: `unknown endpoint "${endpoint}"`, details: {} },
    }
  }
  const wellFormed = endpoint === 'list' ? isListRequest(payload) : isNamedRequest(payload)
  if (!wellFormed) {
    return {
      ok: false,
      error: { code: BAD_PAYLOAD_CODE, message: `"${endpoint}" payload is malformed`, details: {} },
    }
  }
  try {
    const request = payload as { sessionId: string; name?: string; lines?: number }
    const cwd = cwdOf(ctx, request.sessionId)
    if (endpoint === 'list') {
      return { ok: true, value: snapshot(home, { cwd: cwd ?? null, all: true }) }
    }
    // `isNamedRequest` 已证明所有非 list endpoint 都带有 name。
    const serviceName = request.name as string
    if (endpoint === 'logs') {
      return { ok: true, value: logsOf(home, cwd ?? null, serviceName, request.lines ?? DEFAULT_LOG_LINES) }
    }
    if (endpoint === 'stop') {
      return { ok: true, value: stopService(home, serviceName) }
    }
    // restart 也使用与 tool 相同的 spawn gate；按按钮不是跳过 sandbox 决策的理由。
    const agent = ctx.agents.get(request.sessionId as SessionId)
    const refusal = await gateSpawn(ctx, agent, `重启常驻服务 ${serviceName}`, config)
    if (refusal !== undefined) return { ok: true, value: { ok: false, message: refusal } }
    return { ok: true, value: await restartService(home, serviceName) }
  } catch (error: unknown) {
    return {
      ok: false,
      error: {
        code: INTERNAL_CODE,
        message: error instanceof Error ? error.message : String(error),
        details: {},
      },
    }
  }
}

/**
 * 挂载 tools 和 panel channel。
 * @param ctx - Host plugin context。
 * @param config - 解析后的插件配置。
 */
export function apply(ctx: Context, config: Config): void {
  registerTools(ctx, config)

  const dispose = registerKitChannel(
    ctx,
    CHANNEL,
    async (endpoint, requestPayload) => await dispatch(ctx, endpoint, requestPayload, config),
  )
  ctx.effect(() => () => void dispose(), 'services: channel')
}
