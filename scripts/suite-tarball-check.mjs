/**
 * 套件 tarball 安装端到端冒烟（D20 GitHub 直装形态的验收检查）。
 * 复现「添加插件」的 tarball 安装路径：在隔离 home 的新 profile 里用 pnpm 安装
 * release/dsh-kit.tar.gz（普通 tarball：pnpm 不做 packlist、不跑 prepare，套件自带
 * 的物化 node_modules 原样落地），随后以套件在 bundles 内冷启动真实 dsh。断言：
 * 1. pnpm 安装零 registry 依赖解析（自包含契约：suite 只有 peerDependencies）；
 * 2. 冷启动后全部组件行（plugin-catalog 派生）与官方核心行 ACTIVE，进程存活；
 * 3. 浏览器半完整：首页 __DSH_BOOT__ 图包含全部套件客户端行，无套件外 @dsh-kit 行；
 * 4. 输出没有 failed to import / did not activate 报错签名。
 * 本地 tarball 与 GitHub Release URL 走 pnpm 同一条 plain-tarball 路径，本检查
 * 用本地文件；URL 形态由实机验收覆盖（需要外网与真实 Release）。
 * 运行：pnpm suite:pack && node scripts/suite-tarball-check.mjs [--port 3107]。
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { DEV_DIRECTORY, DSH_BIN, DSH_PROFILE, PNPM_CLI, PLUGINS_DIRECTORY, ROOT } from './local-config.mjs'
import { cleanupCheckHome, withCheckHome } from './lib/check-home.mjs'
import { createCheckContext, runLiveDshCheck } from './lib/check-context.mjs'

const HOME = join(tmpdir(), 'dsh-kit-suite-tarball-home')
const SUITE_VERSION = JSON.parse(readFileSync(join(PLUGINS_DIRECTORY, 'suite', 'package.json'), 'utf8')).version
const TARBALL = join(ROOT, 'release', `v${SUITE_VERSION}`, 'dsh-kit.tar.gz')

const BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@dsh-kit/dsh-plugin-suite']

const PORT = (() => {
  const argument = process.argv.indexOf('--port')
  return argument === -1 ? 3107 : Number(process.argv[argument + 1])
})()
const PROBE_DIRECTORY = join(DEV_DIRECTORY, 'suite-tarball-probe')
const PROBE_OVERLAY = join(PROBE_DIRECTORY, 'dsh-overlay.yml')
const PROBE_MODULE = join(PROBE_DIRECTORY, 'probe.mjs')
// 组件行清单从 plugin-catalog.json 派生（套件包含全部分发组件，全部带浏览器半）。
const COMPONENT_ROWS = JSON.parse(readFileSync(join(ROOT, 'plugin-catalog.json'), 'utf8'))
  .distributions.flatMap(distribution => distribution.components.map(component => component.rowId))
const CLIENT_ROWS = COMPONENT_ROWS.map(id => `@dsh-kit/dsh-plugin-${id}`)
// PENDING=0、ACTIVE=2、FAILED=3（cordis FiberState 值镜像，见 dsh app-boot）。
const FIBER_ACTIVE = 2
const CORE_ROWS = ['llm-pi-ai', 'connection', 'file-upload', 'session-controller']
const FAILURE_SIGNATURES = ['failed to import', 'did not activate', 'Agent resolver is already registered']

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
    '    - id: suite-tarball-probe',
    "      name: './probe.mjs'",
    '',
  ].join('\n'))
  writeFileSync(PROBE_MODULE, `
let output = ''

export const name = 'dsh-kit-suite-tarball-probe'
export const inject = ['loader', 'connection']

async function entries(ctx) {
    const rows = []
    for (const entry of ctx.loader.entries()) {
      if (typeof entry.options.id !== 'string') continue
      rows.push({
        id: entry.options.id,
        disabled: entry.disabled === true,
        fiberState: entry.fiber === undefined ? null : entry.fiber.state,
        hasFiber: entry.fiber !== undefined,
      })
    }
    return { ok: true, value: { rows, output } }
}

export function apply(ctx) {
  const dispose = ctx.connection.fetch.register({
    path: '/api/suite-tarball',
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
  ctx.effect(() => () => { void dispose() }, 'suite tarball probe')
}

for (const stream of [process.stdout, process.stderr]) {
  const write = stream.write.bind(stream)
  stream.write = (chunk, ...rest) => { output += String(chunk); return write(chunk, ...rest) }
}
`)
}

/** 在新 profile 里按 dsh initProfile 的形态写工作区文件，再用 pnpm 安装 tarball。 */
function prepareHome() {
  return () => {
    cleanupCheckHome(HOME)
    const profile = join(HOME, 'profiles', DSH_PROFILE)
    mkdirSync(profile, { recursive: true })
    writeFileSync(join(profile, 'package.json'), `${JSON.stringify({
      name: `dsh-profile-${DSH_PROFILE}`,
      private: true,
      dependencies: {},
      dsh: { profile: { bundles: [...BUNDLES] } },
    }, null, 2)}\n`)
    writeFileSync(join(profile, 'cordis.patch.yml'), '[]\n')
    writeFileSync(join(profile, 'pnpm-workspace.yaml'), 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n')

    // 隔离前置：祖先链不得解析到组件包（否则守卫形态失真）。
    const probeRequire = createRequire(`${join(profile, 'cordis.yml')}`)
    try {
      probeRequire.resolve('@dsh-kit/dsh-plugin-proxy/package.json')
      check(false, `隔离前置：${profile} 的祖先链意外解析到组件包，换一个仓库外的隔离目录再跑`)
      return
    } catch {
      check(true, '隔离前置：profile 祖先链解析不到组件包')
    }

    // 「添加插件」的安装步骤本体：pnpm add <tarball>。registry 指向不可达地址，
    // 安装成功即证明零 registry 依赖解析（自包含契约）。
    const installed = spawnSync(process.execPath, [PNPM_CLI, 'add', '--registry=http://127.0.0.1:1', TARBALL], {
      cwd: profile,
      encoding: 'utf8',
      windowsHide: true,
    })
    const output = `${installed.stdout ?? ''}${installed.stderr ?? ''}`
    check(installed.status === 0, 'pnpm 安装 tarball 成功（不可达 registry，零依赖解析）',
      installed.status === 0 ? output.split('\n').filter(line => line.includes('dependencies') || line.includes('+')).join(' ⏎ ').slice(0, 300) : output.slice(-800))
    const manifest = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'))
    check(Object.keys(manifest.dependencies ?? {}).length === 1
      && manifest.dependencies['@dsh-kit/dsh-plugin-suite'] !== undefined,
    'profile dependencies 恰好登记套件一个包', JSON.stringify(manifest.dependencies))
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
    rpcId: 'suite-tarball',
    cleanup: false,
  })
}

async function callEntries(context, cookie) {
  const response = await fetch(`${context.base}/api/suite-tarball`, {
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

/** 轮询等待条件成立。 */
async function waitFor(context, cookie, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    try {
      // eslint-disable-next-line no-await-in-loop -- 轮询：每轮依赖上一轮结果与间隔
      last = await callEntries(context, cookie)
      if (predicate(last)) return last
    } catch {
      // 启动/重组合进行中，继续轮询
    }
    // eslint-disable-next-line no-await-in-loop -- 轮询间隔本身
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  if (last === undefined) throw new Error('等待超时：entries RPC 一直不可用')
  return last
}

function rowOf(rows, id) {
  return rows.find(row => row.id === id)
}

/** 解析首页注入的 __DSH_BOOT__ 客户端行图（与 verify-suite-client 同一解析）。 */
async function fetchClientGraph(context, cookie) {
  const index = await (await fetch(`${context.base}/`, { headers: context.browserHeaders(cookie) })).text()
  const marker = index.indexOf('__DSH_BOOT__')
  if (marker === -1) throw new Error('首页未注入 __DSH_BOOT__ 图')
  const start = index.indexOf('=', marker) + 1
  return JSON.parse(index.slice(start, index.indexOf('</script>', start)).trim().replace(/;$/, ''))
}

async function checkTarballInstall() {
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
        value => COMPONENT_ROWS.every(id => rowOf(value.rows, id)?.fiberState === FIBER_ACTIVE)
          && CORE_ROWS.every(id => rowOf(value.rows, id)?.fiberState === FIBER_ACTIVE),
        40_000)
      const missingRows = COMPONENT_ROWS.filter(id => rowOf(boot.rows, id)?.fiberState !== FIBER_ACTIVE)
      check(missingRows.length === 0, '冷启动全部组件行 ACTIVE', missingRows.join(', ') || `${String(COMPONENT_ROWS.length)} 行`)
      check(CORE_ROWS.every(id => rowOf(boot.rows, id)?.fiberState === FIBER_ACTIVE), '官方核心行保持 ACTIVE')
      const noise = FAILURE_SIGNATURES.filter(signature => boot.output.includes(signature))
      check(noise.length === 0, '进程输出没有装载报错签名', noise.join(', ') || '无')
      check(processState.alive === true, 'dsh 进程存活')

      const graph = await fetchClientGraph(context, cookie)
      const present = new Set(graph.entries.map(entry => entry.id))
      const missingClient = CLIENT_ROWS.filter(id => !present.has(id))
      const extra = [...present].filter(id => id.startsWith('@dsh-kit/') && !CLIENT_ROWS.includes(id))
      check(missingClient.length === 0, '客户端行图包含全部套件浏览器行',
        missingClient.join(', ') || `${String(CLIENT_ROWS.length)}/${String(CLIENT_ROWS.length)}（rev ${String(graph.rev)}）`)
      check(extra.length === 0, '没有套件外的 @dsh-kit 行', extra.join(', ') || '无')
    },
  })
}

async function main() {
  if (!existsSync(TARBALL)) {
    console.error(`找不到 ${TARBALL}，先运行 pnpm suite:pack`)
    process.exit(1)
  }
  try {
    prepareProbe()
    await withCheckHome({ home: HOME, prepare: prepareHome() }, async () => {
      await checkTarballInstall()
    })
  } catch (error) {
    failures += 1
    console.error(`[fail] suite tarball smoke aborted: ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
  } finally {
    cleanupCheckHome(PROBE_DIRECTORY)
    cleanupCheckHome(HOME)
  }
  console.log(failures === 0 ? '\n全部通过。' : `\n${failures} 项未通过。`)
  process.exit(failures === 0 ? 0 : 1)
}

await main()
