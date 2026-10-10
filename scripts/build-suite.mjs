// 生成 suite 聚合 Bundle 的 cordis.patch.yml，并把组件与依赖闭包物化进
// 套件自身的 node_modules（本地目录安装是 link: 语义，pnpm 不安装 link 包的依赖，
// 套件必须自带；git 地址安装时 pnpm 从克隆仓库解析 file: 依赖，物化内容被忽略）。
// 组件行来自各组件包自己的 patch：`name: './dist/index.js'` 改写为裸包名
// （loader 从套件 node_modules 解析），并追加「套件不在 bundles 时禁用」的
// 官方组合包表达式；其余行（preset、官方行覆盖等）原样保留。
// 运行：node scripts/build-suite.mjs（先 pnpm plugins:build 保证 dist 存在）。
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PLUGINS = join(ROOT, 'packages', 'plugins')
const SUITE_PACKAGE = '@dsh-remote/dsh-plugin-suite'
const COMBO_PACKAGES = new Set([
  // browser-compat 是旧 WebKit 垫片（dsh-station 壳时代产物）：其全局 Promise/Iterator
  // 垫片会垫坏官方桌面（Chromium）的连接客户端，导致页面 /api 永久重连失败
  // （2026-10-09 实测二分确认），不进入套件；包保留供老设备单独安装。
  'browser-compat',
  'remote-experience',
  'model-enhancements',
  'conversation-enhancements',
  'development-tools',
  'suite',
  // remote-privileged 不是普通组件包：它的行（屏障/投影）在套件模板的特殊段落里。
  'remote-privileged',
])
// 代理必须先于模型组件生效（见 plugin-catalog 顺序约定）；固定 YOLO 保持最后。
const FIRST = ['proxy']
const LAST = ['yolo-mode']

// 无自身 patch 的引用包：只物化进套件 node_modules、不迭代出顶层行。preset-concise
// 是显示壳微包（行名改写目标）；run-code 由 concise 预设的嵌套行按裸包名引用。
const DISPLAY_PACKAGE_DIRS = ['model-bootstrap', 'theme-projection', 'remote-trust', 'preset-concise', 'run-code']

function componentDirectories() {
  return readdirSync(PLUGINS, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .filter(name => !COMBO_PACKAGES.has(name) && !DISPLAY_PACKAGE_DIRS.includes(name))
    .sort((a, b) => {
      const rank = name => (FIRST.includes(name) ? 0 : LAST.includes(name) ? 2 : 1)
      return rank(a) - rank(b) || a.localeCompare(b)
    })
}

/** 拆出组件 patch 的顶层条目块；丢弃文件头注释，块内注释保留。 */
function topLevelEntries(text) {
  const lines = text.split(/\r?\n/u)
  const blocks = []
  let current = []
  for (const line of lines) {
    if (line.startsWith('- ')) {
      if (current.length > 0) blocks.push(current)
      current = [line]
    } else if (current.length > 0) {
      current.push(line)
    }
  }
  if (current.length > 0) blocks.push(current)
  // 丢掉纯注释尾巴。
  return blocks.map(block => {
    const end = block.length
    let last = end
    for (let index = end - 1; index >= 0; index -= 1) {
      if (block[index].trim() === '') { last = index } else break
    }
    return block.slice(0, last)
  }).filter(block => block.length > 0)
}

// 非 './dist/*' 形态行的显示改写：preset 行换成本套件生成的显示壳微包，
// remote-runtime 的 bootstrap 子路径行同理（相对路径行拿不到插件管理器元数据）。
const ROW_NAME_OVERRIDES = new Map([
  ['preset-concise', '@dsh-remote/dsh-plugin-preset-concise'],
])
const SUBPATH_DISPLAY_PACKAGES = new Map([
  ['@dsh-remote/dsh-plugin-remote-runtime/bootstrap.js', '@dsh-remote/dsh-plugin-remote-trust'],
])

function suiteDisabledExpr(indent) {
  return `${indent}disabled: !!js '!JSON.parse(process.getBuiltinModule("node:fs").readFileSync(new URL("package.json", baseUrl), "utf8")).dsh?.profile?.bundles?.includes("${SUITE_PACKAGE}")'`
}

/** 逐行改写一个顶层条目块；同一 insert 块可含多行（如 concise-mode 的两个 preset），各自独立处理。 */
function transformEntry(block, packageName) {
  const out = []
  let rowId
  for (let index = 0; index < block.length; index += 1) {
    const line = block[index]
    const idMatch = /^(\s*)- id: (.+)$/u.exec(line)
    if (idMatch !== null) {
      rowId = idMatch[2].trim()
      out.push(line)
      // 只给装载层行（顶层覆盖行缩进 0、insert 成员行缩进 4）补套件 disabled 表达式；
      // preset 组合等嵌套行（缩进 ≥6）随父行生死，不单独插。行内已有 disabled
      // （可能排在 name 之后，如 yolo-mode）时改写其 includes 常量、不重复插。
      const loaderLevel = idMatch[1] === '' || idMatch[1] === '    '
      let hasDisabled = false
      for (let scan = index + 1; scan < block.length; scan += 1) {
        if (/^\s*- id: /u.test(block[scan])) break
        if (/^\s*disabled: /u.test(block[scan])) { hasDisabled = true; break }
      }
      if (loaderLevel && !hasDisabled) {
        out.push(suiteDisabledExpr(`${idMatch[1]}  `))
      }
      continue
    }
    const nameMatch = /^(\s*)name: '([^']+)'$/u.exec(line)
    if (nameMatch !== null) {
      const indent = nameMatch[1]
      const current = nameMatch[2]
      let replacement
      if (ROW_NAME_OVERRIDES.has(rowId)) {
        replacement = ROW_NAME_OVERRIDES.get(rowId)
      } else if (current.startsWith('./dist/')) {
        const file = current.slice('./dist/'.length)
        const display = SUBPATH_DISPLAY_PACKAGES.get(`${packageName}/${file}`)
        replacement = display ?? (file === 'index.js' ? packageName : `./node_modules/${packageName}/${file}`)
      }
      out.push(replacement === undefined ? line : `${indent}name: '${replacement}'`)
      continue
    }
    if (/^\s*disabled: !!js '/u.test(line) && line.includes('includes("')) {
      out.push(line.replace(/includes\("[^"]*"\)/u, `includes("${SUITE_PACKAGE}")`))
      continue
    }
    out.push(line)
  }
  return out.join('\n')
}

function componentSection() {
  const sections = []
  for (const dir of componentDirectories()) {
    const patchPath = join(PLUGINS, dir, 'cordis.patch.yml')
    if (!existsSync(patchPath)) throw new Error(`组件 ${dir} 缺少 cordis.patch.yml`)
    const manifest = JSON.parse(readFileSync(join(PLUGINS, dir, 'package.json'), 'utf8'))
    const entries = topLevelEntries(readFileSync(patchPath, 'utf8'))
      .map(block => transformEntry(block, manifest.name))
    if (entries.length === 0) throw new Error(`组件 ${dir} 的 patch 没有顶层条目`)
    sections.push(`# ── ${manifest.name} ──\n${entries.join('\n\n')}`)
    process.stdout.write(`suite patch: ${dir}（${entries.length} 行块）\n`)
  }
  return sections.join('\n\n')
}

const header = `# dsh-remote 全量套件 Bundle（本文件由 scripts/build-suite.mjs 生成，勿手改）。
# 单输入安装：官方 dsh 插件管理页「添加插件」输入本目录路径（或仓库地址），
# 即安装/升级全部组件与远程运行时。组件行沿用组合包的裸包名 + disabled 表达式
# 约定：套件被停用/卸载（离开 bundles 列表）时全部组件行一并禁用。
#
# connection 行覆写：合并 dshRemoteTrust（remote-runtime bootstrap 从 membership
# 与本机地址计算的 authority 集合）与 webRuntime 的局域网信任。!!js 是标量 tag，
# 表达式必须加引号（spike 实测：裸 [ 会被安装期校验拒绝）。
- id: connection
  name: '@deepseek-ai/dsh-client-connection'
  inject: [webRuntime, webServer, dshRemoteTrust]
  config:
    trustedHosts: !!js "[...ctx.dshRemoteTrust.authorities, ...ctx.webRuntime.trustedHosts]"

# 模型 HMR 启动屏障：随进程固定契约，避免运行中停用模型组件时热重启 llm-pi-ai。
- id: llm-pi-ai
  name: '@deepseek-ai/dsh-llm-pi-ai'
  inject:
    - llm
    - modelsCatalogBootstrap
    - modelCapabilitiesBootstrap

# 壳级常驻行：模型屏障占位与原生主题只读投影（原 --patch overlay 内容，转入
# 套件层）。trust bootstrap 行由 remote-runtime 组件自己的 patch 提供，保持常驻。
# 这三行与简洁预设行都通过生成的「显示壳」微包装载（裸包名 + 中文 locale meta）：
# 插件管理器只给裸包名行解析元数据，相对路径行会退化为显示完整文件 URL，
# 非套件的官方包（如 @deepseek-ai/dsh-agent-preset）则只会显示英文包名与描述。
- insert:
    - id: dsh-remote-model-bootstrap-fallback
      name: '@dsh-remote/dsh-plugin-model-bootstrap'
    - id: dsh-remote-theme-projection
      name: '@dsh-remote/dsh-plugin-theme-projection'
`

const output = `${header}\n${componentSection()}\n`
const target = join(PLUGINS, 'suite', 'cordis.patch.yml')
writeFileSync(target, output.endsWith('\n') ? output : `${output}\n`)
process.stdout.write(`已生成 ${target}\n`)

// ── 物化套件 node_modules（本地 link: 安装路径）────────────────────────────
// 本地目录安装是 link: 语义，pnpm 不安装 link 包的依赖；套件必须自带全部内容。
// git 地址安装时 pnpm 从克隆仓库解析 file: 依赖，物化内容被 profile 内安装覆盖。

const SUITE_DIR = join(PLUGINS, 'suite')
const SUITE_MODULES = join(SUITE_DIR, 'node_modules')
const RUNTIME_PACKAGE_DIRS = ['relay', 'connector', 'protocol']

function packageNameOf(source) {
  return JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')).name
}

/** 按组件包 files 字段复制发布内容；workspace: 版本引用还原为裸版本。 */
function copySelfContainedPackage(source, target) {
  const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'))
  const dependencies = Object.fromEntries(Object.entries(manifest.dependencies ?? {}).map(([name, version]) => [
    name,
    typeof version === 'string' && version.startsWith('workspace:') ? version.slice('workspace:'.length) : version,
  ]))
  const normalized = { ...manifest, ...Object.keys(dependencies).length === 0 ? {} : { dependencies } }
  mkdirSync(target, { recursive: true })
  writeFileSync(join(target, 'package.json'), `${JSON.stringify(normalized, undefined, 2)}\n`)
  for (const entry of [...manifest.files ?? [], 'README.md']) {
    if (existsSync(join(source, entry))) cpSync(join(source, entry), join(target, entry), { recursive: true })
  }
  return normalized
}

/**
 * 从仓库根 node_modules 复制 registry 依赖闭包（扁平布局，匹配 hoisted 解析）。
 * 跳过 @deepseek-ai/*（dsh 宿主运行时树提供，避免第二单例）与 @dsh-remote/*。
 */
function copyRegistryClosure(seedNames) {
  const rootModules = join(ROOT, 'node_modules')
  const pending = [...seedNames]
  const done = new Set()
  while (pending.length > 0) {
    const name = pending.shift()
    if (done.has(name) || name.startsWith('@deepseek-ai/') || name.startsWith('@dsh-remote/')) continue
    done.add(name)
    const source = join(rootModules, name)
    if (!existsSync(join(source, 'package.json'))) {
      throw new Error(`仓库根 node_modules 缺少 ${name}，请先 pnpm install`)
    }
    cpSync(source, join(SUITE_MODULES, name), {
      recursive: true,
      filter: path => {
        const relative = path === source ? '' : path.slice(source.length + 1)
        return !relative.split(/[\\/]/u).includes('node_modules')
      },
    })
    const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'))
    pending.push(...Object.keys(manifest.dependencies ?? {}))
  }
  return done
}

function materializeSuiteModules() {
  rmSync(SUITE_MODULES, { recursive: true, force: true })
  mkdirSync(join(SUITE_MODULES, '@dsh-remote'), { recursive: true })
  const registrySeeds = new Set()
  const componentDirs = [...componentDirectories(), 'remote-privileged', ...DISPLAY_PACKAGE_DIRS]
  for (const dir of componentDirs) {
    const source = join(PLUGINS, dir)
    const manifest = copySelfContainedPackage(source, join(SUITE_MODULES, '@dsh-remote', packageNameOf(source).split('/')[1]))
    for (const name of Object.keys(manifest.dependencies ?? {})) registrySeeds.add(name)
  }
  for (const dir of RUNTIME_PACKAGE_DIRS) {
    const source = join(ROOT, 'packages', dir)
    const manifest = copySelfContainedPackage(source, join(SUITE_MODULES, '@dsh-remote', packageNameOf(source).split('/')[1]))
    // relay/connector/protocol 是应用包，无 files 字段：显式带上构建产物。
    cpSync(join(source, 'dist'), join(SUITE_MODULES, '@dsh-remote', packageNameOf(source).split('/')[1], 'dist'), { recursive: true })
    // relay/connector 是独立进程：带上它们的完整 registry 闭包（@deepseek-ai 之外）。
    for (const name of Object.keys(manifest.dependencies ?? {})) registrySeeds.add(name)
  }
  // @deepseek-ai/* 种子（pi-ai、dsh-http-proxy 等非宿主树包除外见下）在此展开：
  // 组件声明的 @deepseek-ai 依赖里，只有 dsh 运行时确实提供的才跳过；pi-ai 等
  // 第三方 scope（@earendil-works）正常复制。schemastery 等 dsh 家族包由宿主提供。
  const copied = copyRegistryClosure([...registrySeeds])
  process.stdout.write(`物化完成：${componentDirs.length + RUNTIME_PACKAGE_DIRS.length} 个 @dsh-remote 包 + ${copied.size} 个 registry 依赖（${[...copied].join(', ')}）\n`)
}

materializeSuiteModules()
