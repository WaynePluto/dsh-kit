/**
 * 套件首次在线启用冒烟（2026-10-12 报错的验收检查）。
 * 复现用户路径「安装完成 → 立即启用」：profile 只挂套件 junction（link: 安装形态，
 * 组件在套件自带 node_modules 更深一层），dsh 先以不含套件的 bundles 启动，运行中把
 * 套件写回 bundles——这会走插件管理器「启用」同一条 HMR 重组合路径（hmr 服务监听
 * profile package.json → reconcileProfilePatches）。断言：
 * 1. 重组合后组件行被可解析性守卫整行禁用（延迟到重启装载），不产生
 *    failed to import / did not activate / Agent resolver 报错；
 * 2. 屏障占位行当场装载，llm-pi-ai 的注入契约当场有服务可绑；
 * 3. connection 行覆写热切换后探针 RPC 仍然可用（通道归属行重启不断服务）；
 * 4. 冷重启后全部组件行装载（守卫放行）。
 * 运行：node scripts/suite-first-enable-check.mjs [--port 3105]。
 */

import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DSH_BIN, DSH_PROFILE, DEV_DIRECTORY, DSH_HOME_DEV, ROOT } from './local-config.mjs'
import { cleanupCheckHome, withCheckHome } from './lib/check-home.mjs'
import { createCheckContext, runLiveDshCheck } from './lib/check-context.mjs'

// 隔离 home 必须在仓库之外：Node 会沿祖先链向上找 node_modules，放在 .dev/ 下会
// 命中仓库根的工作区链接，守卫被放行、首启形态失真（真实桌面 profile 在用户目录下，
// 向上没有组件包）。用系统临时目录并前置断言隔离性。
const HOME = join(tmpdir(), 'dsh-kit-suite-first-enable-home')

// 「启用前」的官方基线：不含任何 @dsh-kit 行；套件启用即追加一个 Bundle，
// 与桌面「添加插件 → 立即启用」的 bundles 变化一致。
const OFF_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']

const PORT = (() => {
  const argument = process.argv.indexOf('--port')
  return argument === -1 ? 3105 : Number(process.argv[argument + 1])
})()
const PROBE_DIRECTORY = join(DEV_DIRECTORY, 'suite-first-enable-probe')
const PROBE_OVERLAY = join(PROBE_DIRECTORY, 'dsh-overlay.yml')
const PROBE_MODULE = join(PROBE_DIRECTORY, 'probe.mjs')
const SUITE_PACKAGE = '@dsh-kit/dsh-plugin-suite'
const COMPONENT_ROWS = [
  'proxy', 'agents-md', 'chat-scroll', 'preset-concise', 'copilot-auth', 'favorite-models',
  'files', 'model-capabilities', 'models-catalog', 'notify', 'services', 'skills-inspector',
  'terminal', 'tools-inspector', 'turn-retry', 'user-message-fork', 'web-search-switch', 'yolo-mode',
]
// PENDING=0、ACTIVE=2、FAILED=3（cordis FiberState 值镜像，见 dsh app-boot）。
const FIBER_ACTIVE = 2

let failures = 0

function check(ok, what, detail) {
  if (!ok) failures += 1
  console.log(`${ok ? '[ok]  ' : '[fail]'} ${what}${detail === undefined ? '' : ` — ${detail}`}`)
}

function prepareProbe() {
  mkdirSync(PROBE_DIRECTORY, { recursive: true })
  // connection 行覆写复刻套件 patch 的固定契约（宿主半 RPC 通道需要 webServer）。
  writeFileSync(PROBE_OVERLAY, [
    '- id: connection',
    '  inject: [webRuntime, webServer]',
    '  config:',
    "    trustedHosts: !!js 'ctx.webRuntime.trustedHosts'",
    '- insert:',
    '    - id: suite-first-enable-probe',
    "      name: './probe.mjs'",
    '',
  ].join('\n'))
  writeFileSync(PROBE_MODULE, `
let output = ''

export const name = 'dsh-kit-suite-first-enable-probe'
export const inject = ['loader', 'connection']

export function apply(ctx) {
  const dispose = ctx.connection.rpc.handle('/suite-first-enable', async (endpoint) => {
    if (endpoint !== 'entries') {
      return { ok: false, error: { code: 'probe/unknown-endpoint', message: 'unknown endpoint', details: {} } }
    }
    const rows = []
    for (const entry of ctx.loader.entries()) {
      if (typeof entry.options.id !== 'string') continue
      let disabled = null
      try { disabled = entry.disabled === true } catch { disabled = 'expression-error' }
      let failure
      const state = entry.fiber?.state
      if (state === 3) {
        // FAILED：恢复 fiber 记录的拒绝原因（与 dsh inactiveEntries 同构）。
        try { await entry.fiber.await() } catch (error) { failure = String(error?.stack ?? error).slice(0, 600) }
      }
      rows.push({
        id: entry.options.id,
        name: typeof entry.options.name === 'string' ? entry.options.name : null,
        disabled,
        fiberState: entry.fiber === undefined ? null : state,
        hasFiber: entry.fiber !== undefined,
        ...failure === undefined ? {} : { failure },
      })
    }
    return { ok: true, value: { rows, output } }
  })
  ctx.effect(() => () => { void dispose() }, 'suite first-enable probe')
}

// dsh 的启动与重组合日志走 process 流；探针进程内留一份用于断言报错签名。
for (const stream of [process.stdout, process.stderr]) {
  const write = stream.write.bind(stream)
  stream.write = (chunk, ...rest) => { output += String(chunk); return write(chunk, ...rest) }
}
`)
}

/** 首启形态：profile 只挂套件 junction（无 hoisted 闭包），bundles 不含套件。 */
function prepareFirstEnableHome(withSuite) {
  return () => {
    cleanupCheckHome(HOME)
    const profile = join(HOME, 'profiles', DSH_PROFILE)
    mkdirSync(join(profile, 'node_modules', '@dsh-kit'), { recursive: true })
    symlinkSync(join(ROOT, 'plugins', 'suite'), join(profile, 'node_modules', '@dsh-kit', 'dsh-plugin-suite'), 'junction')
    writeManifest(profile, withSuite)
    writeFileSync(join(profile, 'cordis.patch.yml'), '[]\n')
    writeFileSync(join(profile, 'pnpm-workspace.yaml'), 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n')
    // 前置断言隔离性：祖先链上不能解析到组件包，否则守卫会被放行、首启形态失真。
    const require = createRequire(`${pathToFileURL(profile).href}/`)
    try {
      require.resolve('@dsh-kit/dsh-plugin-proxy/package.json')
      check(false, `隔离前置：${profile} 的祖先链意外解析到组件包，换一个仓库外的隔离目录再跑`)
    } catch {
      check(true, '隔离前置：profile 祖先链解析不到组件包（守卫只能看到套件 junction）')
    }
  }
}

function writeManifest(profile, withSuite) {
  const bundles = withSuite ? [...OFF_BUNDLES, SUITE_PACKAGE] : [...OFF_BUNDLES]
  writeFileSync(join(profile, 'package.json'), `${JSON.stringify({
    name: `dsh-profile-${DSH_PROFILE}`,
    private: true,
    dependencies: {},
    dsh: { profile: { bundles } },
  }, null, 2)}\n`)
}

function makeContext() {
  return createCheckContext({
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
    rpcId: 'suite-first-enable',
    cleanup: false,
  })
}

async function callEntries(context, cookie) {
  const response = await context.rpcRequest({ path: '/suite-first-enable/entries', method: 'entries', payload: {}, cookie })
  const result = response.body?.result
  if (response.status !== 200 || result?.ok !== true) {
    throw new Error(`entries RPC 失败：HTTP ${String(response.status)} ${JSON.stringify(response.body).slice(0, 200)}`)
  }
  return result.value
}

/** 轮询等待重组合生效（hmr watch 有写入稳定去抖；connection 行热切换瞬间通道可能短暂拒绝）。 */
async function waitFor(context, cookie, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    try {
      last = await callEntries(context, cookie)
      if (predicate(last)) return last
    } catch {
      // 重组合进行中，继续轮询
    }
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  if (last === undefined) throw new Error('等待重组合超时：entries RPC 一直不可用')
  return last
}

function rowOf(rows, id) {
  return rows.find(row => row.id === id)
}

/** 第一阶段：运行中把套件写回 bundles，断言守卫延迟装载且服务不断。 */
async function checkFirstEnable() {
  const context = makeContext()
  await runLiveDshCheck(context, {
    startedAssertions: ({ child }) => {
      child.alive = true
      child.on('exit', () => { child.alive = false })
    },
    liveAssertions: async ({ cookie }) => {
      const before = await callEntries(context, cookie)
      check(rowOf(before.rows, 'proxy') === undefined, '启用前套件组件行不在装载树中')

      writeManifest(join(HOME, 'profiles', DSH_PROFILE), true)
      const after = await waitFor(context, cookie, value => rowOf(value.rows, 'proxy') !== undefined, 40_000)
      // 重组合的行重启有先后（llm → 注入方），等官方核心行回稳（session-controller
      // 命中上游竞态时停在 FAILED，也算终态）再断言。
      const settled = await waitFor(context, cookie,
        value => (rowOf(value.rows, 'session-controller')?.fiberState ?? 0) !== 0
          && rowOf(value.rows, 'connection')?.fiberState === FIBER_ACTIVE
          && rowOf(value.rows, 'llm-pi-ai')?.fiberState === FIBER_ACTIVE,
        30_000)
      const rows = settled.rows

      const deferred = COMPONENT_ROWS.filter(id => rowOf(rows, id)?.disabled !== true)
      check(deferred.length === 0, '重组合后全部组件行被守卫禁用（延迟到重启装载）', `未禁用：${deferred.join(', ') || '无'}`)
      const importFailed = COMPONENT_ROWS.filter(id => rowOf(rows, id)?.hasFiber === true && rowOf(rows, id)?.fiberState !== FIBER_ACTIVE)
      check(importFailed.length === 0, '没有组件行进入 failed/pending 装载态', importFailed.join(', ') || '无')

      const fallback = rowOf(rows, 'dsh-kit-model-bootstrap-fallback')
      check(fallback?.name === `${SUITE_PACKAGE}/fallback` && fallback?.fiberState === FIBER_ACTIVE,
        '屏障占位行当场装载（子路径可解析）', JSON.stringify(fallback))
      check(rowOf(rows, 'llm-pi-ai')?.fiberState === FIBER_ACTIVE, 'llm-pi-ai 屏障注入当场绑定（ ACTIVE）')
      {
        // 上游已知竞态（dsh 0.2.0，见 docs/05-roadmap.md「上游竞态观察」）：重组合中
        // llm-pi-ai 覆写行重启 llm，session-controller 作为 llm 依赖方随之重挂载，其内嵌
        // file-upload 在旧注册未释放时二次注册。kit 侧无法规避（覆写行 disabled 会连官方
        // 基础行一起禁用）；按精确签名豁免，出现任何其他失败形态仍然响亮失败。
        // 上游修复后应改回断言 ACTIVE 并移除此豁免。
        const UPSTREAM_RACE = 'file-upload: Agent resolver is already registered'
        const sessionController = rowOf(rows, 'session-controller')
        const inactive = rows.filter(row => row.hasFiber && row.fiberState !== FIBER_ACTIVE)
          .map(row => `${row.id}(${String(row.fiberState)})`)
        if (sessionController?.fiberState === FIBER_ACTIVE) {
          check(true, 'session-controller 未受重组合影响（上游竞态已修复？请移除豁免断言）')
        } else {
          check(sessionController?.failure?.split('\n')[0] === `Error: ${UPSTREAM_RACE}`,
            'session-controller 只剩已记录的上游重挂载竞态（其他失败形态不允许）',
            `${inactive.join('、')} — ${String(sessionController?.failure?.split('\n')[0])}`)
        }
      }
      check(rowOf(rows, 'connection')?.fiberState === FIBER_ACTIVE, 'connection 行覆写热切换后恢复 ACTIVE')

      const noise = ['did not activate', 'failed to import', 'Agent resolver is already registered']
        .filter(signature => settled.output.includes(signature))
      check(noise.length === 0, '进程输出没有启用报错签名', noise.join('；') || '无')
    },
  })
}

/** 第二阶段：冷重启同一 profile，断言守卫放行、全部组件行装载（yolo 默认停用除外）。 */
async function checkColdRestart() {
  const context = makeContext()
  await runLiveDshCheck(context, {
    liveAssertions: async ({ cookie }) => {
      const boot = await callEntries(context, cookie)
      const loadable = COMPONENT_ROWS.filter(id => id !== 'yolo-mode')
      const loaded = loadable.filter(id => rowOf(boot.rows, id)?.disabled !== false || rowOf(boot.rows, id)?.fiberState !== FIBER_ACTIVE)
      check(loaded.length === 0, '冷重启后全部组件行装载（守卫放行）', `未装载：${loaded.join(', ') || '无'}`)
      const yolo = rowOf(boot.rows, 'yolo-mode')
      check(yolo?.disabled === true, '冷重启后 yolo-mode 保持默认停用', JSON.stringify(yolo))
      const fallback = rowOf(boot.rows, 'dsh-kit-model-bootstrap-fallback')
      check(fallback?.fiberState === FIBER_ACTIVE, '冷重启后屏障占位行仍装载', JSON.stringify(fallback))
      check(rowOf(boot.rows, 'session-controller')?.fiberState === FIBER_ACTIVE, '冷重启后 session-controller 正常')
    },
  })
}

async function main() {
  try {
    prepareProbe()
    await withCheckHome({ home: HOME, prepare: prepareFirstEnableHome(false) }, async () => {
      await checkFirstEnable()
      await checkColdRestart()
    })
  } catch (error) {
    failures += 1
    console.error(`[fail] suite first-enable smoke aborted: ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
  } finally {
    cleanupCheckHome(PROBE_DIRECTORY)
    cleanupCheckHome(HOME)
  }
  console.log(failures === 0 ? '\n全部通过。' : `\n${failures} 项未通过。`)
  process.exit(failures === 0 ? 0 : 1)
}

await main()
