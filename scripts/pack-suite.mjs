/**
 * 把 plugins/suite 打成自包含 tarball（D20 GitHub 直装产物）。
 *
 * pnpm 对普通 tarball URL（非 git 宿主）不做 packlist、不跑 prepare，包内自带的
 * 物化 node_modules 原样落地（pacquet#436 的 fetcher 语义 + pnpm 官方包同款分发
 * 形态实证）；git 形态 URL 会走 npm-packlist 剥掉 node_modules，不可用——这是
 * GitHub 直装只能走 Release 资产 tarball 的原因。
 *
 * tarball 根目录是 package/（npm tarball 惯例，单一顶层目录）。内容 = 套件包发布
 * 内容（files 声明 + README + package.json）+ 物化 node_modules（排除 .obsolete-*
 * 残留）；tests 不随包分发。
 *
 * 产物（D21 单资产，2026-10-28 修订：安装/升级地址统一为带 tag 的固定名资产）：
 * - release/v<version>/dsh-kit.tar.gz
 *   发布资产名 dsh-kit.tar.gz，上传后地址形如
 *   https://github.com/WaynePluto/dsh-kit/releases/download/v<version>/dsh-kit.tar.gz
 *   （首次安装与升级同一形式；tag 变化即地址变化，同地址重复输入被官方管理器
 *   拒为 already-installed）。README 的下载链接随每次发版更新 tag。
 *
 * 用法：node scripts/pack-suite.mjs [v<期望标签>]（给出标签时核对与套件版本一致）。
 * 前置：pnpm suite:build（物化 + peerDependencies 契约校验）。
 */

import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { PLUGINS_DIRECTORY, ROOT } from './local-config.mjs'

const SUITE = join(PLUGINS_DIRECTORY, 'suite')
const RELEASE = join(ROOT, 'release')
const STAGING = join(RELEASE, 'staging')

const expectedTag = process.argv[2]
const manifest = JSON.parse(readFileSync(join(SUITE, 'package.json'), 'utf8'))
const peers = Object.keys(manifest.peerDependencies ?? {})
if (peers.length === 0) {
  throw new Error('套件包没有 peerDependencies：先运行 pnpm suite:build（verifySuiteDependencies 守护自包含契约）')
}
if (expectedTag !== undefined && expectedTag !== `v${manifest.version}`) {
  throw new Error(`标签 ${expectedTag} 与套件版本 v${manifest.version} 不一致：先同步 plugins/suite/package.json 的 version 再打标签`)
}
if (!existsSync(join(SUITE, 'node_modules', '@dsh-kit'))) {
  throw new Error('套件 node_modules 未物化：先运行 pnpm suite:build')
}

/** 遍历目录统计文件数与字节数。 */
function measure(directory) {
  let files = 0
  let bytes = 0
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      const nested = measure(path)
      files += nested.files
      bytes += nested.bytes
    } else {
      files += 1
      bytes += statSync(path).size
    }
  }
  return { files, bytes }
}

let failures = 0
function check(ok, message, detail) {
  if (!ok) failures += 1
  console.log(`${ok ? '[ok]  ' : '[fail]'} ${message}${detail === undefined ? '' : ` — ${detail}`}`)
}

// 暂存出 package/ 根（npm tarball 单一顶层目录惯例），再交给系统 tar。
rmSync(STAGING, { recursive: true, force: true })
mkdirSync(join(STAGING, 'package'), { recursive: true })
for (const entry of [...manifest.files ?? [], 'README.md']) {
  const source = join(SUITE, entry)
  if (existsSync(source)) cpSync(source, join(STAGING, 'package', entry), { recursive: true })
}
cpSync(join(SUITE, 'package.json'), join(STAGING, 'package', 'package.json'))
cpSync(join(SUITE, 'node_modules'), join(STAGING, 'package', 'node_modules'), {
  recursive: true,
  // .obsolete-* 是 pnpm 换代残留；.vite 是 vitest 测试缓存（release.yml 在
  // pnpm test 之后打包，本地也可能带着上一次测试的缓存），都不属于发布产物。
  filter: source => !relative(SUITE, source)
    .split(/[\\/]/u)
    .some(segment => segment === '.vite' || segment.startsWith('.obsolete-')),
})

const assetDirectory = join(RELEASE, `v${manifest.version}`)
rmSync(assetDirectory, { recursive: true, force: true })
mkdirSync(assetDirectory, { recursive: true })
const measured = measure(join(STAGING, 'package'))
// 产物用相对路径：GNU tar 会把绝对路径里的 `D:` 当成远程主机（colon 语法）。
const tar = spawnSync('tar', ['-czf', `v${manifest.version}/dsh-kit.tar.gz`, '-C', STAGING, 'package'],
  { stdio: 'inherit', cwd: RELEASE })
if (tar.error !== undefined || tar.status !== 0) {
  throw new Error(`tar 打包失败：${tar.error?.message ?? `exit ${String(tar.status)}`}`)
}
rmSync(STAGING, { recursive: true, force: true })

const artifact = join(assetDirectory, 'dsh-kit.tar.gz')
const size = statSync(artifact).size
check(size > 0, `release/v${manifest.version}/dsh-kit.tar.gz`, `${(size / 1024 / 1024).toFixed(1)} MiB`)
check(failures === 0, `内容：${manifest.name}@${manifest.version}，${String(peers.length)} 个 peerDependencies 组件，` +
  `${String(measured.files)} 个文件，物化内容 ${(measured.bytes / 1024 / 1024).toFixed(1)} MiB`)
if (failures > 0) process.exit(1)
console.log('发布：推送到 GitHub 后由 release 工作流上传资产 dsh-kit.tar.gz；「添加插件」填\n' +
  `  https://github.com/WaynePluto/dsh-kit/releases/download/v${manifest.version}/dsh-kit.tar.gz\n` +
  '  （发新版后同步更新 README 里的下载链接 tag）')
