// 开发入口（替代已退役的 dev-stack）：准备隔离 dsh 运行时 → 构建套件 →
// 在隔离 home 准备开发 profile（base + web-app + station-suite）→ 启动 dsh web。
//
// 与正式实例互不干扰：DSH_HOME=~/.dsh-dev、station home=~/.dsh-station-dev、
// dsh 端口 3180、relay 端口 31809（经 dev home 的配置文件下发）。
// 用法：node scripts/dev-suite.mjs [--built]（--built 跳过插件构建，仅复用现有产物）。
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureDevelopmentRuntime } from './dev-runtime.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const DSH_HOME = join(homedir(), '.dsh-dev')
const STATION_HOME = join(homedir(), '.dsh-station-dev')
const PROFILE = 'dsh-station-dev'
const DSH_PORT = 3180
const RELAY_PORT = 31_809
const SUITE_DIRECTORY = join(ROOT, 'packages', 'plugins', 'station-suite')
const DSH_VERSION = '0.2.0-rc.2'
const SUITE_PACKAGE = '@dsh-station/dsh-plugin-station-suite'

const runtime = await ensureDevelopmentRuntime()
const dshEnv = { ...process.env, DSH_HOME }

function runDshCli(args) {
  const result = spawnSync(process.execPath, [runtime.dshBin, 'plugin', `--profile=${PROFILE}`, ...args], {
    cwd: ROOT, env: dshEnv, encoding: 'utf8',
  })
  if (result.status !== 0) {
    throw new Error(`dsh plugin ${args.join(' ')} 失败：${result.stdout ?? ''}${result.stderr ?? ''}`)
  }
  return result
}

if (!process.argv.includes('--built')) {
  const plugins = spawnSync('pnpm', ['plugins:build'], { cwd: ROOT, stdio: 'inherit', shell: true })
  if (plugins.status !== 0) throw new Error('pnpm plugins:build 失败')
  const suite = spawnSync(process.execPath, ['scripts/build-suite.mjs'], { cwd: ROOT, stdio: 'inherit' })
  if (suite.status !== 0) throw new Error('build-suite.mjs 失败')
}

const profileDirectory = join(DSH_HOME, 'profiles', PROFILE)
const manifestPath = join(profileDirectory, 'package.json')
if (!existsSync(manifestPath)) {
  mkdirSync(profileDirectory, { recursive: true })
  writeFileSync(manifestPath, `${JSON.stringify({
    name: `dsh-profile-${PROFILE}`, private: true, dependencies: {},
    dsh: { profile: { bundles: [] } },
  }, undefined, 2)}\n`)
  writeFileSync(join(profileDirectory, 'cordis.patch.yml'), '[]\n')
  // pnpm 12 会在安装官方闭包时写入 allowBuilds 占位并硬失败；显式置 false（预编译产物）。
  writeFileSync(join(profileDirectory, 'pnpm-workspace.yaml'),
    'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\nallowBuilds:\n  koffi: false\n  esbuild: false\n  node-pty: false\n  protobufjs: false\n')
}
runDshCli(['add', `@deepseek-ai/dsh-base@${DSH_VERSION}`, `@deepseek-ai/dsh-web-app@${DSH_VERSION}`, SUITE_DIRECTORY])

// add 只写依赖不写 bundles（官方包与套件均如此）；装载清单由本脚本收口。
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
manifest.dsh ??= {}
manifest.dsh.profile ??= {}
manifest.dsh.profile.bundles = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', SUITE_PACKAGE]
writeFileSync(manifestPath, `${JSON.stringify(manifest, undefined, 2)}\n`)

// dev 的 relay 端口与正式实例（30809）错开，经 station home 配置文件下发。
mkdirSync(STATION_HOME, { recursive: true })
const stationConfigPath = join(STATION_HOME, 'dsh-station.config.json')
if (!existsSync(stationConfigPath)) {
  writeFileSync(stationConfigPath, `${JSON.stringify({ relay: { port: RELAY_PORT } }, undefined, 2)}\n`)
}

process.stdout.write(`开发实例：profile=${PROFILE} dsh=http://127.0.0.1:${DSH_PORT} relay 端口=${RELAY_PORT}\n`)
const child = spawn(process.execPath, [runtime.dshBin, PROFILE, `--port=${DSH_PORT}`, '--no-open'], {
  cwd: ROOT, stdio: 'inherit', env: { ...dshEnv, DSH_STATION_HOME: STATION_HOME },
})
child.on('close', code => process.exit(code ?? 0))
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { child.kill(signal) })
}
