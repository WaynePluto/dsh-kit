/**
 * 固定 YOLO 模式升级/冒烟检查。
 * 先在进程内检查 Host 产物、默认停用契约（patch 行表达式只在 profile patch 显式启用 yolo-mode
 * 行时生效）与套件聚合形态的常量改写，再用壳级 overlay 加载隔离真实 dsh 和临时探针；
 * yolo-mode 经 profile 的 bundles 数组以 Bundle 装载（不再走 --patch overlay），冒烟 profile 的
 * patch 层写入显式启用行，探针不发模型请求，检查实时 Agent 工具 schema，用无害 shell 调用
 * 验证冗余提权字段，并在完整配对 test turn 发起一次明确 approval。
 * 升级 dsh 或修改此插件后运行：`node scripts/yolo-mode-check.mjs [--port 3101]`。
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DSH_BIN, DSH_PROFILE, DEFAULT_PROFILE_BUNDLES, DEV_DIRECTORY, DSH_HOME_DEV, ROOT } from './local-config.mjs'
import { cleanupCheckHome, withCheckHome } from './lib/check-home.mjs'
import { createCheckContext, runLiveDshCheck } from './lib/check-context.mjs'
import { inspectHostBundle as inspectHostArtifact } from './lib/check-client-bundle.mjs'

const PACKAGE_DIRECTORY = join(ROOT, 'plugins', 'yolo-mode')
const HOST_BUNDLE = join(PACKAGE_DIRECTORY, 'dist', 'index.js')
const BUNDLE_PATCH = join(PACKAGE_DIRECTORY, 'cordis.patch.yml')
const YOLO_BUNDLE = '@dsh-kit/dsh-plugin-yolo-mode'
const portArgument = process.argv.indexOf('--port')
const PORT = portArgument === -1 ? 3101 : Number(process.argv[portArgument + 1])
const HOME = join(DEV_DIRECTORY, 'yolo-mode-check-home')
const HOME_OFF = join(DEV_DIRECTORY, 'yolo-mode-check-home-off')
const HOME_SUITE = join(DEV_DIRECTORY, 'yolo-mode-check-home-suite')
const PROBE_DIRECTORY = join(DEV_DIRECTORY, 'yolo-mode-check-probe')
const PROBE_OVERLAY = join(PROBE_DIRECTORY, 'dsh-overlay.yml')
const PROBE_MODULE = join(PROBE_DIRECTORY, 'probe.mjs')

let failures = 0

function noop() {}

function check(ok, what, detail) {
  if (!ok) failures += 1
  console.log(`${ok ? '[ok]  ' : '[fail]'} ${what}${detail === undefined ? '' : ` — ${detail}`}`)
}

/** 调用探针的 /api 精确路由（kit 信封）；响应包装回 { result } 兼容既有断言。 */
async function probeCall(context, endpoint, cookie) {
  const response = await fetch(`${context.base}/api/yolo-mode-probe`, {
    method: 'POST',
    headers: {
      ...context.browserHeaders(cookie),
      'content-type': 'application/json',
    },
    body: JSON.stringify({ endpoint, payload: {} }),
  })
  let body
  try { body = await response.json() } catch { body = undefined }
  return { status: response.status, body: { result: body } }
}

function prepareProbe() {
  mkdirSync(PROBE_DIRECTORY, { recursive: true })
  // 探针通道走官方 connection.fetch.register 的 /api 精确路由（与组件一致的
  // kit 信封，见 packages/plugin-rpc）；不再覆写官方 connection 行（D16）。
  writeFileSync(PROBE_OVERLAY, [
    '- insert:',
    '    - id: yolo-mode-smoke-probe',
    "      name: './probe.mjs'",
    '',
  ].join('\n'))
  writeFileSync(PROBE_MODULE, `
let lastAgent

export const name = 'dsh-kit-yolo-mode-smoke-probe'
export const inject = ['agents', 'tools', 'sandboxPolicy', 'approval', 'connection']

function nextTurn(agent) {
  let latest = 0
  for (const event of agent.session.snapshotEvents()) {
    if (event.type === 'turn/start' && typeof event.data.turn === 'number') latest = Math.max(latest, event.data.turn)
  }
  return latest + 1
}

// health：默认停用路径的服务健康检查——不发起 approval（原生 ask 会挂起），
// 只证明 sandboxPolicy/approval 服务装载成功（探针行 inject 依赖它们）。
async function endpointHandler(ctx, endpoint) {
    if (endpoint === 'health') {
      return { ok: true, value: { mode: ctx.sandboxPolicy.resolve({}).mode } }
    }
    if (endpoint !== 'inspect') {
      return { ok: false, error: { code: 'probe/unknown-endpoint', message: 'unknown endpoint', details: {} } }
    }
    const agent = lastAgent ?? ctx.agents.list()[0]
    if (agent === undefined) {
      return { ok: false, error: { code: 'probe/no-agent', message: 'session.create did not publish an Agent', details: {} } }
    }
    const schemas = agent.ctx.tools.schemas(agent)
    const names = ['bash', 'pwsh', 'write', 'edit']
    const targets = schemas.filter((schema) => names.includes(schema.name))
    const turn = nextTurn(agent)
    agent.session.append('turn/start', { turn })
    let approval
    let tool
    try {
      approval = await ctx.approval.request({ agent, toolName: 'yolo-mode-smoke', reason: 'fixed YOLO smoke approval' })
      const shell = process.platform === 'win32' ? 'pwsh' : 'bash'
      const argumentsForShell = process.platform === 'win32'
        ? { command: 'Write-Output yolo-mode-smoke', description: 'Run the YOLO smoke command', sandbox_permissions: 'workspace-write', justification: 'stale model fields' }
        : { command: 'printf yolo-mode-smoke', description: 'Run the YOLO smoke command', sandbox_permissions: 'workspace-write', justification: 'stale model fields' }
      tool = await ctx.tools.execute({
        callId: 'yolo-mode-smoke',
        name: shell,
        arguments: argumentsForShell,
        agent,
        signal: new AbortController().signal,
      })
    } finally {
      agent.session.append('turn/end', { turn, reason: { kind: 'completed' } })
    }
    const policy = agent.session.snapshotEvents().filter((event) => event.type === 'sandbox/mode' || event.type === 'approval/policy')
    return {
      ok: true,
      value: {
        schemas: targets,
        policy: policy.map((event) => ({ type: event.type, data: event.data })),
        approval,
        toolError: tool?.isError ?? true,
      },
    }
}

export function apply(ctx) {
  ctx.on('agent/created', ({ agent }) => { lastAgent = agent })
  ctx.on('agent/disposed', ({ agent }) => { if (lastAgent === agent) lastAgent = undefined })
  const dispose = ctx.connection.fetch.register({
    path: '/api/yolo-mode-probe',
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      let endpoint
      try {
        const body = await request.json()
        endpoint = typeof body === 'object' && body !== null ? body.endpoint : undefined
      } catch { endpoint = undefined }
      if (typeof endpoint !== 'string' || endpoint.length === 0) {
        return Response.json({ ok: false, error: { code: 'probe/bad-request', message: 'body must be JSON { endpoint }', details: {} } })
      }
      try {
        return Response.json(await endpointHandler(ctx, endpoint))
      } catch (error) {
        return Response.json({ ok: false, error: { code: 'probe/internal', message: String(error), details: {} } })
      }
    },
  })
  ctx.effect(() => () => { void dispose() }, 'yolo-mode smoke probe')
}
`)
}

/** 准备冒烟 profile：enableYolo 为 true 时写入显式启用行，否则保持默认（停用）。 */
function prepareProfile(home, enableYolo, bundles) {
  cleanupCheckHome(home)
  const profile = join(home, 'profiles', DSH_PROFILE)
  mkdirSync(profile, { recursive: true })
  // 与 launcher/profile.ts 的默认模板同一份 Bundle 清单（local-config 复制，
  // launcher 为权威）：yolo-mode 以 Bundle 层装载，验证的正是发行装载路径，
  // 而不是 --patch overlay。yolo-mode 排在受管清单末位。
  writeFileSync(join(profile, 'package.json'), `${JSON.stringify({
    name: `dsh-profile-${DSH_PROFILE}`,
    private: true,
    dependencies: {},
    dsh: { profile: { bundles: bundles ?? DEFAULT_PROFILE_BUNDLES } },
  }, null, 2)}\n`)
  // 默认停用契约要求显式启用行：模拟用户在插件页打开 yolo-mode 组件开关。
  // dsh 的 writePluginEnabled 追加的是流式形态（yaml 库 document.add 输出 flow map）。
  writeFileSync(join(profile, 'cordis.patch.yml'), enableYolo ? '[ { id: yolo-mode, disabled: false } ]\n' : '[]\n')
  writeFileSync(join(profile, 'pnpm-workspace.yaml'), 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n')
}

function prepareHome() {
  prepareProfile(HOME, true)
}

function prepareHomeOff() {
  prepareProfile(HOME_OFF, false)
}

/** 套件形态（用户桌面安装路径）：profile 只挂套件 Bundle，套件包以 junction 链进 profile node_modules。 */
function prepareHomeSuite(enableYolo) {
  return () => {
    prepareProfile(HOME_SUITE, enableYolo, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@dsh-kit/dsh-plugin-suite'])
    const modules = join(HOME_SUITE, 'profiles', DSH_PROFILE, 'node_modules', '@dsh-kit')
    mkdirSync(modules, { recursive: true })
    symlinkSync(join(ROOT, 'plugins', 'suite'), join(modules, 'dsh-plugin-suite'), 'junction')
  }
}

/** 从 yolo-mode patch 按行 id 提取 config/disabled 的 !!js 表达式（单引号内不含撇号）。
 * 行尾容忍 \r：Windows autocrlf 检出会把工作区 patch 转成 CRLF。 */
function extractRowExpressions(patchText) {
  const found = new Map()
  const lines = patchText.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    const rowMatch = /^- id: ([\w-]+)$|^ {4}- id: ([\w-]+)$/u.exec(trimmed)
    if (rowMatch === null) continue
    const rowId = rowMatch[1] ?? rowMatch[2]
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j]
      if (next.trim().startsWith('- id: ') || next.trim().startsWith('- insert')) break
      const m = /^(\s*)(mode|policy|disabled): !!js '([^']+)'\r?$/u.exec(next)
      if (m !== null && !found.has(`${rowId}:${m[2]}`)) found.set(`${rowId}:${m[2]}`, m[3])
    }
  }
  return found
}

/** 与 dsh 的行表达式求值同构：loader/行 fiber ctx 里以 baseUrl（目录 URL）求值。 */
function evaluateRowExpression(expression, { manifest, profilePatch, env }) {
  const evaluate = new Function('baseUrl', 'process', `return ${expression}`)
  const directory = mkdtempSync(join(tmpdir(), 'yolo-contract-'))
  const previous = process.env.DSH_PERMISSION_MODE
  try {
    writeFileSync(join(directory, 'package.json'), JSON.stringify(manifest ?? {}))
    if (profilePatch !== undefined) writeFileSync(join(directory, 'cordis.patch.yml'), profilePatch)
    if (env === undefined) delete process.env.DSH_PERMISSION_MODE
    else process.env.DSH_PERMISSION_MODE = env
    return evaluate(`${pathToFileURL(directory).href}/`, process)
  } finally {
    if (previous === undefined) delete process.env.DSH_PERMISSION_MODE
    else process.env.DSH_PERMISSION_MODE = previous
    rmSync(directory, { recursive: true, force: true })
  }
}

/**
 * 检查默认停用契约（v3）。patch 层只有一个 insert 行（yolo-mode 插件行），
 * 完全不覆写官方行（D16：任何官方行覆写都会让套件启停的重组合级联重启
 * sandbox-policy → fs-sandbox → fs → session-controller，触发 file-upload 竞态）。
 * 生效面全部由插件代码承担；插件行自带「Bundle 在 bundles 且 profile patch
 * 显式启用本行」判定，识别块状与流式（writePluginEnabled 实际写入形态）两种行形态。
 */
function checkDefaultOffContract() {
  const overlay = readFileSync(BUNDLE_PATCH, 'utf8')
  const byRow = extractRowExpressions(overlay)
  const actor = byRow.get('yolo-mode:disabled')
  check(actor !== undefined, 'yolo-mode 插件行带判定表达式')
  const officialRows = [...byRow.keys()].filter(key => key !== 'yolo-mode:disabled')
  check(officialRows.length === 0, 'patch 层没有官方行覆写（sandbox-policy/approval/permission/ui-permission 一律不出现）',
    officialRows.join('、') || '无')
  check(!overlay.includes('- id: sandbox-policy') && !overlay.includes('- id: approval')
    && !overlay.includes('- id: permission') && !overlay.includes('- id: ui-permission'),
    'patch 层没有四个官方行的任何覆写痕迹')
  if (actor === undefined) return

  const manifest = { dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', YOLO_BUNDLE] } } }
  const bundleOff = { dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } } }
  const scenarios = [
    // [说明, fixture, 期望 disabled]
    ['无 profile patch 时默认停用', { manifest }, true],
    ['空 profile patch 时默认停用', { manifest, profilePatch: '[]\n' }, true],
    ['流式启用行（writePluginEnabled 实际形态）生效', { manifest, profilePatch: '[ { id: yolo-mode, disabled: false } ]\n' }, false],
    ['CRLF 流式启用行生效', { manifest, profilePatch: '[ { id: yolo-mode, disabled: false } ]\r\n' }, false],
    ['块状启用行生效', { manifest, profilePatch: '- id: yolo-mode\n  disabled: false\n' }, false],
    ['CRLF 块状启用行生效', { manifest, profilePatch: '- id: yolo-mode\r\n  disabled: false\r\n' }, false],
    ['流式停用行保持停用', { manifest, profilePatch: '[ { id: yolo-mode, disabled: true } ]\n' }, true],
    ['带包名的块状启用行生效', { manifest, profilePatch: `- id: yolo-mode\n  name: '${YOLO_BUNDLE}'\n  disabled: false\n` }, false],
    ['name 不匹配的行不启用', { manifest, profilePatch: '[ { id: yolo-mode, name: other-pkg, disabled: false } ]\n' }, true],
    ['insert 块内嵌套行不算覆写', { manifest, profilePatch: '- insert:\n    - id: yolo-mode\n      disabled: false\n' }, true],
    ['块状关-流式开，最后生效', { manifest, profilePatch: '- id: yolo-mode\n  disabled: true\n- { id: yolo-mode, disabled: false }\n' }, false],
    ['Bundle 离开 bundles 时回退停用', { manifest: bundleOff, profilePatch: '[ { id: yolo-mode, disabled: false } ]\n' }, true],
  ]
  for (const [what, fixture, expected] of scenarios) {
    check(evaluateRowExpression(actor, fixture) === expected, `yolo-mode 插件行表达式：${what}`)
  }

  const suitePatch = readFileSync(join(ROOT, 'plugins', 'suite', 'cordis.patch.yml'), 'utf8')
  const suiteRows = extractRowExpressions(suitePatch)
  const suiteYolo = [...suiteRows.entries()].filter(([key]) => key.startsWith('yolo-mode:'))
  check(suiteYolo.length === 1, '套件 patch 的 yolo 段只有插件行一个判定表达式', `实际 ${String(suiteYolo.length)} 行`)
  check(suiteYolo.every(([, value]) => value.includes('includes("@dsh-kit/dsh-plugin-suite")')),
    '套件 patch 的 yolo 表达式已把 bundles 常量改写为套件包名')
  check(!suitePatch.includes('- id: sandbox-policy') && !suitePatch.includes('- id: approval')
    && !suitePatch.includes('\n- id: permission') && !suitePatch.includes('- id: ui-permission'),
    '套件 patch 没有 yolo 的官方行覆写')
}

async function checkHostArtifact() {
  check(existsSync(HOST_BUNDLE), 'Host bundle dist/index.js 存在', HOST_BUNDLE)
  check(existsSync(BUNDLE_PATCH), 'cordis.patch.yml 存在', BUNDLE_PATCH)
  check(!existsSync(join(PACKAGE_DIRECTORY, 'dist', 'client.js')), 'Host-only 插件没有生成 dist/client.js')
  const manifest = JSON.parse(readFileSync(join(PACKAGE_DIRECTORY, 'package.json'), 'utf8'))
  check(manifest.dsh?.bundle?.patch === './cordis.patch.yml', 'package.json 声明 dsh.bundle.patch 指向 cordis.patch.yml')
  const overlay = readFileSync(BUNDLE_PATCH, 'utf8')
  check(overlay.includes('- insert:') && overlay.includes('- id: yolo-mode'),
    'Bundle patch 只包含 yolo-mode 插件 insert 行（v3：无官方行覆写）')
  check(overlay.indexOf("name: './dist/index.js'") !== -1, 'Bundle patch 使用相对 Host bundle 路径')
  if (!existsSync(HOST_BUNDLE)) return

  const listeners = new Map()
  let cleanup = noop
  const inspection = await inspectHostArtifact({
    entry: HOST_BUNDLE,
    autoCleanup: false,
    createContext: ({ cleanup: registerCleanup }) => {
      const context = {
        agents: { list: () => [] },
        on: (event, listener, options) => {
          listeners.set(event, { listener, options })
          return () => listeners.delete(event)
        },
        effect: (factory) => {
          cleanup = factory()
          registerCleanup(cleanup)
          return cleanup
        },
        logger: { warn: () => {} },
      }
      return context
    },
  })
  const module = inspection.module
  check(Array.isArray(module.inject) && module.inject.includes('sandboxPolicy') && module.inject.includes('approval'), 'Host apply 声明策略与批准服务')
  const answerer = listeners.get('approval/request')
  check(answerer?.options?.prepend === true, 'approval answerer 使用 prepend:true')
  check(await answerer?.listener({}) === 'allowed-once', 'Host answerer 自动返回 allowed-once')
  const controller = new AbortController()
  controller.abort()
  check(await answerer?.listener({ signal: controller.signal }) === 'cancelled', '已取消 approval 返回 cancelled')
  check(!listeners.has('user-questions/request'), '没有认领 user-questions/request')
  await inspection.cleanup()
}

async function checkLiveDsh() {
  await withCheckHome({ home: HOME, prepare: prepareHome }, async () => {
    prepareProbe()
    const context = createCheckContext({
      dshBin: DSH_BIN,
      profile: DSH_PROFILE,
  overlays: () => [PROBE_OVERLAY],
      home: HOME,
      sourceHome: DSH_HOME_DEV,
      cwd: ROOT,
      port: PORT,
      trustedHost: `127.0.0.1:${PORT}`,
      tokenPattern: /dsh web:\s*\S+?[?&]token=([\w.-]+)/u,
      timeoutMessage: (output) => 'dsh 60 秒内没有打印访问地址：\n' + output,
      exitMessage: (code, output) => 'dsh 退出（code ' + code + '）：\n' + output,
      rpcId: 'yolo-mode-smoke',
      cleanup: false,
    })
    await runLiveDshCheck(context, {
      startedAssertions: () => {
        check(true, `真实 dsh 以 Bundle 装载（含 ${YOLO_BUNDLE}）与壳级 overlay + 临时 probe 正常启动`)
      },
      exchangeAssertions: ({ exchange, cookie }) => {
        check(cookie !== '', 'dsh token 换到了浏览器 cookie', `status ${exchange.status}`)
      },
      bundleAssertions: ({ index }) => {
        check(index.includes('@deepseek-ai/dsh-client-ui-permission-presets'), '首页保持下发原生权限选择器 client bundle（v3 不再隐藏）')
      },
      liveAssertions: async ({ cookie }) => {
        const call = context.rpcRequest
        const created = await call({ path: '/api/session/create', method: 'session/create', payload: { args: { request: { cwd: ROOT } } }, cookie })
        const sessionId = created.body?.result?.value?.sessionId
        check(created.status === 200 && typeof sessionId === 'string', '真实 dsh 创建了测试 Agent session', JSON.stringify(created.body).slice(0, 240))
        if (typeof sessionId !== 'string') return

        const inspected = await probeCall(context, 'inspect', cookie)
        const value = inspected.body?.result?.value
        check(inspected.status === 200 && inspected.body?.result?.ok === true, 'probe RPC 通过 dsh 认证与 Host/Origin fence')
        const targetSchemas = Array.isArray(value?.schemas) ? value.schemas : []
        check(targetSchemas.length >= 1, 'probe 观察到了至少一个目标工具 schema', JSON.stringify(targetSchemas.map((schema) => schema.name)))
        check(
          targetSchemas.every((schema) => {
            const properties = schema.parameters?.properties ?? {}
            return properties.sandbox_permissions === undefined && properties.justification === undefined
          }),
          '四个目标工具 schema 均隐藏两个提权字段',
        )
        check(value?.approval === 'allowed-once', '显式 approval/request 自动得到 allowed-once')
        // 官方部署默认可能先落一条 workspace-write 事件；断言看最后一条 sandbox/mode 与最后一条 approval/policy。
        const lastMode = [...(value?.policy ?? [])].reverse().find(event => event.type === 'sandbox/mode')
        const lastApproval = [...(value?.policy ?? [])].reverse().find(event => event.type === 'approval/policy')
        check(lastMode?.data?.mode === 'danger-full-access' && lastApproval?.data?.policy === 'ask',
          'Agent 历史中最后的策略是 full-access + ask',
          JSON.stringify(value?.policy),
        )
        check(value?.toolError === false, '带冗余提权字段的真实 shell 工具调用成功')
      },
    })
  })
}

/** 默认停用路径的实机验证：无显式启用行时原生权限保持原样，sandboxPolicy/approval 服务健康。 */
async function checkLiveDefaultOff() {
  await withCheckHome({ home: HOME_OFF, prepare: prepareHomeOff }, async () => {
    prepareProbe()
    const context = createCheckContext({
      dshBin: DSH_BIN,
      profile: DSH_PROFILE,
      overlays: () => [PROBE_OVERLAY],
      home: HOME_OFF,
      sourceHome: DSH_HOME_DEV,
      cwd: ROOT,
      port: PORT,
      trustedHost: `127.0.0.1:${PORT}`,
      tokenPattern: /dsh web:\s*\S+?[?&]token=([\w.-]+)/u,
      timeoutMessage: (output) => 'dsh 60 秒内没有打印访问地址：\n' + output,
      exitMessage: (code, output) => 'dsh 退出（code ' + code + '）：\n' + output,
      rpcId: 'yolo-mode-smoke',
      cleanup: false,
    })
    await runLiveDshCheck(context, {
      bundleAssertions: ({ index }) => {
        check(index.includes('@deepseek-ai/dsh-client-ui-permission-presets'), '默认停用时首页恢复下发原生权限选择器 client bundle')
      },
      liveAssertions: async ({ cookie }) => {
        // health 探针行注入 sandboxPolicy/approval：RPC 有应答即两个服务都装载成功，
        // 不存在 v1 那种覆写行整行禁用导致的 pending 级联。
        const inspected = await probeCall(context, 'health', cookie)
        const value = inspected.body?.result?.value
        check(inspected.status === 200 && inspected.body?.result?.ok === true, '默认停用时 sandboxPolicy/approval 服务健康装载')
        check(value?.mode !== 'danger-full-access', '默认停用时部署 sandbox 模式不是 danger-full-access', JSON.stringify(value))
      },
    })
  })
}

/** 套件形态实机验证：用户桌面安装路径（bundles 只挂套件 + 流式启用行），覆盖启用与默认停用两态。 */
/* oxlint-disable no-await-in-loop -- 两种状态共用同一端口，必须按顺序启动与停止。 */
async function checkLiveSuiteForm() {
  const states = [['启用', true], ['默认停用', false]]
  for (const [label, enableYolo] of states) {
    await withCheckHome({ home: HOME_SUITE, prepare: prepareHomeSuite(enableYolo) }, async () => {
      prepareProbe()
      const context = createCheckContext({
        dshBin: DSH_BIN,
        profile: DSH_PROFILE,
        overlays: () => [PROBE_OVERLAY],
        home: HOME_SUITE,
        sourceHome: DSH_HOME_DEV,
        cwd: ROOT,
        port: PORT,
        trustedHost: `127.0.0.1:${PORT}`,
        tokenPattern: /dsh web:\s*\S+?[?&]token=([\w.-]+)/u,
        timeoutMessage: (output) => 'dsh 60 秒内没有打印访问地址：\n' + output,
        exitMessage: (code, output) => 'dsh 退出（code ' + code + '）：\n' + output,
        rpcId: 'yolo-mode-smoke',
        cleanup: false,
      })
      await runLiveDshCheck(context, {
        bundleAssertions: ({ index }) => {
          // v3 不禁用原生权限选择器（生效面收敛到插件代码）；选择器始终下发。
          check(index.includes('@deepseek-ai/dsh-client-ui-permission-presets'),
            `套件形态${label}：原生权限选择器 client bundle 保持下发（v3 不再隐藏）`)
        },
        liveAssertions: async ({ cookie }) => {
          const endpoint = enableYolo ? 'inspect' : 'health'
          if (enableYolo) {
            const created = await context.rpcRequest({ path: '/api/session/create', method: 'session/create', payload: { args: { request: { cwd: ROOT } } }, cookie })
            check(created.status === 200 && typeof created.body?.result?.value?.sessionId === 'string',
              '套件形态启用：真实 dsh 创建了测试 Agent session', JSON.stringify(created.body).slice(0, 200))
          }
          const inspected = await probeCall(context, endpoint, cookie)
          const result = inspected.body?.result
          check(inspected.status === 200 && result?.ok === true, `套件形态${label}：probe RPC 正常（服务装载成功）`)
          if (result?.ok !== true) return
          if (enableYolo) {
            const suiteLastMode = [...(result.value?.policy ?? [])].reverse().find(event => event.type === 'sandbox/mode')
            const suiteLastApproval = [...(result.value?.policy ?? [])].reverse().find(event => event.type === 'approval/policy')
            check(suiteLastMode?.data?.mode === 'danger-full-access' && suiteLastApproval?.data?.policy === 'ask',
              '套件形态启用：Agent 策略为 full-access + ask（最后的策略事件）', JSON.stringify(result.value?.policy))
            check(result.value?.approval === 'allowed-once', '套件形态启用：approval 自动 allowed-once')
          } else {
            check(result.value?.mode !== 'danger-full-access', '套件形态默认停用：部署模式不是 danger-full-access', JSON.stringify(result.value))
          }
        },
      })
    })
  }
}

async function main() {
  try {
    checkDefaultOffContract()
    await checkHostArtifact()
    await checkLiveDsh()
    await checkLiveDefaultOff()
    await checkLiveSuiteForm()
  } catch (error) {
    failures += 1
    console.error(`[fail] yolo-mode smoke aborted: ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
  } finally {
    cleanupCheckHome(PROBE_DIRECTORY)
    cleanupCheckHome(HOME)
    cleanupCheckHome(HOME_OFF)
    cleanupCheckHome(HOME_SUITE)
  }
  console.log(failures === 0 ? '\n全部通过。' : `\n${failures} 项未通过。`)
  process.exit(failures === 0 ? 0 : 1)
}

await main()
