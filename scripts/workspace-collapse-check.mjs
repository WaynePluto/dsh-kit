/**
 * 在不启动 dsh 或打开会话的情况下，对 workspace-collapse 浏览器产物做冒烟检查。
 * 它在小型浏览器模块 shim 中执行构建后的加载器包装，验证头部按钮注入编排的
 * 挂载参数、折叠动作的选择器契约，以及 bundle 内的 dsh DOM 契约字符串。
 *
 * 构建插件后运行：
 *
 *   用法：node scripts/workspace-collapse-check.mjs
 */

import { createContext, runInContext } from 'node:vm'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './local-config.mjs'

const PACKAGE_ID = '@dsh-kit/dsh-plugin-workspace-collapse'
const BUNDLE = join(ROOT, 'plugins', 'workspace-collapse', 'dist', 'client.js')
const NOOP = () => {}
let failures = 0

function check(ok, message, detail) {
  if (!ok) failures += 1
  console.log(`${ok ? '[ok]  ' : '[fail]'} ${message}${detail === undefined ? '' : ` — ${detail}`}`)
}

if (!existsSync(BUNDLE)) {
  console.error(`找不到 ${BUNDLE}，先运行 pnpm --filter ${PACKAGE_ID} build`)
  process.exit(1)
}

const source = readFileSync(BUNDLE, 'utf8')
let loaded = null

// 假浏览器环境：沙箱 globals 在 createContext 时固定，必须在求值前提供，
// apply 里的 typeof document 检查与 MutationObserver 构造都在沙箱内解析。
const observations = []
class FakeMutationObserver {
  constructor(callback) { this.callback = callback }
  observe(target, options) { observations.push({ target, options }) }
  disconnect() { this.disconnected = true }
}
const headChildren = []
const queries = []
const fakeDocument = {
  head: { appendChild: child => { headChildren.push(child) } },
  body: {},
  createElement: tag => ({
    tagName: tag.toUpperCase(),
    textContent: '',
    setAttribute: NOOP,
    remove: NOOP,
  }),
  querySelector: selector => {
    queries.push(selector)
    return null
  },
}
const sandbox = {
  window: { __ModuleLoader__: { load: entry => { loaded = entry } } },
  document: fakeDocument,
  MutationObserver: FakeMutationObserver,
  console,
}
runInContext(source, createContext(sandbox), { filename: BUNDLE })
check(loaded?.id === PACKAGE_ID, 'browser loader id 使用 workspace-collapse 包名', loaded?.id)
if (loaded === null) process.exit(1)

const exports = loaded.factory(id => {
  if (id === 'react') return {}
  if (id === 'react/jsx-runtime') return { Fragment: NOOP, jsx: NOOP, jsxs: NOOP }
  if (id === 'react-dom') return { createRoot: () => ({ render: NOOP, unmount: NOOP }) }
  if (id === '@deepseek-ai/dsh-client-ui-primitives') {
    return { IconChevronUpOutlineMedium: NOOP, Tooltip: NOOP }
  }
  throw new Error(`bundle 要求页面模块表之外的模块：${id}`)
})

// apply：注册文案 + 挂载一个常驻注入 effect，样式入 head、观察器挂 body 子树。
const effects = []
const namespaces = []
const context = {
  effect: (run, name) => {
    effects.push(name)
    const dispose = run()
    if (typeof dispose !== 'function') throw new Error(`effect ${String(name)} 未返回 disposer`)
  },
  locale: {
    bind: () => key => key,
    register: namespace => { namespaces.push(namespace); return NOOP },
  },
}
exports.apply(context)
check(namespaces.includes('dsh-plugin-workspace-collapse'), '注册 workspace-collapse 文案命名空间')
check(effects.length === 2, 'apply 挂载文案与按钮注入两个 effect', JSON.stringify(effects))
check(observations.length === 1, 'MutationObserver 挂载一次')
check(
  observations[0]?.options?.childList === true && observations[0]?.options?.subtree === true,
  '观察 body 子树的 childList + subtree',
  JSON.stringify(observations[0]?.options),
)
check(queries.includes('[data-row-key^="workspace:"]'), '挂载后立即按工作区行选择器评估存量 DOM', JSON.stringify(queries))
check(headChildren.length === 1 && headChildren[0].tagName === 'STYLE', '按钮样式注入 head')

// 折叠动作契约：只命中展开中的工作区分组行（未分组桶是 `workspace:` 空前缀）。
const clicked = []
const fakeRoot = {
  querySelectorAll: selector => {
    check(
      selector === '[data-row-key^="workspace:"][aria-expanded="true"]',
      '折叠查询使用展开中的工作区分组行选择器',
      selector,
    )
    return [{ click: () => { clicked.push('a') } }, { click: () => { clicked.push('b') } }]
  },
}
check(exports.collapseExpandedRows(fakeRoot) === 2 && clicked.join(',') === 'b,a', '逆序点击（先子后父）')
check(
  exports.EXPANDED_ROW_SELECTOR === '[data-row-key^="workspace:"][aria-expanded="true"]'
  && exports.WORKSPACE_ROW_SELECTOR === '[data-row-key^="workspace:"]',
  '导出选择器常量与 DOM 契约一致',
)

// DOM 契约字符串：类名后缀定位（bundle 字符串里的引号可能被转义）+ 原生退场规则 + 中英文文案。
check(/sectionHeader\\?"/.test(source) && /searchSlot\\?"/.test(source), 'bundle 包含 sectionHeader/searchSlot 类名后缀定位')
check(source.includes('headerActionsHidden') && source.includes(':has(~ '), 'bundle 包含搜索展开退场的 :has 规则')
check(source.includes('data-row-key') && source.includes('aria-expanded'), 'bundle 包含工作区行 DOM 契约')
check(source.includes('收起全部工作区') && source.includes('Collapse all workspaces'), 'bundle 包含中英文按钮文案')
check(source.includes('IconChevronDownOutlineMedium') && source.includes('IconChevronUpOutlineMedium'), 'bundle 使用上下双 chevron 原生字形')
check(
  source.includes('--dsw-alias-label-secondary') && source.includes('--ds-ease-in-out')
  && source.includes('margin-left: 0'),
  'bundle 样式使用主题 token、原生动画节奏并归零 searchSlot 的 auto margin',
)
console.log(failures === 0 ? '\n全部通过。' : `\n${failures} 项未通过。`)
process.exit(failures === 0 ? 0 : 1)
