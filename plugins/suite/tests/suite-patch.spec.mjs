// 套件 patch 的装载守卫契约：insert 子行必须带「套件成员 + 组件包可解析」双条件
// disabled 表达式；顶层覆写行只允许 yolo-mode 的四个官方行（config 条件回退 +
// 镜像行，停用语义按重启生效，见 docs/dsh/runtime.md）。守卫表达式与 dsh loader
// 同构求值（with (ctx) eval，baseUrl 为 profile 目录 URL），模拟三种安装形态：
// 未选套件、hoisted（组件可从 profile 根解析）与仅套件 junction（运行中首次启用，
// HMR 重组合的解析表还是安装前的快照）。契约变化必须在这里响亮失败。
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const SUITE_PACKAGE = '@dsh-kit/dsh-plugin-suite'
const SUITE_DIR = fileURLToPath(new URL('../', import.meta.url))
const PLUGINS_DIR = join(SUITE_DIR, '..')
const patchText = readFileSync(join(SUITE_DIR, 'cordis.patch.yml'), 'utf8')

/** yolo-mode v3 后套件层没有任何官方行覆写；此白名单恒为空，防止回归。 */
const OVERRIDE_ROWS = []

/** 从生成 patch 提取 insert 成员行（id/name/disabled），与 yolo-mode-check 的提取方式同构。
 * 行尾容忍 \r：Windows autocrlf 检出会把工作区 patch 转成 CRLF。 */
function extractInsertRows(text) {
  const rows = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const m = /^ {4}- id: ([\w-]+)\r?$/u.exec(lines[i])
    if (m === null) continue
    const row = { id: m[1], name: undefined, disabled: undefined }
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim().startsWith('- id: ') || lines[j].trim().startsWith('- insert')) break
      const n = /^ {6}name: '([^']+)'\r?$/u.exec(lines[j])
      if (n !== null) row.name = n[1]
      const d = /^ {6}disabled: !!js '([^']+)'\r?$/u.exec(lines[j])
      if (d !== null) row.disabled = d[1]
    }
    if (row.name !== undefined) rows.push(row)
  }
  return rows
}

/** 提取顶层（非 insert）覆写行的 id；套件层除 yolo 白名单外不得覆写任何官方行。 */
function extractOverrideRowIds(text) {
  const ids = []
  for (const line of text.split('\n')) {
    const m = /^- id: ([\w-]+)\r?$/u.exec(line)
    if (m !== null) ids.push(m[1])
  }
  return ids
}

/** 模拟 loader 的行表达式求值：loader ctx 以 baseUrl（profile 目录 URL）求值。 */
function evaluate(expr, baseUrl) {
  const evaluateWith = new Function('baseUrl', 'process', `with ({ baseUrl }) { return ${expr} }`)
  return evaluateWith(baseUrl, process)
}

const linkType = process.platform === 'win32' ? 'junction' : 'dir'

/** 构造临时 profile：off 不选套件；hoisted 组件直挂 profile node_modules；junction-only 仅套件 junction。 */
function makeProfile(kind, hoistedPackages) {
  const dir = mkdtempSync(join(tmpdir(), 'suite-guard-'))
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    private: true,
    dsh: { profile: { bundles: kind === 'off' ? [] : ['@deepseek-ai/dsh-base', SUITE_PACKAGE] } },
  }))
  writeFileSync(join(dir, 'cordis.patch.yml'), '[]\n')
  const scope = join(dir, 'node_modules', '@dsh-kit')
  mkdirSync(scope, { recursive: true })
  if (kind !== 'off') {
    symlinkSync(SUITE_DIR, join(scope, 'dsh-plugin-suite'), linkType)
  }
  for (const [packageName, source] of kind === 'hoisted' ? hoistedPackages : []) {
    symlinkSync(source, join(scope, packageName.split('/')[1]), linkType)
  }
  return dir
}

const tempDirs = []
afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop(), { recursive: true, force: true })
})

describe('suite patch 装载守卫', () => {
  const rows = extractInsertRows(patchText)
  const componentRows = rows
  const yoloRow = rows.find(row => row.id === 'yolo-mode')
  const plainRows = componentRows.filter(row => row.id !== 'yolo-mode')
  const hoistedPackages = plainRows.map(row => [row.name, join(PLUGINS_DIR, row.id)])
  hoistedPackages.push([yoloRow.name, join(PLUGINS_DIR, yoloRow.id)])

  it('组件行保持裸包名并各自探测本组件包', () => {
    expect(plainRows.length).toBeGreaterThanOrEqual(16)
    for (const row of componentRows) {
      expect(row.name?.startsWith('@dsh-kit/'), row.id).toBe(true)
      expect(row.disabled, row.id).toContain('createRequire')
      expect(row.disabled, row.id).toContain(`${row.name}/package.json`)
    }
  })

  it('套件层没有任何官方行覆写（D16：覆写官方行会触发启停重组合级联）', () => {
    const overrides = extractOverrideRowIds(patchText)
    expect(overrides, '套件层覆写官方行会触发启停重组合级联（session-controller 竞态），历史覆写一律不得回归')
      .toEqual(OVERRIDE_ROWS)
    // llm-pi-ai 与 connection 的历史覆写不得回归。
    expect(patchText).not.toContain('modelsCatalogBootstrap')
    expect(patchText).not.toContain('inject: [webRuntime, webServer]')
  })

  it('未选套件时全部组件行禁用', () => {
    const dir = makeProfile('off', hoistedPackages)
    tempDirs.push(dir)
    const base = `${pathToFileURL(dir).href}/`
    for (const row of componentRows) {
      expect(evaluate(row.disabled ?? "", base), row.id).toBe(true)
    }
  })

  it('hoisted 形态（组件可从 profile 根解析）组件行启用', () => {
    const dir = makeProfile('hoisted', hoistedPackages)
    tempDirs.push(dir)
    const base = `${pathToFileURL(dir).href}/`
    for (const row of plainRows) {
      expect(evaluate(row.disabled ?? "", base), row.id).toBe(false)
    }
  })

  it('仅套件 junction（运行中首次启用）时组件行延迟装载、yolo 保持默认停用', () => {
    const dir = makeProfile('junction-only', hoistedPackages)
    tempDirs.push(dir)
    const base = `${pathToFileURL(dir).href}/`
    for (const row of componentRows) {
      expect(evaluate(row.disabled ?? "", base), row.id).toBe(true)
    }
  })

  it('hoisted + 显式启用行时 yolo 行生效（守卫不破坏 v2 判定）', () => {
    const dir = makeProfile('hoisted', hoistedPackages)
    tempDirs.push(dir)
    writeFileSync(join(dir, 'cordis.patch.yml'), '[ { id: yolo-mode, disabled: false } ]\n')
    expect(evaluate(yoloRow.disabled ?? "", `${pathToFileURL(dir).href}/`)).toBe(false)
  })
})
