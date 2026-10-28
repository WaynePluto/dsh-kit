/** 宿主半：注册 kit 私有 /api 通道，`check` 端点比对套件当前版本与 GitHub latest Release。 */

import type { Context } from '@deepseek-ai/cordis'
// 仅类型：启用本插件读取的 ctx.connection / ctx.pluginManager Context 合并。
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-plugin-manager'
import { registerKitChannel } from '@dsh-kit/plugin-rpc'
import {
  buildUpgradeUrl, CHANNEL, CHECK_ENDPOINT, compareVersions, GITHUB_REPO,
  GITHUB_UNREACHABLE_CODE, SUITE_NOT_FOUND_CODE, stripLeadingV, SUITE_PACKAGE,
  UNKNOWN_ENDPOINT_CODE,
} from './shared.js'
import type { UpdateCheck } from './shared.js'

export { buildUpgradeUrl, CHANNEL, CHECK_ENDPOINT, compareVersions, stripLeadingV } from './shared.js'
export type { UpdateCheck } from './shared.js'

/** Cordis 插件名；它会出现在 dsh 插件树和诊断信息中。 */
export const name = 'dsh-kit-suite-updates'

/** 必需服务：`connection` 承载 /api 桥注册，`pluginManager` 读套件已装版本。 */
export const inject = ['connection', 'pluginManager']

/** 查询 GitHub latest Release 的超时（毫秒）；无认证限额 60 次/小时，手动触发足够。 */
const GITHUB_TIMEOUT_MS = 10_000

/** pluginManager.listBundles 返回里本插件用到的最小结构。 */
export interface BundleLike {
  readonly name: string
  readonly version?: string
}

/** 业务失败折叠成 kit 结果信封。 */
function failure(code: string, message: string): {
  ok: false
  error: { code: string; message: string; details: Record<string, never> }
} {
  return { ok: false, error: { code, message, details: {} } }
}

/**
 * 检查一次更新：套件当前版本来自插件管理器的 Bundle 清单（profile 依赖闭包里的
 * 套件 manifest），最新版本来自 GitHub `releases/latest` 公开 API。升级地址是
 * 带 tag 的固定名资产（D21），与本仓库 README 与发布产物的形式一致。
 */
export async function checkForUpdate(listBundles: () => Promise<readonly BundleLike[]>): Promise<
  { ok: true; value: UpdateCheck } | { ok: false; error: { code: string; message: string; details: Record<string, string> } }
> {
  const bundles = await listBundles()
  const current = bundles.find(bundle => bundle.name === SUITE_PACKAGE)?.version
  if (current === undefined) {
    return failure(SUITE_NOT_FOUND_CODE, `profile 里没有解析到 ${SUITE_PACKAGE} 的版本`)
  }
  let response: Response | undefined
  try {
    response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'dsh-kit-suite-updates' },
      signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
    })
  } catch (error) {
    return failure(GITHUB_UNREACHABLE_CODE, `GitHub 查询失败：${error instanceof Error ? error.message : String(error)}`)
  }
  if (!response.ok) {
    return failure(GITHUB_UNREACHABLE_CODE, `GitHub 查询失败：HTTP ${String(response.status)}`)
  }
  let body: unknown
  try { body = await response.json() } catch { body = undefined }
  const tag = typeof body === 'object' && body !== null && typeof (body as { tag_name?: unknown }).tag_name === 'string'
    ? (body as { tag_name: string }).tag_name
    : undefined
  if (tag === undefined || stripLeadingV(tag) === '') {
    return failure(GITHUB_UNREACHABLE_CODE, 'GitHub 响应里没有可用的 tag_name')
  }
  const latest = stripLeadingV(tag)
  return {
    ok: true,
    value: {
      current,
      latest,
      tag,
      hasUpdate: compareVersions(latest, current) > 0,
      url: buildUpgradeUrl(tag),
    },
  }
}

/** 注册 kit 通道并挂接生命周期。 */
export function apply(ctx: Context): void {
  const dispose = registerKitChannel(ctx, CHANNEL, async (endpoint) => {
    if (endpoint !== CHECK_ENDPOINT) {
      return failure(UNKNOWN_ENDPOINT_CODE, `unknown endpoint: ${endpoint}`)
    }
    return checkForUpdate(() => ctx.pluginManager.listBundles())
  })
  ctx.effect(() => () => { void dispose() }, 'suite-updates: channel')
}
