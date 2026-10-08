/**
 * 在不启动 dsh 或打开页面的情况下，对 web-search-switch 浏览器产物做冒烟检查：
 * 在小型浏览器模块 shim 中执行构建后的加载器包装，验证文案命名空间与
 * plugins.bundle.config keyed 槽注册，并确认产物内联了官方行模块名与双语文案。
 *
 * 构建插件后运行：
 *
 *   用法：node scripts/web-search-switch-check.mjs
 */

import { createContext, runInContext } from 'node:vm'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './local-config.mjs'

const PACKAGE_ID = '@dsh-station/dsh-plugin-web-search-switch'
const BUNDLE = join(ROOT, 'packages', 'plugins', 'web-search-switch', 'dist', 'client.js')
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
const react = {
  useCallback: (fn) => fn,
  useEffect: NOOP,
  useState: (initial) => [initial, NOOP],
}
const sandbox = {
  window: { __ModuleLoader__: { load: entry => { loaded = entry } } },
  console,
  document: {
    getElementById: () => null,
    createElement: () => ({ id: '', textContent: '', remove: NOOP }),
    head: { append: el => { styleEls.push(el) } },
  },
}
const styleEls = []
runInContext(source, createContext(sandbox), { filename: BUNDLE })
check(loaded?.id === PACKAGE_ID, 'browser loader id 使用 web-search-switch 包名', loaded?.id)
if (loaded === null) process.exit(1)

const exports = loaded.factory(id => {
  if (id === 'react') return react
  if (id === 'react/jsx-runtime') return { Fragment: NOOP, jsx: NOOP, jsxs: NOOP }
  if (id === '@deepseek-ai/dsh-client-ui-primitives') return { Switch: NOOP }
  throw new Error(`bundle 要求页面模块表之外的模块：${id}`)
})
const registrations = []
const namespaces = []
const context = {
  effect: run => { run(); return NOOP },
  locale: {
    register: namespace => { namespaces.push(namespace); return NOOP },
    bind: () => (key, values) => (values === undefined ? key : `${key}:${JSON.stringify(values)}`),
  },
  slots: {
    inject: (_name, run) => { run() },
    register: options => { registrations.push(options); return NOOP },
  },
  remote: { pluginManager: {}, pluginInventory: {} },
}
exports.apply(context)
const config = registrations.find(entry => entry.name === 'plugins.bundle.config')
check(namespaces.includes('dsh-plugin-web-search-switch'), '注册 web-search-switch 文案命名空间')
check(config?.key === PACKAGE_ID, '以本 Bundle 包名为 key 注册 plugins.bundle.config', JSON.stringify(config))
if (config !== undefined) {
  const injected = config.inject()
  check(typeof injected.t === 'function' && typeof injected.controller?.read === 'function'
    && typeof injected.controller?.setEnabled === 'function', '槽位注入文案函数与官方 pluginManager 控制器')
}
check(source.includes('@deepseek-ai/dsh-web-search-deepseek'), '产物内联官方网页搜索行模块名')
check(source.includes('pluginInventory') && source.includes('setPluginEnabled'), '产物经官方 pluginManager/pluginInventory 远程服务操作')
check(source.includes('重启 dsh 后生效') && source.includes('Restart dsh to apply'), '产物包含中英文重启提示文案')
check(styleEls.length === 1 && styleEls[0].textContent.includes('--dsw-alias-label-primary'), '安装局部样式表并使用原生主题 token')
console.log(failures === 0 ? '\n全部通过。' : `\n${failures} 项未通过。`)
process.exit(failures === 0 ? 0 : 1)
