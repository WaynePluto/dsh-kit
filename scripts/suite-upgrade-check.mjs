/**
 * 套件原地升级冒烟（版本化资产地址在线升级路径的验收检查，D21）。
 * 复现用户路径「已安装旧版套件 → 插件页『添加插件』输入新版资产地址」：
 * 隔离 profile 先用 pnpm 安装旧版 tarball（与 release/dsh-kit-<version>.tar.gz
 * 同一棵自包含树，仅 package.json 的 version 改成 <version>-smoke-old），以套件在
 * bundles 内冷启动真实 dsh，运行中经探针调用官方插件管理器 installBundle 安装新版
 * tarball。本地路径与 GitHub Release URL 走 pnpm 同一条 plain-tarball 路径，且
 * already-installed 判定只做 spec 字符串与已存依赖值的比对——两个互不相同的本地
 * 路径与两个互不相同的版本化 URL 等价。断言：
 * 1. 在线升级被接受（不要求先卸载）：ChangeResult 无 error、version 为新版、
 *    application=applied（HMR 在线生效，不是 restart-required）；
 * 2. 升级后全部组件行（plugin-catalog 派生）重新 ACTIVE，官方核心行保持 ACTIVE；
 * 3. profile 依赖值换成新 spec，安装目录 package.json 的 version 为新版；
 * 4. 同一 spec 重复安装被拒为 already-installed（同地址重装的契约边界，固定
 *    latest/download 名升级不可用的原因），行不受扰动；
 * 5. 全程输出没有 failed to import / did not activate / Agent resolver 签名；
 * 6. 升级后首页 __DSH_BOOT__ 客户端行图仍完整。
 * 运行：pnpm suite:pack && node scripts/suite-upgrade-check.mjs [--port 3108]。
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { delimiter, join, basename, dirname } from 'node:path'
import { DEV_DIRECTORY, DSH_BIN, DSH_PROFILE, PNPM_CLI, PLUGINS_DIRECTORY, ROOT } from './local-config.mjs'
import { cleanupCheckHome, withCheckHome } from './lib/check-home.mjs'
import { createCheckContext, runLiveDshCheck } from './lib/check-context.mjs'

const HOME = join(tmpdir(), 'dsh-kit-suite-upgrade-home')
const SUITE_PACKAGE = '@dsh-kit/dsh-plugin-suite'
const UPGRADE_DIRECTORY = join(DEV_DIRECTORY, 'suite-upgrade')

const PORT = (() => {
  const argument = process.argv.indexOf('--port')
  return argument === -1 ? 3108 : Number(process.argv[argument + 1])
})()
const PROBE_DIRECTORY = join(DEV_DIRECTORY, 'suite-upgrade-probe')
const PROBE_OVERLAY = join(PROBE_DIRECTORY, 'dsh-overlay.yml')
const PROBE_MODULE = join(PROBE_DIRECTORY, 'probe.mjs')
// 组件行清单从 plugin-catalog.json 派生（套件包含全部分发组件，组件增减时自动同步）。
const COMPONENT_ROWS = JSON.parse(readFileSync(join(ROOT, 'plugin-catalog.json'), 'utf8'))
  .distributions.flatMap(distribution => distribution.components.map(component => component.rowId))
const CLIENT_ROWS = COMPONENT_ROWS.map(id => `@dsh-kit/dsh-plugin-${id}`)
// PENDING=0、ACTIVE=2、FAILED=3（cordis FiberState 值镜像，见 dsh app-boot）。
const FIBER_ACTIVE = 2
const CORE_ROWS = ['llm-pi-ai', 'connection', 'file-upload', 'session-controller']
const FAILURE_SIGNATURES = ['failed to import', 'did not activate', 'Agent resolver is already registered']

const SUITE_VERSION = JSON.parse(readFileSync(join(PLUGINS_DIRECTORY, 'suite', 'package.json'), 'utf8')).version
const OLD_VERSION = `${SUITE_VERSION}-smoke-old`
const NEW_TARBALL = join(ROOT, 'release', `v${SUITE_VERSION}`, 'dsh-kit.tar.gz')
const OLD_TARBALL = join(UPGRADE_DIRECTORY, `dsh-kit-${OLD_VERSION}.tar.gz`)

const BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', SUITE_PACKAGE]

let failures = 0

function check(ok, what, detail) {
  if (!ok) failures += 1
  console.log(`${ok ? '[ok]  ' : '[fail]'} ${what}${detail === undefined ? '' : ` — ${detail}`}`)
}

/** 把 release tarball 改一个 version 字符串重新打包成「旧版」，其余字节不动。 */
function prepareOldTarball() {
  if (!existsSync(NEW_TARBALL)) {
    console.error(`找不到 ${NEW_TARBALL}，先运行 pnpm suite:pack`)
    process.exit(1)
  }
  rmSync(UPGRADE_DIRECTORY, { recursive: true, force: true })
  mkdirSync(UPGRADE_DIRECTORY, { recursive: true })
  const staging = join(UPGRADE_DIRECTORY, 'staging')
  mkdirSync(staging, { recursive: true })
  // 归档参数用相对路径（GNU tar 会把绝对路径里的 `D:` 当远程主机），-C 参数统一
  // 正斜杠（MSYS GNU tar 不认反斜杠绝对路径，System32 bsdtar 两种都认）。
  const extract = spawnSync('tar', ['-xzf', basename(NEW_TARBALL), '-C', staging.replace(/\\/gu, '/')],
    { cwd: dirname(NEW_TARBALL), stdio: 'pipe', encoding: 'utf8' })
  if (extract.status !== 0) throw new Error(`解包 ${NEW_TARBALL} 失败：${extract.stderr}`)
  const manifestPath = join(staging, 'package', 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (manifest.name !== SUITE_PACKAGE) throw new Error(`tarball 包名 ${manifest.name} 不是套件`)
  manifest.version = OLD_VERSION
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  const pack = spawnSync('tar', ['-czf', basename(OLD_TARBALL), '-C', staging.replace(/\\/gu, '/'), 'package'],
    { cwd: UPGRADE_DIRECTORY, stdio: 'pipe', encoding: 'utf8' })
  if (pack.status !== 0) throw new Error(`打包旧版 tarball 失败：${pack.stderr}`)
  rmSync(staging, { recursive: true, force: true })
  console.log(`旧版 tarball：${OLD_TARBALL}（version ${OLD_VERSION}）`)
}

/** dsh 进程内插件管理器调用的 pnpm 固定用开发运行时版本：生成 dev-suite 同款 shim 并前置 PATH。 */
function preparePnpmShim() {
  const shimDirectory = join(DEV_DIRECTORY, 'pnpm-shim')
  mkdirSync(shimDirectory, { recursive: true })
  writeFileSync(join(shimDirectory, 'pnpm.cmd'), `@"${process.execPath}" "${PNPM_CLI}" %*\r\n`)
  writeFileSync(join(shimDirectory, 'pnpm'), `#!/bin/sh\nexec '${process.execPath}' '${PNPM_CLI}' "$@"\n`)
  process.env.PATH = `${shimDirectory}${process.env.PATH ? `${delimiter}${process.env.PATH}` : ''}`
}

function prepareProbe() {
  mkdirSync(PROBE_DIRECTORY, { recursive: true })
  // 探针通道走官方 connection.fetch.register 的 /api 精确路由（kit 信封，D16）；
  // installBundle 直调官方插件管理器服务，与插件页按钮同一方法。
  writeFileSync(PROBE_OVERLAY, [
    '- insert:',
    '    - id: suite-upgrade-probe',
    "      name: './probe.mjs'",
    '',
  ].join('\n'))
  writeFileSync(PROBE_MODULE, `
let output = ''

export const name = 'dsh-kit-suite-upgrade-probe'
export const inject = ['loader', 'connection', 'pluginManager']

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
        path: '/api/suite-upgrade',
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
            let body
            try { body = await request.json() } catch { body = undefined }
            const endpoint = typeof body === 'object' && body !== null ? body.endpoint : undefined
            try {
                if (endpoint === 'entries') return Response.json(await entries(ctx))
                if (endpoint === 'install') {
                    const result = await ctx.pluginManager.installBundle(String(body.spec ?? ''))
                    return Response.json({ ok: true, value: { result } })
                }
                return Response.json({ ok: false, error: { code: 'probe/unknown-endpoint', message: 'unknown endpoint', details: {} } })
            } catch (error) {
                return Response.json({ ok: false, error: { code: 'probe/internal', message: String(error), details: {} } })
            }
        },
    })
    ctx.effect(() => () => { void dispose() }, 'suite upgrade probe')
}

for (const stream of [process.stdout, process.stderr]) {
    const write = stream.write.bind(stream)
    stream.write = (chunk, ...rest) => { output += String(chunk); return write(chunk, ...rest) }
}
`)
}

function profileManifestPath() {
  return join(HOME, 'profiles', DSH_PROFILE, 'package.json')
}

function installedSuiteVersion() {
  return JSON.parse(readFileSync(
    join(HOME, 'profiles', DSH_PROFILE, 'node_modules', SUITE_PACKAGE, 'package.json'),
    'utf8',
  )).version
}

function recordedSuiteSpec() {
  const manifest = JSON.parse(readFileSync(profileManifestPath(), 'utf8'))
  return manifest.dependencies?.[SUITE_PACKAGE]
}

/** 在新 profile 里按 dsh initProfile 的形态写工作区文件，再用 pnpm 安装旧版 tarball。 */
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

    // 「添加插件」的安装步骤本体：pnpm add <旧版 tarball>。registry 指向不可达地址，
    // 安装成功即证明零 registry 依赖解析（自包含契约）。
    const installed = spawnSync(process.execPath, [PNPM_CLI, 'add', '--registry=http://127.0.0.1:1', OLD_TARBALL], {
      cwd: profile,
      encoding: 'utf8',
      windowsHide: true,
    })
    const output = `${installed.stdout ?? ''}${installed.stderr ?? ''}`
    check(installed.status === 0, `pnpm 安装旧版 tarball 成功（不可达 registry，零依赖解析）`,
      installed.status === 0 ? `version ${installedSuiteVersion()}` : output.slice(-800))
    check(installedSuiteVersion() === OLD_VERSION, '安装目录 version 为旧版', installedSuiteVersion())
    check(recordedSuiteSpec() !== undefined && recordedSuiteSpec() !== NEW_TARBALL,
      'profile 依赖值记录旧版 spec', String(recordedSuiteSpec()))
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
    rpcId: 'suite-upgrade',
    cleanup: false,
  })
}

async function callProbe(context, cookie, payload) {
  const response = await fetch(`${context.base}/api/suite-upgrade`, {
    method: 'POST',
    headers: {
      ...context.browserHeaders(cookie),
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  let body
  try { body = await response.json() } catch { body = undefined }
  if (response.status !== 200 || body?.ok !== true) {
    throw new Error(`探针 RPC 失败：HTTP ${String(response.status)} ${JSON.stringify(body).slice(0, 200)}`)
  }
  return body.value
}

/** 轮询等待条件成立（HMR 重组合与 pnpm 安装都有写入稳定期）。 */
async function waitFor(context, cookie, call, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    try {
      // eslint-disable-next-line no-await-in-loop -- 轮询：每轮依赖上一轮结果与间隔
      last = await call(context, cookie)
      if (predicate(last)) return last
    } catch {
      // 重组合进行中，继续轮询
    }
    // eslint-disable-next-line no-await-in-loop -- 轮询间隔本身
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  if (last === undefined) throw new Error('等待超时：探针 RPC 一直不可用')
  return last
}

async function callEntries(context, cookie) {
  return callProbe(context, cookie, { endpoint: 'entries', payload: {} })
}

async function callInstall(context, cookie, spec) {
  return callProbe(context, cookie, { endpoint: 'install', spec })
}

function rowOf(rows, id) {
  return rows.find(row => row.id === id)
}

function allRowsActive(value) {
  return COMPONENT_ROWS.every(id => rowOf(value.rows, id)?.fiberState === FIBER_ACTIVE)
    && CORE_ROWS.every(id => rowOf(value.rows, id)?.fiberState === FIBER_ACTIVE)
}

/** 解析首页注入的 __DSH_BOOT__ 客户端行图（与 verify-suite-client 同一解析）。 */
async function fetchClientGraph(context, cookie) {
  const index = await (await fetch(`${context.base}/`, { headers: context.browserHeaders(cookie) })).text()
  const marker = index.indexOf('__DSH_BOOT__')
  if (marker === -1) throw new Error('首页未注入 __DSH_BOOT__ 图')
  const start = index.indexOf('=', marker) + 1
  return JSON.parse(index.slice(start, index.indexOf('</script>', start)).trim().replace(/;$/, ''))
}

/** 旧版冷启动装载 → 在线安装新版（原地替换）→ 同 spec 重装被拒，全程断言核心行稳定。 */
async function checkUpgrade() {
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
      const boot = await waitFor(context, cookie, callEntries, allRowsActive, 40_000)
      check(boot.rows.filter(row => COMPONENT_ROWS.includes(row.id)).length === COMPONENT_ROWS.length,
        '冷启动：旧版全部组件行 ACTIVE', `${String(COMPONENT_ROWS.length)} 行`)
      check(CORE_ROWS.every(id => rowOf(boot.rows, id)?.fiberState === FIBER_ACTIVE), '冷启动：官方核心行 ACTIVE')
      check(installedSuiteVersion() === OLD_VERSION, '冷启动：装载的是旧版', installedSuiteVersion())
      const oldSpec = recordedSuiteSpec()

      // ── 在线升级（用户路径：插件页输入新版资产地址，不先卸载）──
      const install = await callInstall(context, cookie, NEW_TARBALL)
      const result = install.result
      check(result.error === undefined, '升级安装未被拒绝（无需先卸载）',
        result.error === undefined ? undefined : JSON.stringify(result.error).slice(0, 400))
      check(result.changed === true && result.bundle === SUITE_PACKAGE, '升级安装登记套件包',
        `${String(result.bundle)} changed=${String(result.changed)}`)
      check(result.version === SUITE_VERSION, '安装结果 version 为新版', String(result.version))
      check(result.application === 'applied', '在线热生效（application=applied，非 restart-required）',
        String(result.application))
      if (result.error !== undefined) return

      const upgraded = await waitFor(context, cookie, callEntries, allRowsActive, 40_000)
      check(COMPONENT_ROWS.every(id => rowOf(upgraded.rows, id)?.fiberState === FIBER_ACTIVE),
        '升级后：全部组件行重新 ACTIVE', `${String(COMPONENT_ROWS.length)} 行`)
      check(CORE_ROWS.every(id => rowOf(upgraded.rows, id)?.fiberState === FIBER_ACTIVE), '升级后：官方核心行保持 ACTIVE')
      check(installedSuiteVersion() === SUITE_VERSION, '升级后：安装目录 version 为新版', installedSuiteVersion())
      const newSpec = recordedSuiteSpec()
      check(newSpec !== undefined && newSpec !== oldSpec, '升级后：profile 依赖值换成新 spec', String(newSpec))

      // ── 同 spec 重装被拒（固定 latest/download 名升级不可用的契约边界）──
      const refused = (await callInstall(context, cookie, NEW_TARBALL)).result
      check(refused.error?.code === 'already-installed', '同 spec 重复安装被拒为 already-installed',
        JSON.stringify(refused.error).slice(0, 300))
      const settled = await waitFor(context, cookie, callEntries, allRowsActive, 15_000)
      check(COMPONENT_ROWS.every(id => rowOf(settled.rows, id)?.fiberState === FIBER_ACTIVE),
        '拒绝重装后：行不受扰动')

      const noise = FAILURE_SIGNATURES.filter(signature => settled.output.includes(signature))
      check(noise.length === 0, '全程输出没有装载报错签名', noise.join(', ') || '无')
      check(processState.alive === true, 'dsh 进程存活')

      const graph = await fetchClientGraph(context, cookie)
      const present = new Set(graph.entries.map(entry => entry.id))
      const missingClient = CLIENT_ROWS.filter(id => !present.has(id))
      check(missingClient.length === 0, '升级后客户端行图完整',
        missingClient.join(', ') || `${String(CLIENT_ROWS.length)}/${String(CLIENT_ROWS.length)}（rev ${String(graph.rev)}）`)
    },
  })
}

async function main() {
  try {
    prepareOldTarball()
    preparePnpmShim()
    prepareProbe()
    await withCheckHome({ home: HOME, prepare: prepareHome() }, async () => {
      await checkUpgrade()
    })
  } catch (error) {
    failures += 1
    console.error(`[fail] suite upgrade smoke aborted: ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
  } finally {
    cleanupCheckHome(PROBE_DIRECTORY)
    cleanupCheckHome(HOME)
    rmSync(UPGRADE_DIRECTORY, { recursive: true, force: true })
  }
  console.log(failures === 0 ? '\n全部通过。' : `\n${String(failures)} 项未通过。`)
  process.exit(failures === 0 ? 0 : 1)
}

await main()
