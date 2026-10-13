/**
 * dsh-kit 精简代理预设及随附 Bundle HMR 的真实宿主端冒烟检查。
 *
 * 每次升级 dsh 后运行：
 *
 *   用法：node scripts/concise-mode-check.mjs [--port 3100]
 *
 * 探针挂载常驻预设作用域、读取注册表，并停用/启用整个套件 Bundle；不发起模型请求，也不创建会话。
 */

import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { runPluginCommand } from '@deepseek-ai/dsh-plugin-manager/operations'
import { DSH_BIN, DSH_INSTALL_ANCHOR, DSH_PROFILE, PNPM_CLI, ROOT } from './local-config.mjs'

const CHANNEL = '/concise-mode-check'
const portAt = process.argv.indexOf('--port')
const PORT = portAt < 0 ? 3100 : Number(process.argv[portAt + 1])
if (!Number.isSafeInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new TypeError('--port must be an integer from 1 to 65535')
}
const AUTHORITY = '127.0.0.1:' + PORT
const BASE = 'http://' + AUTHORITY
const SUITE_PACKAGE = '@dsh-kit/dsh-plugin-suite'
const SUITE_DIRECTORY = join(ROOT, 'plugins', 'suite')
mkdirSync(join(ROOT, '.dev'), { recursive: true })
const HOME = mkdtempSync(join(ROOT, '.dev', 'concise-mode-check-'))
const PROBE = join(HOME, 'concise-mode-check-probe.mjs')
const OVERLAY = join(HOME, 'concise-mode-check-overlay.yml')
const PROJECT_GLOBAL_TOOLS = [
  'service_list', 'service_logs', 'service_restart', 'service_start', 'service_stop',
  'interactive_terminal',
]
const EXPECTED_TOOLS = [
  'read', 'read_image', 'write', 'edit', 'glob', 'grep', 'skill', 'subagent',
  'ask_user_question', 'todo_write', process.platform === 'win32' ? 'pwsh' : 'bash',
  ...PROJECT_GLOBAL_TOOLS,
]
// both 展示模式：注册表与模型协议都看到全部工具 + run_code。
const EXPECTED_REGISTRY_TOOLS = [...EXPECTED_TOOLS, 'run_code']
// 预设站立作用域里保留的提示词段落：persona 那句 + 工具指引 + run_code SDK。
// 名字由 dsh 与各组件行定义，段落集合漂移必须响亮失败（新增部署级段落会落进 unexpected）。
const EXPECTED_SECTIONS = [
  'deployment:persona-prefix', 'deployment:persona-suffix',
  'tool:pwsh', 'tool:read', 'tool:write', 'tool:edit', 'tool:glob', 'tool:grep', 'tool:pty',
  // MCP 未配置服务器时渲染为空，但 section 仍在注册表里可见。
  'mcp-resource-servers',
  'run-code:guidance', 'tools:ptc-only', 'tools:sdk',
]
// 预设作用域里 prompt-filter 摘掉的 dsh 部署级段落。
const DROPPED_SECTIONS = [
  'harness:identity', 'context:file-reference', 'ui:deliverable-file-references', 'harness:source', 'app:web-surface',
]
// 其中这些在部署全局（无作用域）组装里仍然注册：过滤只作用于本预设，不能是全局摘除。
const DEPLOYMENT_SECTIONS = [
  'harness:identity', 'ui:deliverable-file-references', 'harness:source', 'app:web-surface',
]
const PROBE_SOURCE = [
  "export const inject = ['agentPresets', 'tools', 'systemPrompt', 'connection', 'pluginManager']",
  '',
  "const fields = ['id', 'trust', 'name', 'description', 'order', 'broken']",
  'function ownedPreset(preset) {',
  '  const owned = {}',
  '  for (const field of fields) {',
  '    if (preset[field] !== undefined) owned[field] = preset[field]',
  '  }',
  '  return owned',
  '}',
  'function ownedPrompt(entry) {',
  '  return { name: entry.name, text: entry.text }',
  '}',
  'async function snapshotFor(ctx, id) {',
  '  // dsh 0.1.7：standingKeyFor 改为 acquireScope 租约（用后释放）。',
  '  const lease = await ctx.agentPresets.acquireScope(id)',
  '  const scope = lease.key',
  '  try {',
  '  const prompt = await ctx.systemPrompt.assemble({ scope })',
  '  // 部署全局组装（无作用域）：prompt-filter 的监听器只挂在预设作用域，这里必须看不到它。',
  '  const deploymentPrompt = await ctx.systemPrompt.assemble()',
  '  const schemas = ctx.tools.schemas(scope)',
  '  return {',
  '    tools: schemas.map(schema => schema.name),',
  '    parameterNames: Object.fromEntries(schemas.map(schema => [schema.name, Object.keys(schema.parameters.properties ?? {})])),',
  '    wireTools: prompt.tools.map(schema => schema.name),',
  '    systemPrompt: {',
  '      sections: prompt.sections.map(ownedPrompt),',
  '      contexts: prompt.contexts.map(ownedPrompt),',
  '    },',
  '    deploymentSections: deploymentPrompt.sections.map(ownedPrompt),',
  '  }',
  '  } finally { await lease[Symbol.asyncDispose]() }',
  '}',
  'export function apply(ctx) {',
  "  const dispose = ctx.connection.rpc.handle('/concise-mode-check', async (endpoint) => {",
  "    if (endpoint === 'toggle') {",
  `      const disabled = await ctx.pluginManager.setBundleEnabled('${SUITE_PACKAGE}', false)`,
  `      const enabled = await ctx.pluginManager.setBundleEnabled('${SUITE_PACKAGE}', true)`,
  '      return { ok: true, value: { disabled, enabled } }',
  '    }',
  "    if (endpoint !== 'snapshot') {",
  '      return { ok: false, error: {',
  "        code: 'concise-mode-check/unknown-endpoint',",
  "        message: 'unknown endpoint ' + endpoint,",
  '        details: {},',
  '      } }',
  '    }',
    '    const roster = await ctx.agentPresets.list()',
    "    const concise = await snapshotFor(ctx, 'concise')",
    '    return { ok: true, value: {',
    '      roster: roster.map(ownedPreset),',
    '      concise,',
    '      globalTools: ctx.tools.schemas().map(schema => schema.name),',
    '    } }',
  '  })',
  "  ctx.effect(() => () => void dispose(), 'concise-mode-check: private RPC probe')",
  '}',
  '',
].join('\n')

let failures = 0
function check(ok, label, detail) {
  if (!ok) failures += 1
  console.log((ok ? '[ok]  ' : '[fail]') + label + (detail === undefined ? '' : ' — ' + detail))
}
function browserHeaders(cookie) {
  return {
    host: AUTHORITY,
    origin: BASE,
    'sec-fetch-site': 'same-origin',
    ...(cookie === undefined ? {} : { cookie }),
  }
}
async function prepareHome() {
  const profile = join(HOME, 'profiles', DSH_PROFILE)
  // 套件 patch 与物化依赖闭包是安装输入：dist 由 pnpm plugins:build 提供，
  // 这里重新生成 patch 与 node_modules，避免用上一次构建的陈旧产物做冒烟。
  const suiteBuild = spawnSync(process.execPath, ['scripts/build-suite.mjs'], { cwd: ROOT, stdio: 'inherit' })
  if (suiteBuild.status !== 0) throw new Error('scripts/build-suite.mjs 失败：先运行 pnpm plugins:build')
  mkdirSync(profile, { recursive: true })
  writeFileSync(join(profile, 'package.json'), `${JSON.stringify({
    name: `dsh-profile-${DSH_PROFILE}`,
    private: true,
    dependencies: {},
    dsh: { profile: { bundles: [
      '@deepseek-ai/dsh-base',
      '@deepseek-ai/dsh-web-app',
      SUITE_PACKAGE,
    ] } },
  }, null, 2)}\n`)
  writeFileSync(join(profile, 'cordis.patch.yml'), '[]\n')
  writeFileSync(join(profile, 'pnpm-workspace.yaml'), 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n')
  const install = await runPluginCommand({
    profile: DSH_PROFILE,
    dir: profile,
    home: HOME,
    installAnchor: DSH_INSTALL_ANCHOR,
    cwd: ROOT,
  }, ['add', SUITE_DIRECTORY], {
    execution: 'service',
    outputBytes: 64 * 1024,
    activateNewBundles: false,
    command: process.execPath,
    args: [PNPM_CLI],
  })
  if (install.exitCode !== 0) throw new Error(`安装冒烟插件失败：${install.output || install.logPath}`)
  writeFileSync(PROBE, PROBE_SOURCE, 'utf8')
  writeFileSync(OVERLAY, "- insert:\n    - id: concise-mode-check\n      name: './concise-mode-check-probe.mjs'\n", 'utf8')
}

/**
 * 单独返回生成的子进程和就绪 Promise。调用方会在等待就绪前赋值 child，
 * 这样就绪失败时不会泄漏进程。
 */
function startDsh() {
  // 探针 overlay 是本脚本私有的宿主端挂载点，与用户 profile 无关。
  const overlays = [OVERLAY]
  // bundle 定位器不能使用环境变量，因为 local-config
  // 已经通过 createRequire 从真实的 launcher 依赖中解析 DSH_BIN。
  const child = spawn(process.execPath, [
    DSH_BIN, '--profile', DSH_PROFILE,
    ...overlays.flatMap(overlay => ['--patch', overlay]),
    '--no-open', '--host', '127.0.0.1', '--port', String(PORT),
    '--trusted-host', AUTHORITY,
  ], {
    cwd: ROOT,
    env: { ...process.env, DSH_HOME: HOME },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  })
  const ready = new Promise((resolve, reject) => {
    let output = ''
    let settled = false
    const timer = setTimeout(() => finish(reject,
      new Error('dsh did not print a launch token within 60 seconds:\n' + output)), 60000)
    function finish(action, value) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      action(value)
    }
    function scan(chunk) {
      output = (output + String(chunk)).slice(-128000)
      const match = /dsh web:\s*(\S+)/u.exec(output)
      if (match === null) return
      try {
        const token = new URL(match[1]).searchParams.get('token')
        if (token) finish(resolve, token)
      } catch {
        // 部分输出块很正常；后续有更多输出时再次扫描。
      }
    }
    child.stdout.on('data', scan)
    child.stderr.on('data', scan)
    child.once('error', error => finish(reject, error))
    child.once('exit', (code, signal) => finish(reject,
      new Error('dsh exited before readiness (code=' + code + ', signal=' + signal + '):\n' + output)))
  })
  return { child, ready }
}

async function stopChildTree(child) {
  if (child?.pid === undefined) return
  if (process.platform === 'win32') {
    await new Promise(resolve => {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
      killer.once('error', resolve)
      killer.once('exit', resolve)
    })
    return
  }
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error
  }
  await delay(1500)
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error
  }
}

async function exchangeCookie(token) {
  const response = await fetch(BASE + '/?token=' + encodeURIComponent(token), {
    redirect: 'manual', headers: browserHeaders(),
  })
  const setCookies = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean)
  const cookie = setCookies.map(value => value.split(';', 1)[0]).join('; ')
  if (response.status !== 303 || cookie === '') {
    throw new Error('token exchange failed: status=' + response.status + ', cookie=' + (cookie ? 'present' : 'absent'))
  }
  return cookie
}

async function callProbe(cookie, endpoint) {
  const rpcId = randomUUID()
  const response = await fetch(BASE + CHANNEL + '/' + endpoint, {
    method: 'POST',
    headers: { ...browserHeaders(cookie), 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId, method: endpoint, payload: {} }),
  })
  const text = await response.text()
  let body
  try { body = JSON.parse(text) } catch {
    throw new Error(endpoint + ' returned non-JSON: status=' + response.status + ', body=' + text.slice(0, 500))
  }
  if (response.status !== 200 || body?.type !== 'server-response'
    || body?.rpcId !== rpcId || body?.result?.ok !== true) {
    throw new Error(endpoint + ' RPC failed: status=' + response.status + ', body=' + JSON.stringify(body).slice(0, 1000))
  }
  return body.result.value
}

function diagnoseTools(actual, expectedTools, label) {
  const expected = new Set(expectedTools)
  const actualSet = new Set(actual)
  const missing = expectedTools.filter(name => !actualSet.has(name)).toSorted()
  const unexpected = [...actualSet].filter(name => !expected.has(name)).toSorted()
  const counts = new Map()
  for (const name of actual) counts.set(name, (counts.get(name) ?? 0) + 1)
  const duplicates = [...counts].filter(([, count]) => count > 1)
    .map(([name, count]) => name + '×' + count).toSorted()
  const detail = 'expected total=' + expectedTools.length
    + '; actual total=' + actual.length
    + '; missing=[' + missing.join(', ') + ']'
    + '; unexpected=[' + unexpected.join(', ') + ']'
    + '; duplicates=[' + duplicates.join(', ') + ']'
  check(missing.length === 0 && unexpected.length === 0 && duplicates.length === 0
    && actual.length === expectedTools.length, label + ' tool set is exact', detail)
}

function diagnoseSections(actual, label) {
  const expected = new Set(EXPECTED_SECTIONS)
  const actualSet = new Set(actual)
  const missing = EXPECTED_SECTIONS.filter(name => !actualSet.has(name)).toSorted()
  const unexpected = [...actualSet].filter(name => !expected.has(name)).toSorted()
  const counts = new Map()
  for (const name of actual) counts.set(name, (counts.get(name) ?? 0) + 1)
  const duplicates = [...counts].filter(([, count]) => count > 1)
    .map(([name, count]) => name + '×' + count).toSorted()
  check(missing.length === 0 && unexpected.length === 0 && duplicates.length === 0
    && actual.length === EXPECTED_SECTIONS.length, label + ' section set is exact',
  'expected total=' + EXPECTED_SECTIONS.length
    + '; actual total=' + actual.length
    + '; missing=[' + missing.join(', ') + ']'
    + '; unexpected=[' + unexpected.join(', ') + ']'
    + '; duplicates=[' + duplicates.join(', ') + ']')
}

function diagnoseForbidden(actual) {
  const groups = [
    ['job_*', name => name.startsWith('job_')],
    ['goal tools create_goal/get_goal/update_goal', name => ['create_goal', 'get_goal', 'update_goal'].includes(name)],
    ['exit_plan_mode', name => name === 'exit_plan_mode'],
    ['workflow', name => name === 'workflow'],
    ['ralph', name => name === 'ralph'],
    ['web_*', name => name.startsWith('web_')],
    ['subagent_fork', name => name === 'subagent_fork'],
    ['control tools interrupt_agent/list_agents/send_message',
      name => ['interrupt_agent', 'list_agents', 'send_message'].includes(name)],
  ]
  for (const [label, forbidden] of groups) {
    const present = actual.filter(forbidden).toSorted()
    check(present.length === 0, 'forbidden ' + label + ' absent', 'present=[' + present.join(', ') + ']')
  }
}

async function main() {
  let child
  try {
    await prepareHome()
    const launch = startDsh()
    child = launch.child
    const token = await launch.ready
    const cookie = await exchangeCookie(token)
    await delay(1000)
    const value = await callProbe(cookie, 'snapshot')
    check(true, 'snapshot RPC completed, so concise standing mount succeeded')

    const roster = Array.isArray(value?.roster) ? value.roster : []
    const concisePreset = roster.find(preset => preset?.id === 'concise')
    check(concisePreset !== undefined, 'concise preset exists in the roster')
    check(concisePreset?.name === '简洁模式', 'concise preset name is exactly 简洁模式',
      'actual=' + JSON.stringify(concisePreset?.name))
    check(concisePreset !== undefined && !Object.hasOwn(concisePreset, 'broken'),
      'concise preset has no broken property', 'keys=[' + Object.keys(concisePreset ?? {}).toSorted().join(', ') + ']')
    check(!roster.some(preset => preset?.id === 'concise-ptc'),
      'concise-ptc preset is gone from the roster')

    const globalTools = Array.isArray(value?.globalTools) ? value.globalTools : []
    const sortedGlobalTools = globalTools.toSorted()
    const sortedExpectedGlobals = PROJECT_GLOBAL_TOOLS.toSorted()
    check(JSON.stringify(sortedGlobalTools) === JSON.stringify(sortedExpectedGlobals),
      'project tools are exactly the six global tools',
      'expected=[' + sortedExpectedGlobals.join(', ') + ']; actual=[' + sortedGlobalTools.join(', ') + ']')

    const conciseTools = Array.isArray(value?.concise?.tools) ? value.concise.tools : []
    diagnoseTools(conciseTools, EXPECTED_REGISTRY_TOOLS, 'concise registry')
    diagnoseForbidden(conciseTools)
    const conciseParameters = value?.concise?.parameterNames ?? {}
    for (const tool of [process.platform === 'win32' ? 'pwsh' : 'bash', 'subagent']) {
      check(Array.isArray(conciseParameters[tool]) && !conciseParameters[tool].includes('run_in_background'),
        'concise ' + tool + ' schema omits run_in_background')
    }
    check(Array.isArray(conciseParameters.run_code)
      && conciseParameters.run_code.includes('code') && conciseParameters.run_code.includes('description'),
      'concise run_code schema carries code and description',
      'actual=' + JSON.stringify(conciseParameters.run_code))
    // both 展示模式：模型协议与注册表一致（全部工具 + run_code），直呼不被收缩。
    const conciseWireTools = Array.isArray(value?.concise?.wireTools) ? value.concise.wireTools : []
    check(JSON.stringify(conciseWireTools.toSorted()) === JSON.stringify(EXPECTED_REGISTRY_TOOLS.toSorted()),
      'concise exposes native tools and run_code together to the model',
      'actual=[' + conciseWireTools.toSorted().join(', ') + ']')
    const conciseSections = Array.isArray(value?.concise?.systemPrompt?.sections)
      ? value.concise.systemPrompt.sections : []
    const persona = conciseSections.find(section => section?.name === 'deployment:persona-prefix')
    check(persona?.text === 'You are a helpful software engineer assistant.',
      'concise persona prefix replaces the deployment persona',
      'actual=' + JSON.stringify(persona?.text))
    const conciseSectionNames = conciseSections
      .map(section => section?.name).filter(sectionName => typeof sectionName === 'string')
    check(conciseSectionNames[0] === 'deployment:persona-prefix',
      'concise prompt starts at the minimal persona line',
      'actual=[' + conciseSectionNames.join(', ') + ']')
    diagnoseSections(conciseSectionNames, 'concise prompt')
    const stillPresent = DROPPED_SECTIONS.filter(sectionName => conciseSectionNames.includes(sectionName))
    check(stillPresent.length === 0, 'deployment-level prompt sections stay out of the preset scope',
      'present=[' + stillPresent.join(', ') + ']')
    const deploymentNames = (Array.isArray(value?.concise?.deploymentSections) ? value.concise.deploymentSections : [])
      .map(section => section?.name).filter(sectionName => typeof sectionName === 'string')
    if (deploymentNames.length === 0) {
      throw new Error('probe returned no deployment assembly sections: value.concise.deploymentSections is missing')
    }
    const deploymentMissing = DEPLOYMENT_SECTIONS.filter(sectionName => !deploymentNames.includes(sectionName))
    check(deploymentMissing.length === 0, 'prompt-filter leaves the deployment assembly untouched',
      'missing=[' + deploymentMissing.join(', ') + ']; actual=[' + deploymentNames.join(', ') + ']')
    const sdk = conciseSections.find(section => section?.name === 'tools:sdk')?.text
    check(typeof sdk === 'string' && sdk.includes('Program-only SDK bindings:'),
      'concise keeps the generated PTC SDK section')
    for (const tool of EXPECTED_TOOLS) {
      check(typeof sdk === 'string' && sdk.includes('  ' + tool + ':'),
        'concise SDK declares ' + tool)
    }
    const guidanceIndex = conciseSectionNames.indexOf('run-code:guidance')
    const guidance = conciseSections.find(section => section?.name === 'run-code:guidance')?.text
    check(typeof guidance === 'string'
      && guidance.includes('Call tools directly whenever a step is a single call')
      && guidance.includes('Never wrap a single tool call'),
    'run-code guidance defaults to direct calls', 'actual=' + JSON.stringify(guidance))
    // 频道规则必须早于各工具指引与 SDK 被读到（dsh 自己的 ptc 模式规则也在 PTC_ONLY 槽位）。
    check(guidanceIndex > 0
      && guidanceIndex < conciseSectionNames.indexOf('tools:sdk')
      && guidanceIndex < conciseSectionNames.indexOf('tool:pwsh'),
    'run-code guidance is read before the tool sections and the SDK',
    'guidanceIndex=' + guidanceIndex + '; order=[' + conciseSectionNames.join(', ') + ']')
    const ptcOnly = conciseSections.find(section => section?.name === 'tools:ptc-only')?.text ?? ''
    check(!ptcOnly.includes('`run_code` is the only tool you can call directly'),
      'both mode keeps direct tool calls allowed (no collapse instruction)')
    const conciseContexts = value?.concise?.systemPrompt?.contexts
    check(Array.isArray(conciseContexts) && conciseContexts.length === 0,
      'concise system prompt contexts are exactly empty', 'actual=' + JSON.stringify(conciseContexts))

    const toggle = await callProbe(cookie, 'toggle')
    check(toggle?.disabled?.application === 'applied' && toggle.disabled.warnings?.length === 0,
      'suite Bundle disables through live Profile HMR', JSON.stringify(toggle?.disabled))
    check(toggle?.enabled?.application === 'applied' && toggle.enabled.warnings?.length === 0,
      'suite Bundle re-enables through live Profile HMR', JSON.stringify(toggle?.enabled))
    const restored = await callProbe(cookie, 'snapshot')
    check(restored?.roster?.some(preset => preset?.id === 'concise'),
      'concise preset returns after live re-enable')

    if (failures !== 0) throw new Error(failures + ' concise-mode/HMR smoke assertion(s) failed')
    console.log('\nAll concise-mode and distributed Bundle HMR checks passed.')
  } finally {
    try {
      await stopChildTree(child)
    } finally {
      rmSync(HOME, { recursive: true, force: true })
    }
  }
}

try {
  await main()
} catch (error) {
  console.error('\n[fail] ' + (error instanceof Error ? error.stack ?? error.message : String(error)))
  process.exitCode = 1
}
