/**
 * 在不启动 dsh 或打开会话的情况下，对 model-provider 浏览器产物做冒烟检查。
 * 它在小型浏览器模块 shim 中执行构建后的加载器包装，验证槽位登记
 * （conversation.input.right、list 条目 id/order/locale）、注入面
 * （共享目录 store 引用与 subagent 可用性判定）、显示名纯函数，
 * 以及 bundle 内的 dsh DOM 契约字符串。
 *
 * 构建插件后运行：
 *
 *   用法：node scripts/model-provider-check.mjs
 */

import { createContext, runInContext } from 'node:vm'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './local-config.mjs'

const PACKAGE_ID = '@dsh-kit/dsh-plugin-model-provider'
const NAMESPACE = 'dsh-plugin-model-provider'
const BUNDLE = join(ROOT, 'plugins', 'model-provider', 'dist', 'client.js')
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

// 假浏览器环境：页面模块表只提供 react 的两个入口（useSyncExternalStore 返回
// 固定快照，jsx-runtime 返回最小 element 对象），其余 external 应为零。
const snapshot = { current: null, groups: [], failures: [], status: 'idle', pending: null, error: null, routable: null }
const jsx = (type, props) => ({ type, props })
const moduleTable = {
  react: { useSyncExternalStore: () => snapshot },
  'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'fragment' },
}
const sandbox = {
  window: { __ModuleLoader__: { load: entry => { loaded = entry } } },
  console,
}
runInContext(source, createContext(sandbox), { filename: BUNDLE })
check(loaded?.id === PACKAGE_ID, 'browser loader id 使用 model-provider 包名', loaded?.id)
if (loaded === null) process.exit(1)

const exports = loaded.factory(id => {
  if (id in moduleTable) return moduleTable[id]
  throw new Error(`bundle 要求模块表之外的模块 ${String(id)}（应只有 react/react-jsx-runtime external）`)
})

// apply：登记 locale 文案与 conversation.input.right 的 list 占用者。
const localeRegisters = []
const registrations = []
const fakeStore = { subscribe: () => () => {}, getSnapshot: () => snapshot }
const context = {
  effect: (run) => {
    const dispose = run()
    if (typeof dispose !== 'function') throw new Error('locale effect 未返回 disposer')
  },
  locale: { register: (ns, dict) => { localeRegisters.push({ ns, dict }); return () => {} } },
  slots: {
    inject: (slot, factory) => {
      if (slot !== 'conversation.input.right') throw new Error(`注入了意外槽位 ${String(slot)}`)
      const dispose = factory()
      if (typeof dispose !== 'function') throw new Error('槽位登记未返回 disposer')
    },
    register: (options, component) => {
      registrations.push({ options, component })
      return () => {}
    },
  },
  modelDirectories: {
    directoryFor: sessionId => (sessionId === 'session-1' ? { store: fakeStore } : { store: null }),
  },
  sessions: {
    subagentAddress: sessionId => (sessionId === 'sub-session' ? { mode: 'continuable' } : undefined),
  },
}
exports.apply(context)
check(localeRegisters.length === 1, 'apply 登记一份文案')
check(
  localeRegisters[0]?.ns === NAMESPACE
  && localeRegisters[0]?.dict?.zh?.['provider.account'] === 'DeepSeek 账号'
  && localeRegisters[0]?.dict?.en?.['provider.account'] === 'DeepSeek Account',
  '文案命名空间与 deepseek-account 特判词条（中英文）',
  JSON.stringify(localeRegisters[0]?.ns),
)
check(registrations.length === 1, 'conversation.input.right 恰登记一个占用者')
const options = registrations[0]?.options ?? {}
check(options.name === 'conversation.input.right', '登记目标槽位', String(options.name))
check(options.id === NAMESPACE, 'list 条目 id 使用文案命名空间', String(options.id))
check(options.order === 0, 'list 条目 order 为 0', String(options.order))
check(options.locale === NAMESPACE, '条目绑定文案命名空间', String(options.locale))

// 注入面：普通会话得到共享目录 store 且可用；寻址 subagent 会话不可用（与原生座位同判）。
const inject = options.inject
const face = inject('session-1')
check(face?.directory === fakeStore, '注入面提供 modelDirectories 的共享 store')
check(face?.available === true, '普通会话 available=true')
const subFace = inject('sub-session')
check(subFace?.available === false, '寻址 subagent 会话 available=false')

// 显示名纯函数：组名/账号特判/组缺失回退。
const cases = [
  [{ current: { provider: 'zai', model: 'glm' }, groups: [{ id: 'zai', name: 'Z.ai', models: [] }] }, 'Z.ai'],
  [{ current: { provider: 'deepseek-account', model: 'v4' }, groups: [{ id: 'deepseek-account', name: 'deepseek', models: [] }] }, 'DeepSeek 账号'],
  [{ current: { provider: 'zai', model: 'glm' }, groups: [] }, 'zai'],
  [{ current: null, groups: [] }, null],
]
let pureOk = true
for (const [input, expected] of cases) {
  const actual = exports.providerDisplayName(input, 'DeepSeek 账号')
  if (actual !== expected) {
    pureOk = false
    console.log(`[fail] providerDisplayName(${JSON.stringify(input)}) 期望 ${JSON.stringify(expected)}，得到 ${JSON.stringify(actual)}`)
    failures += 1
  }
}
if (pureOk) check(true, `显示名纯函数 ${String(cases.length)} 组断言全部通过`)

// bundle 契约字符串：槽位名与 deepseek-account 特判必须进产物。
check(source.includes('conversation.input.right'), 'bundle 包含槽位名字符串')
check(source.includes('deepseek-account'), 'bundle 包含 deepseek-account 特判字符串')
console.log(failures === 0 ? '\n全部通过。' : `\n${failures} 项未通过。`)
process.exit(failures === 0 ? 0 : 1)
