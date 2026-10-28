/**
 * 套件更新通道冒烟（suite-updates 组件的验收检查）。
 * 在隔离 home 的新 profile 里安装正式 tarball，以套件在 bundles 内冷启动真实
 * dsh——组件行自身注册 kit 私有通道 `/api/suite-updates`（kit 信封，D16），脚本
 * 以浏览器身份直接调用 `check` 端点（无探针 overlay，验证的就是组件自己的通道）。
 * 断言：
 * 1. check 返回 ok，current 为套件 manifest 版本（来自 pluginManager Bundle 清单）；
 * 2. url 是带 tag 的固定名资产地址（D21 形式），latest 与 tag 一致；
 * 3. hasUpdate 与「latest 与 current 的比较」一致（真实 GitHub 数据，方向不定都算过）；
 * 4. 未知端点被拒（kit 信封故障码）。
 * 运行：pnpm suite:pack && node scripts/suite-updates-check.mjs [--port 3109]。
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { DSH_BIN, DSH_PROFILE, PNPM_CLI, PLUGINS_DIRECTORY, ROOT } from './local-config.mjs'
import { cleanupCheckHome, withCheckHome } from './lib/check-home.mjs'
import { createCheckContext, runLiveDshCheck } from './lib/check-context.mjs'

const HOME = join(tmpdir(), 'dsh-kit-suite-updates-home')
const SUITE_PACKAGE = '@dsh-kit/dsh-plugin-suite'
const CHANNEL_PATH = '/api/suite-updates'

const PORT = (() => {
  const argument = process.argv.indexOf('--port')
  return argument === -1 ? 3109 : Number(process.argv[argument + 1])
})()
// 组件行清单从 plugin-catalog.json 派生（套件包含全部分发组件）。
const COMPONENT_ROWS = JSON.parse(readFileSync(join(ROOT, 'plugin-catalog.json'), 'utf8'))
  .distributions.flatMap(distribution => distribution.components.map(component => component.rowId))
const SUITE_VERSION = JSON.parse(readFileSync(join(PLUGINS_DIRECTORY, 'suite', 'package.json'), 'utf8')).version
const TARBALL = join(ROOT, 'release', `v${SUITE_VERSION}`, 'dsh-kit.tar.gz')
const BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', SUITE_PACKAGE]

let failures = 0

function check(ok, what, detail) {
  if (!ok) failures += 1
  console.log(`${ok ? '[ok]  ' : '[fail]'} ${what}${detail === undefined ? '' : ` — ${detail}`}`)
}

function prepareHome() {
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

  const installed = spawnSync(process.execPath, [PNPM_CLI, 'add', '--registry=http://127.0.0.1:1', TARBALL], {
    cwd: profile,
    encoding: 'utf8',
    windowsHide: true,
  })
  const output = `${installed.stdout ?? ''}${installed.stderr ?? ''}`
  check(installed.status === 0, 'pnpm 安装 tarball 成功（不可达 registry，零依赖解析）',
    installed.status === 0 ? `version ${SUITE_VERSION}` : output.slice(-800))
}

function makeContext() {
  return createCheckContext({
    dshBin: DSH_BIN,
    profile: DSH_PROFILE,
    overlays: () => [],
    home: HOME,
    cwd: ROOT,
    port: PORT,
    trustedHost: `127.0.0.1:${PORT}`,
    tokenPattern: /dsh web:\s*\S+?[?&]token=([\w.-]+)/u,
    timeoutMessage: (output) => 'dsh 90 秒内没有打印访问地址：\n' + output,
    exitMessage: (code, output) => 'dsh 退出（code ' + code + '）：\n' + output,
    rpcId: 'suite-updates',
    cleanup: false,
  })
}

async function callChannel(context, cookie, body) {
  const response = await fetch(`${context.base}${CHANNEL_PATH}`, {
    method: 'POST',
    headers: {
      ...context.browserHeaders(cookie),
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  let parsed
  try { parsed = await response.json() } catch { parsed = undefined }
  return { status: response.status, body: parsed }
}

/** 等套件组件行装载完成（check 端点可用即代表宿主半已激活）。 */
async function waitForChannel(context, cookie, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    try {
      // eslint-disable-next-line no-await-in-loop -- 轮询：每轮依赖上一轮结果与间隔
      last = await callChannel(context, cookie, { endpoint: 'check', payload: {} })
      if (last.status === 200 && last.body?.ok === true) return last
    } catch {
      // 启动/重组合进行中，继续轮询
    }
    // eslint-disable-next-line no-await-in-loop -- 轮询间隔本身
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  return last
}

async function checkUpdatesChannel() {
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
      const settled = await waitForChannel(context, cookie, 60_000)
      const value = settled?.body?.ok === true ? settled.body.value : undefined
      check(value !== undefined, 'check 端点返回 ok（组件通道在线）',
        value === undefined ? JSON.stringify(settled?.body).slice(0, 300) : `current ${String(value.current)}`)
      if (value === undefined) return
      check(value.current === SUITE_VERSION, 'current 为套件 manifest 版本', `${String(value.current)}（期望 ${SUITE_VERSION}）`)
      check(value.tag === `v${value.latest}`, 'latest 与 tag 去前缀一致', `${String(value.tag)} / ${String(value.latest)}`)
      check(typeof value.url === 'string' && /^https:\/\/github\.com\/WaynePluto\/dsh-kit\/releases\/download\/v[\w.-]+\/dsh-kit\.tar\.gz$/u.test(value.url),
        'url 为带 tag 的固定名资产地址（D21 形式）', String(value.url))
      const expectedUpdate = String(value.latest) !== SUITE_VERSION
        && String(value.latest) > SUITE_VERSION
      check(typeof value.hasUpdate === 'boolean', 'hasUpdate 为布尔值', String(value.hasUpdate))
      if (!expectedUpdate) {
        check(value.hasUpdate === false, '本机已发布最新版，hasUpdate=false', `latest ${String(value.latest)}`)
      }

      const refused = await callChannel(context, cookie, { endpoint: 'nope', payload: {} })
      check(refused.status === 200 && refused.body?.ok === false
        && refused.body?.error?.code === 'suite-updates/unknown-endpoint',
      '未知端点被拒（kit 信封故障码）', JSON.stringify(refused.body?.error).slice(0, 200))
      check(processState.alive === true, 'dsh 进程存活')
      console.log(`[info] 组件行清单 ${String(COMPONENT_ROWS.length)} 行（行装载由 suite-upgrade-check / suite-tarball-check 覆盖）`)
    },
  })
}

async function main() {
  if (!existsSync(TARBALL)) {
    console.error(`找不到 ${TARBALL}，先运行 pnpm suite:pack`)
    process.exit(1)
  }
  try {
    await withCheckHome({ home: HOME, prepare: prepareHome }, async () => {
      await checkUpdatesChannel()
    })
  } catch (error) {
    failures += 1
    console.error(`[fail] suite updates smoke aborted: ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
  } finally {
    cleanupCheckHome(HOME)
  }
  console.log(failures === 0 ? '\n全部通过。' : `\n${String(failures)} 项未通过。`)
  process.exit(failures === 0 ? 0 : 1)
}

await main()
