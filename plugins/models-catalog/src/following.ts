/** 官方 DeepSeek 路由的原生跟随判定：决定 pi-ai `deepseek` 路由的建议是否已被官方覆盖。 */

import { isBuiltInCatalog, PUBLIC_BASE_URL } from '@deepseek-ai/dsh-llm-deepseek'
import type { Context } from '@deepseek-ai/cordis'
// 仅类型：读取 settings 服务与 llm provider 列表。
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-llm'

/** 官方 API origin；只有它提供 `/models` 列表跟随（与 llm-deepseek-api-key 同判）。 */
const OFFICIAL_ORIGIN = new URL(PUBLIC_BASE_URL).origin

/**
 * 判定一条 DeepSeek 传输配置是否正在原生跟随官方 `/models` 列表。
 * 判定与 `llm-deepseek-api-key` 的 resolveAdapterOptions 一致：origin 为官方端点，
 * 且 `models` 等于内置目录；settings 未写入 `models` 时视为内置。
 * 环境变量 `DEEPSEEK_BASE_URL` 覆盖不在读取范围内，此时按官方端点判定——
 * 宁可在非官方网关场景漏提示，不误报「已跟随」。
 * @param baseURL - settings 中的 `baseURL` 字段；缺席为默认官方端点。
 * @param models - settings 中的 `models` 字段；缺席视为内置目录。
 * @returns 跟随中为 true。
 */
export function followingOfficial(baseURL: unknown, models: unknown): boolean {
  if (baseURL !== undefined && (typeof baseURL !== 'string' || baseURL === '')) return false
  let origin: string
  try {
    origin = new URL(typeof baseURL === 'string' ? baseURL : PUBLIC_BASE_URL).origin
  } catch {
    return false
  }
  if (origin !== OFFICIAL_ORIGIN) return false
  if (models === undefined || models === null) return true
  if (!Array.isArray(models)) return false
  return isBuiltInCatalog(models as Parameters<typeof isBuiltInCatalog>[0])
}

/**
 * 读取官方路由（provider `deepseek-official`）的传输配置并判定跟随状态。
 * 该行未装载（如 deepseek-official-switch 停用后行消失）或读取失败时返回 false——
 * 按「无原生覆盖」处理，插件照常给出建议。
 * @param ctx - 宿主 Context（inject 含 `settings` 与 `llm`）。
 * @returns 官方路由正在跟随为 true。
 */
export function deepseekFollowing(ctx: Context): boolean {
  try {
    const entry = ctx.llm.listConfigurableProviders().find(item => item.provider === 'deepseek-official')
    if (entry === undefined) return false
    const value = ctx.settings.describe().find(row => row.ns === entry.settingsNs)?.value
    const config = typeof value === 'object' && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {}
    return followingOfficial(config['baseURL'], config['models'])
  } catch {
    return false
  }
}
