// 套件浏览器行完整性校验：向运行中的 dsh 宿主换取 token cookie，解析首页注入的
// __DSH_BOOT__ 图，断言套件全部声明 dsh.client 的组件行都在图中。装载层回归
// （如某组件行被停用、patch 改写错误、首图组成不完整）时非零退出。
// 注意：本脚本只覆盖「宿主图组成」这一层；浏览器半的功能验收仍按
// docs/05-roadmap.md 的插件实机验收表执行，渲染期崩溃要靠 ELECTRON_ENABLE_LOGGING。
//
// 用法：node scripts/verify-suite-client.mjs --token <dsh 启动打印的 token>
//       [--host http://127.0.0.1:19387]（默认 3180，即 pnpm dev 的开发实例）
import { readFileSync } from 'node:fs'

const args = process.argv.slice(2)
function argValue(name, fallback) {
  const index = args.indexOf(name)
  return index !== -1 && args[index + 1] !== undefined ? args[index + 1] : fallback
}
const host = argValue('--host', 'http://127.0.0.1:3180')
const tokenFile = argValue('--token-file')
const token = argValue('--token', tokenFile === undefined ? undefined : readFileSync(tokenFile, 'utf8').trim())
if (token === undefined || token === '') {
  throw new Error('缺少 --token（dsh 启动打印的地址里 ?token= 的值）或 --token-file')
}

// 与 plugin-catalog.json 对齐：声明 dsh.client 且随套件分发的浏览器行。
const EXPECTED = [
  'agents-md', 'chat-scroll', 'copilot-auth', 'deepseek-official-switch', 'favorite-models', 'files',
  'model-capabilities', 'model-provider', 'models-catalog', 'notify', 'proxy', 'services', 'session-rename',
  'session-workspace', 'skills-inspector', 'stats-hours', 'terminal', 'tools-inspector', 'turn-retry',
  'user-message-fork', 'web-search-switch', 'workspace-collapse', 'workspace-path',
].map(id => `@dsh-kit/dsh-plugin-${id}`)

const exchange = await fetch(`${host}/?token=${encodeURIComponent(token)}`, { redirect: 'manual' })
const cookie = (exchange.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ')
if (exchange.status !== 303 || cookie === '') {
  throw new Error(`token 交换失败：HTTP ${String(exchange.status)}（token 是否过期？重启宿主后重试）`)
}

const index = await (await fetch(host, { headers: { cookie } })).text()
const marker = index.indexOf('__DSH_BOOT__')
if (marker === -1) throw new Error('首页未注入 __DSH_BOOT__ 图')
const start = index.indexOf('=', marker) + 1
const graph = JSON.parse(index.slice(start, index.indexOf('</script>', start)).trim().replace(/;$/, ''))

const present = new Set(graph.entries.map(entry => entry.id))
const missing = EXPECTED.filter(id => !present.has(id))
const extra = [...present].filter(id => id.startsWith('@dsh-kit/') && !EXPECTED.includes(id))
process.stdout.write(
  `图 rev=${graph.rev} 共 ${String(graph.entries.length)} 行，套件浏览器行 ${String(EXPECTED.length - missing.length)}/${String(EXPECTED.length)}\n`,
)
if (extra.length > 0) process.stdout.write(`套件外 @dsh-kit 行：${extra.join(', ')}\n`)
if (missing.length > 0) {
  process.stdout.write(`缺失：${missing.join(', ')}\n`)
  process.exitCode = 1
} else {
  process.stdout.write('套件浏览器行完整\n')
}
