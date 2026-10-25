// 开发入口：准备隔离 dsh 运行时 → 构建套件 →
// 在隔离 home 准备开发 profile（base + web-app + suite）→ 启动 dsh web。
//
// 与日常实例互不干扰：DSH_HOME=~/.dsh-dev、dsh 端口 3180。
// 用法：node scripts/dev-suite.mjs [--built]（--built 跳过插件构建，仅复用现有产物）。
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureDevelopmentRuntime } from './dev-runtime.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const DSH_HOME = join(homedir(), '.dsh-dev')
const PROFILE = 'dsh-kit-dev'
const DSH_PORT = 3180
const SUITE_DIRECTORY = join(ROOT, 'plugins', 'suite')
const DSH_VERSION = '0.2.1-rc.3'
const SUITE_PACKAGE = '@dsh-kit/dsh-plugin-suite'

const runtime = await ensureDevelopmentRuntime()
// dsh 调用的 pnpm 固定用运行时自带的版本（见 dev-runtime.mjs 的版本注释）：
// `pnpm dev` 会给脚本 PATH 前置其自身的 node 安装目录，那里的 pnpm 10.17.0 在
// Windows 把 link:<盘符绝对路径> 当相对路径生成坏符号链接，套件 junction 会指向
// 不存在路径，add 的 reconcile 随即失败。pnpm ≥11 的包内 bin 改为原生二进制布局，
// runtime 以 --ignore-scripts 安装后其自带 .bin shim 不可用，这里生成指向
// pnpm.mjs 入口的稳定 shim 并前置到 PATH；dsh 在 profile 目录下调用（无
// packageManager 祖先），不会触发 pnpm 的版本自切换。
const shimDirectory = join(ROOT, '.dev', 'pnpm-shim')
mkdirSync(shimDirectory, { recursive: true })
writeFileSync(join(shimDirectory, 'pnpm.cmd'), `@"${process.execPath}" "${runtime.pnpmCli}" %*\r\n`)
writeFileSync(join(shimDirectory, 'pnpm'), `#!/bin/sh\nexec '${process.execPath}' '${runtime.pnpmCli}' "$@"\n`)
const dshEnv = {
  ...process.env,
  DSH_HOME,
  PATH: `${shimDirectory}${process.env.PATH ? `${delimiter}${process.env.PATH}` : ''}`,
}

function runDshCli(args) {
  const result = spawnSync(process.execPath, [runtime.dshBin, 'plugin', `--profile=${PROFILE}`, ...args], {
    cwd: DSH_HOME, env: dshEnv, encoding: 'utf8',
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
  // allowBuilds 逐包显式决定，避免 pnpm 遇未列出的带脚本包硬失败；
  // 清单对齐官方桌面 project-manager.ts 的 workspaceFile（0.2.0-rc.2）：
  // 原生模块（subprocess-local/koffi/node-pty/fs-ext）置 true，纯 JS/预编译包置 false。
  writeFileSync(join(profileDirectory, 'pnpm-workspace.yaml'),
    'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\nallowBuilds:\n' +
    "  '@deepseek-ai/dsh-subprocess-local': true\n  '@google/genai': false\n  esbuild: false\n  fs-ext: true\n" +
    '  koffi: true\n  node-addon-require-builtin: false\n  node-pty: true\n  protobufjs: false\n')
}
runDshCli(['add', `@deepseek-ai/dsh-base@${DSH_VERSION}`, `@deepseek-ai/dsh-web-app@${DSH_VERSION}`, SUITE_DIRECTORY])

// add 只写依赖不写 bundles（官方包与套件均如此）；装载清单由本脚本收口。
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
manifest.dsh ??= {}
manifest.dsh.profile ??= {}
manifest.dsh.profile.bundles = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', SUITE_PACKAGE]
writeFileSync(manifestPath, `${JSON.stringify(manifest, undefined, 2)}\n`)

process.stdout.write(`开发实例：profile=${PROFILE} dsh=http://127.0.0.1:${DSH_PORT}\n`)
const child = spawn(process.execPath, [runtime.dshBin, PROFILE, `--port=${DSH_PORT}`, '--no-open'], {
  cwd: ROOT, stdio: 'inherit', env: dshEnv,
})
child.on('close', code => process.exit(code ?? 0))
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { child.kill(signal) })
}
