/**
 * 套件在线停用/启用回归（2026-10-14 用户报错的验收检查）。
 * 复现用户路径「插件页停用整个套件 → 紧接着重新启用」：profile 以套件在 bundles
 * 内冷启动（组件随进程装载，runtime resolution 表含组件），运行中先把套件移出
 * bundles、再写回——两次都走插件管理器同一条 HMR 重组合路径。断言：
 * 1. 停用后组件行整树移除，官方核心行（llm-pi-ai、connection、session-controller、
 *    file-upload）保持 ACTIVE，进程存活；
 * 2. 重新启用后组件行全部恢复装载，官方核心行仍 ACTIVE；
 * 3. 全程输出没有 did not activate / Agent resolver 报错签名——历史上套件层覆写
 *    官方行（llm-pi-ai 屏障 + connection webServer 注入）会级联触发 dsh 0.2.0
 *    session-controller 的 file-upload 二次注册竞态（D16 移除覆写行后必须保持为零）。
 * 运行：node scripts/suite-toggle-check.mjs [--port 3106]。
 */

import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DSH_BIN, DSH_PROFILE, DEV_DIRECTORY, ROOT } from './local-config.mjs'
import { cleanupCheckHome, withCheckHome } from './lib/check-home.mjs'
import { createCheckContext, runLiveDshCheck } from './lib/check-context.mjs'

// 隔离 home 必须在仓库之外（祖先链不能解析到组件包，见 suite-first-enable-check）。
const HOME = join(tmpdir(), 'dsh-kit-suite-toggle-home')

const ON_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@dsh-kit/dsh-plugin-suite']
const OFF_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']

const PORT = (() => {
  const argument = process.argv.indexOf('--port')
  return argument === -1 ? 3106 : Number(process.argv[argument + 1])
})()
const PROBE_DIRECTORY = join(DEV_DIRECTORY, 'suite-toggle-probe')
const PROBE_OVERLAY = join(PROBE_DIRECTORY, 'dsh-overlay.yml')
const PROBE_MODULE = join(PROBE_DIRECTORY, 'probe.mjs')
// 组件行清单从 plugin-catalog.json 派生（套件包含全部分发组件），组件增减时自动同步。
const COMPONENT_ROWS = JSON.parse(readFileSync(join(ROOT, 'plugin-catalog.json'), 'utf8'))
  .distributions.flatMap(distribution => distribution.components.map(component => component.rowId))
// PENDING=0、ACTIVE=2、FAILED=3（cordis FiberState 值镜像，见 dsh app-boot）。
const FIBER_ACTIVE = 2
const CORE_ROWS = ['llm-pi-ai', 'connection', 'file-upload', 'session-controller']
const FAILURE_SIGNATURES = ['did not activate', 'Agent resolver is already registered']

let failures = 0

function check(ok, what, detail) {
  if (!ok) failures += 1
  console.log(`${ok ? '[ok]  ' : '[fail]'} ${what}${detail === undefined ? '' : ` — ${detail}`}`)
}

function prepareProbe() {
  mkdirSync(PROBE_DIRECTORY, { recursive: true })
  // 探针通道走官方 connection.fetch.register 的 /api 精确路由（kit 信封，D16）。
  writeFileSync(PROBE_OVERLAY, [
    '- insert:',
    '    - id: suite-toggle-probe',
    "      name: './probe.mjs'",
    '',
  ].join('\n'))
  writeFileSync(PROBE_MODULE, `
let output = ''

export const name = 'dsh-kit-suite-toggle-probe'
export const inject = ['loader', 'connection']

async function entries(ctx) {
    const rows = []
    for (const entry of ctx.loader.entries()) {
      if (typeof entry.options.id !== 'string') continue
      let disabled = null
      try { disabled = entry.disabled === true } catch { disabled = 'expression-error' }
      let failure
      const state = entry.fiber?.state
      if (state === 3) {
        try { await entry.fiber.await() } catch (error) { failure = String(error?.stack ?? error).slice(0, 600) }
      }
      rows.push({
        id: entry.options.id,
        disabled,
        fiberState: entry.fiber === undefined ? null : state,
        hasFiber: entry.fiber !== undefined,
        ...failure === undefined ? {} : { failure },
      })
    }
    return { ok: true, value: { rows, output } }
}

export function apply(ctx) {
  const dispose = ctx.connection.fetch.register({
    path: '/api/suite-toggle',
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      let endpoint
      try {
        const body = await request.json()
        endpoint = typeof body === 'object' && body !== null ? body.endpoint : undefined
      } catch { endpoint = undefined }
      if (endpoint !== 'entries') {
        return Response.json({ ok: false, error: { code: 'probe/unknown-endpoint', message: 'unknown endpoint', details: {} } })
      }
      try {
        return Response.json(await entries(ctx))
      } catch (error) {
        return Response.json({ ok: false, error: { code: 'probe/internal', message: String(error), details: {} } })
      }
    },
  })
  ctx.effect(() => () => { void dispose() }, 'suite toggle probe')
}

for (const stream of [process.stdout, process.stderr]) {
  const write = stream.write.bind(stream)
  stream.write = (chunk, ...rest) => { output += String(chunk); return write(chunk, ...rest) }
}
`)
}

function writeManifest(withSuite) {
  const profile = join(HOME, 'profiles', DSH_PROFILE)
  const bundles = withSuite ? [...ON_BUNDLES] : [...OFF_BUNDLES]
  writeFileSync(join(profile, 'package.json'), `${JSON.stringify({
    name: `dsh-profile-${DSH_PROFILE}`,
    private: true,
    dependencies: {},
    dsh: { profile: { bundles } },
  }, null, 2)}\n`)
}

function prepareHome() {
  return () => {
    cleanupCheckHome(HOME)
    const profile = join(HOME, 'profiles', DSH_PROFILE)
    mkdirSync(join(profile, 'node_modules', '@dsh-kit'), { recursive: true })
    symlinkSync(join(ROOT, 'plugins', 'suite'), join(profile, 'node_modules', '@dsh-kit', 'dsh-plugin-suite'), 'junction')
    writeManifest(true)
    writeFileSync(join(profile, 'cordis.patch.yml'), '[]\n')
    writeFileSync(join(profile, 'pnpm-workspace.yaml'), 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n')
    const require = createRequire(`${pathToFileURL(profile).href}/`)
    try {
      require.resolve('@dsh-kit/dsh-plugin-proxy/package.json')
      check(false, `隔离前置：${profile} 的祖先链意外解析到组件包，换一个仓库外的隔离目录再跑`)
    } catch {
      check(true, '隔离前置：profile 祖先链解析不到组件包')
    }
  }
}

function makeContext() {
  return createCheckContext({
    dshBin: DSH_BIN,
    profile: DSH_PROFILE,
    overlays: () => [PROBE_OVERLAY],
    home: HOME,
    cwd: ROOT,
    port: PORT,
    trustedHost: `127.0.0.1:${PORT}`,
    tokenPattern: /dsh web:\s*\S+?[?&]token=([\w.-]+)/u,
    timeoutMessage: (output) => 'dsh 90 秒内没有打印访问地址：\n' + output,
    exitMessage: (code, output) => 'dsh 退出（code ' + code + '）：\n' + output,
    rpcId: 'suite-toggle',
    cleanup: false,
  })
}

async function callEntries(context, cookie) {
  const response = await fetch(`${context.base}/api/suite-toggle`, {
    method: 'POST',
    headers: {
      ...context.browserHeaders(cookie),
      'content-type': 'application/json',
    },
    body: JSON.stringify({ endpoint: 'entries', payload: {} }),
  })
  let body
  try { body = await response.json() } catch { body = undefined }
  if (response.status !== 200 || body?.ok !== true) {
    throw new Error(`entries RPC 失败：HTTP ${String(response.status)} ${JSON.stringify(body).slice(0, 200)}`)
  }
  return body.value
}

/** 轮询等待重组合生效（hmr watch 有写入稳定去抖）。 */
async function waitFor(context, cookie, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    try {
      // eslint-disable-next-line no-await-in-loop -- 轮询：每轮依赖上一轮结果与间隔
      last = await callEntries(context, cookie)
      if (predicate(last)) return last
    } catch {
      // 重组合进行中，继续轮询
    }
    // eslint-disable-next-line no-await-in-loop -- 轮询间隔本身
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  if (last === undefined) throw new Error('等待重组合超时：entries RPC 一直不可用')
  return last
}

function rowOf(rows, id) {
  return rows.find(row => row.id === id)
}

function assertCoreRows(rows, phase) {
  for (const id of CORE_ROWS) {
    check(rowOf(rows, id)?.fiberState === FIBER_ACTIVE, `${phase}：${id} 保持 ACTIVE`,
      JSON.stringify(rowOf(rows, id)))
  }
}

function assertNoFailureSignatures(value, phase, processState) {
  const noise = FAILURE_SIGNATURES.filter(signature => value.output.includes(signature))
  if (noise.length > 0) {
    // 诊断输出：did not activate 诊断块全文（标题 + 每个条目的具体原因）。
    const start = value.output.indexOf('did not activate')
    const block = start === -1 ? '(找不到诊断块)' : value.output.slice(Math.max(0, value.output.lastIndexOf('\n', start)), start + 2500)
    check(false, `${phase}：进程输出没有停用/启用报错签名`, block.split('\n').map(l => l.slice(0, 220)).join(' ⏎ ').slice(0, 1800))
  } else {
    check(true, `${phase}：进程输出没有停用/启用报错签名`)
  }
  check(processState.alive === true, `${phase}：dsh 进程存活`)
}

/** 套件在 bundles 内冷启动，运行中停用 → 重新启用，全程断言官方核心行稳定。 */
async function checkToggle() {
  const context = makeContext()
  const processState = { alive: true }
  await runLiveDshCheck(context, {
    startedAssertions: ({ child }) => {
      child.alive = true
      child.on('exit', () => {
        child.alive = false
        processState.alive = false
      })
    },
    liveAssertions: async ({ cookie }) => {
      const boot = await waitFor(context, cookie,
        value => CORE_ROWS.every(id => rowOf(value.rows, id)?.fiberState === FIBER_ACTIVE)
          && COMPONENT_ROWS.every(id => rowOf(value.rows, id)?.fiberState === FIBER_ACTIVE),
        40_000)
      assertCoreRows(boot.rows, '冷启动')
      assertNoFailureSignatures(boot, '冷启动', processState)

      // ── 在线停用（用户报错路径 1）──
      writeManifest(false)
      const disabled = await waitFor(context, cookie,
        value => rowOf(value.rows, 'proxy') === undefined
          && CORE_ROWS.every(id => rowOf(value.rows, id)?.fiberState === FIBER_ACTIVE),
        40_000)
      const removed = COMPONENT_ROWS.filter(id => rowOf(disabled.rows, id) !== undefined)
      check(removed.length === 0, '停用后全部组件行整树移除', removed.join(', ') || '无')
      assertCoreRows(disabled.rows, '停用后')
      assertNoFailureSignatures(disabled, '停用后', processState)

      // ── 在线重新启用（用户报错路径 2）──
      writeManifest(true)
      const enabled = await waitFor(context, cookie,
        value => COMPONENT_ROWS
          .every(id => rowOf(value.rows, id)?.fiberState === FIBER_ACTIVE)
          && CORE_ROWS.every(id => rowOf(value.rows, id)?.fiberState === FIBER_ACTIVE),
        40_000)
      assertCoreRows(enabled.rows, '重新启用后')
      assertNoFailureSignatures(enabled, '重新启用后', processState)
    },
  })
}

async function main() {
  try {
    prepareProbe()
    await withCheckHome({ home: HOME, prepare: prepareHome() }, async () => {
      await checkToggle()
    })
  } catch (error) {
    failures += 1
    console.error(`[fail] suite toggle smoke aborted: ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
  } finally {
    cleanupCheckHome(PROBE_DIRECTORY)
    cleanupCheckHome(HOME)
  }
  console.log(failures === 0 ? '\n全部通过。' : `\n${failures} 项未通过。`)
  process.exit(failures === 0 ? 0 : 1)
}

await main()
