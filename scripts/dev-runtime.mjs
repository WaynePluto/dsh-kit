import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync, mkdirSync, readFileSync, readlinkSync, readdirSync,
  renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync,
} from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { readBuildStamp, writeBuildStamp } from './lib/stamp-file.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

function runNode(args, root) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit', windowsHide: true })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`准备隔离 dsh 开发运行时失败（退出码 ${String(result.status)}）`)
}

/** 只缓存成功的解析校验；每次重读完整内容，任何字节变化都重新校验。 */
async function validateOverrides(root, rootBytes, overrides, parseYaml) {
  const workspaceBytes = readFileSync(join(root, 'pnpm-workspace.yaml'))
  const lockBytes = readFileSync(join(root, 'pnpm-lock.yaml'))
  const hash = createHash('sha256')
  for (const bytes of [rootBytes, workspaceBytes, lockBytes]) hash.update(`${bytes.length}\0`).update(bytes)
  const digest = hash.digest('hex')
  const path = join(root, 'node_modules', '.cache', 'dsh-kit', 'dev-runtime-validation.json')
  const previous = readBuildStamp(path)
  if (previous?.schemaVersion === 1 && previous.digest === digest) return
  const workspace = await parseYaml(workspaceBytes.toString('utf8'))
  if (workspace.overrides !== undefined) {
    throw new Error('pnpm-workspace.yaml 不应另设 overrides；统一维护根 package.json 的 pnpm.overrides。')
  }
  const lockedOverrides = (await parseYaml(lockBytes.toString('utf8'))).overrides ?? {}
  const drift = [...new Set([...Object.keys(overrides), ...Object.keys(lockedOverrides)])]
    .filter(name => overrides[name] !== lockedOverrides[name])
  if (drift.length > 0) {
    throw new Error(`pnpm-lock.yaml 的 overrides 与根 package.json 不一致：${drift.join('、')}；先运行 pnpm install。`)
  }
  writeBuildStamp(path, { schemaVersion: 1, digest })
}

/** 可供准备进程直接调用；导入本模块本身不读取配置、不安装或改写描述文件。 */
export async function ensureDevelopmentRuntime({
  root = ROOT, run = runNode, log = console.log,
  parseYaml = async text => (await import('yaml')).parse(text),
  runtimeDependencies: injectedRuntimeDependencies,
} = {}) {
  const rootBytes = readFileSync(join(root, 'package.json'))
  const rootManifest = JSON.parse(rootBytes.toString('utf8'))
  // 原 launcher package.json 的依赖清单（launcher 退役后内联于此）：
  // dsh 运行时家族 + 常用工具，外加以 file: 链接的 plugin-ui（浏览器插件内联源）。
  const runtimeDependencies = injectedRuntimeDependencies ?? {
    '@deepseek-ai/dsh': '0.2.1-rc.2',
    '@deepseek-ai/dsh-home-paths': '0.2.1-rc.2',
    '@deepseek-ai/dsh-llm': '0.2.1-rc.2',
    '@deepseek-ai/dsh-plugin-manager': '0.2.1-rc.2',
    '@deepseek-ai/dsh-sandbox-policy': '0.2.1-rc.2',
    '@deepseek-ai/dsh-terminal': '0.2.1-rc.2',
    '@deepseek-ai/dsh-terminal-bash': '0.2.1-rc.2',
    '@deepseek-ai/dsh-tool-terminal': '0.2.1-rc.2',
    '@deepseek-ai/dsh-tools': '0.2.1-rc.2',
    '@deepseek-ai/dsh-user-approval': '0.2.1-rc.2',
    '@deepseek-ai/schemastery': '3.18.5',
    '@dsh-kit/plugin-ui': `file:${join(root, 'packages', 'plugin-ui')}`,
    '@earendil-works/pi-ai': '1.1.0',
    commander: '15.0.0',
    immer: '10.2.0',
    pnpm: '10.17.0',
    undici: '8.11.2',
    yaml: '2.9.1',
    zod: '4.4.3',
    zustand: '4.4.7',
  }
  const overrides = rootManifest.pnpm?.overrides
  if (overrides === undefined || Object.keys(overrides).length === 0) {
    throw new Error('根 package.json 缺少 pnpm.overrides，无法准备一致的 dsh 开发运行时。')
  }
  await validateOverrides(root, rootBytes, overrides, parseYaml)
  const fingerprint = createHash('sha256')
    .update('runtime-schema-4')
    .update(JSON.stringify({ runtimeDependencies, overrides }))
    .digest('hex').slice(0, 16)
  // 放在仓库同级目录，避免 dsh 从工作区 node_modules 抢先解析同名插件。
  const runtime = join(dirname(root), `.${basename(root)}-runtime`, fingerprint)
  const dshBin = join(runtime, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  const installAnchor = join(runtime, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
  const pnpmCli = join(runtime, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs')
  if (!existsSync(dshBin) || !existsSync(installAnchor) || !existsSync(pnpmCli)) {
    const temporary = `${runtime}.${process.pid}.tmp`
    rmSync(temporary, { recursive: true, force: true })
    mkdirSync(temporary, { recursive: true })
    writeFileSync(join(temporary, 'package.json'), `${JSON.stringify({
      name: 'dsh-kit-development-runtime', private: true, version: '0.0.0',
      dependencies: runtimeDependencies, pnpm: { overrides },
    }, undefined, 2)}\n`)
    const sourcePnpm = join(root, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs')
    await run([sourcePnpm, 'install', '--ignore-workspace', '--prod', '--ignore-scripts',
      // 与生产 deploy 的顶层可达布局一致，避免缺少传递依赖及临时链接失效。
      '--config.node-linker=hoisted', '--dir', temporary,
    ], root)
    rmSync(runtime, { recursive: true, force: true })
    renameSync(temporary, runtime)
    repairRenamedLinks(join(runtime, 'node_modules'), temporary, runtime)
  }
  const descriptor = { fingerprint, runtime, dshBin, installAnchor, pnpmCli }
  writeBuildStamp(join(root, '.dev', 'runtime.json'), descriptor)
  log(`[dsh-kit] 开发运行时：${runtime}`)
  return descriptor
}

/** pnpm 的绝对 junction 在临时目录改名后需指向最终目录；不递归跟随链接。 */
function repairRenamedLinks(directory, temporary, finalDirectory) {
  if (!existsSync(directory)) return
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name)
    if (entry.isSymbolicLink()) {
      const target = readlinkSync(full)
      if (target.includes(temporary)) {
        const repaired = target.split(temporary).join(finalDirectory)
        unlinkSync(full)
        symlinkSync(repaired, full, process.platform === 'win32' ? 'junction' : 'dir')
      }
      continue
    }
    if (entry.isDirectory()) repairRenamedLinks(full, temporary, finalDirectory)
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await ensureDevelopmentRuntime() }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 }
}
