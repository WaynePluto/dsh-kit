/**
 * 在不启动 dsh 或打开会话的情况下，对 stats-hours 浏览器产物做冒烟检查。
 * 它在小型浏览器模块 shim 中执行构建后的加载器包装，验证时长改写纯函数、
 * 会话统计弹窗观察器的挂载参数，以及 bundle 内的 dsh DOM 契约字符串。
 *
 * 构建插件后运行：
 *
 *   用法：node scripts/stats-hours-check.mjs
 */

import { createContext, runInContext } from 'node:vm'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './local-config.mjs'

const PACKAGE_ID = '@dsh-kit/dsh-plugin-stats-hours'
const BUNDLE = join(ROOT, 'plugins', 'stats-hours', 'dist', 'client.js')
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
const bodies = []
const fakeDocument = {
  body: {
    querySelectorAll: selector => {
      bodies.push(selector)
      return []
    },
  },
}
const sandbox = {
  window: { __ModuleLoader__: { load: entry => { loaded = entry } } },
  document: fakeDocument,
  MutationObserver: FakeMutationObserver,
  console,
}
runInContext(source, createContext(sandbox), { filename: BUNDLE })
check(loaded?.id === PACKAGE_ID, 'browser loader id 使用 stats-hours 包名', loaded?.id)
if (loaded === null) process.exit(1)

const exports = loaded.factory(() => {
  throw new Error('bundle 要求页面模块表之外的模块（纯 DOM 插件应为零 external）')
})

// 纯函数契约：≥1 小时的两档改写，其余保持原样。
const cases = [
  ['62分5秒', '1小时2分5秒'],
  ['60分0秒', '1小时0分0秒'],
  ['125m3s', '2h 5m 3s'],
  ['59分59秒', null],
  ['2m42s', null],
  ['1小时2分5秒', null],
  ['12.3 tok/s', null],
]
let pureOk = true
for (const [input, expected] of cases) {
  const actual = exports.upgradeSessionStatsDuration(input)
  if (actual !== expected) {
    pureOk = false
    console.log(`[fail] 改写 ${JSON.stringify(input)} 期望 ${JSON.stringify(expected)}，得到 ${JSON.stringify(actual)}`)
    failures += 1
  }
}
if (pureOk) check(true, `时长改写纯函数 ${String(cases.length)} 组断言全部通过`)

// apply：观察器应挂 body 子树并覆盖 childList/characterData（React 重渲染覆盖文本的回改路径）。
const effects = []
const context = {
  effect: (run, name) => {
    effects.push(name)
    const dispose = run()
    if (typeof dispose !== 'function') throw new Error(`effect ${String(name)} 未返回 disposer`)
  },
}
exports.apply(context)
check(effects.length === 1, 'apply 挂载一个常驻 effect', JSON.stringify(effects))
check(observations.length === 1, 'MutationObserver 挂载一次')
check(
  observations[0]?.options?.childList === true && observations[0]?.options?.subtree === true
  && observations[0]?.options?.characterData === true,
  '观察 body 子树的 childList + subtree + characterData',
  JSON.stringify(observations[0]?.options),
)
check(bodies.length === 1, '挂载后立即改写一次存量弹窗')
check(
  bodies[0] === '[data-session-stats-details] dd',
  '查询 dsh 会话统计明细行钩子',
  JSON.stringify(bodies[0]),
)
check(source.includes('data-session-stats-details'), 'bundle 包含 dsh 弹窗 DOM 钩子字符串')
check(source.includes('小时') && source.includes('h '), 'bundle 包含中英文小时档单位')
console.log(failures === 0 ? '\n全部通过。' : `\n${failures} 项未通过。`)
process.exit(failures === 0 ? 0 : 1)
