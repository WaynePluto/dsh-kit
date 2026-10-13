/**
 * 预设作用域的系统提示词段落过滤。
 *
 * 为什么需要它：dsh 的 persona 行只有 `complete` 一个开关，表达不了「只保留 persona +
 * 工具 section」这个中间态——false 只替换 persona 槽位（`deployment:persona-prefix`），
 * 部署级注册的 section 一条也过滤不掉；true 把整个 system prompt 覆盖成 persona 那一句，
 * 连 `tools:sdk` 与工具指引一起滤掉，run_code 就看不到 `tools.*` 声明。本行补中间态：
 * config 点名的 section 不进本预设的提示词，其余原样保留。
 *
 * 机制：dsh 的 `system-prompt/assemble` 是按作用域路由的 waterfall——注册在祖先作用域的
 * 监听器收得到每个后代 agent 的组装（见 @deepseek-ai/dsh-scope 的 scopeTarget 祖先准入），
 * 其返回的 assembly 即最终结果（只有 complete section 会在之后被还原）。本行只挂在 Agent
 * 预设的 `config.plugins` 里，因此只影响该预设作用域下的 agent；其他预设与部署全局不变。
 *
 * 只摘 section，不动能力：被摘掉文案的插件、服务与工具仍在，模型仍能正常调用它们。
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
// 仅类型：合并 Context 的 'system-prompt/assemble' 事件与 PromptAssembly 结构。
import type {} from '@deepseek-ai/dsh-system-prompt'

/** dsh 诊断信息中显示的 Cordis 插件名。 */
export const name = 'dsh-kit-prompt-filter'

/** 本插件行的 composition Config；section 名是 dsh 注册名（如 `harness:identity`）。 */
export interface Config {
  /** 要从本预设作用域的提示词里摘掉的 section 名清单。 */
  dropSections: string[]
}

/** dsh Loader 从本导出解析并校验行 config。 */
export const Config = z.object({
  dropSections: z.array(z.string()).required(),
})

/**
 * 在所在预设作用域里摘掉 config 点名的 system-prompt section。
 * @param ctx - 预设行挂载的 scoped context。
 * @param config - 要摘掉的 section 名清单。
 */
export function apply(ctx: Context, config: Config): void {
  const dropped = new Set(config.dropSections)
  if (dropped.size === 0) {
    // 空名单只会静默什么都不做，是配置错误；装载即响亮失败。
    throw new Error('prompt-filter: dropSections must name at least one system-prompt section')
  }
  ctx.effect(() => ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    // 先让下游组装完成（含 tools:sdk 生成），再按名摘除。
    const assembly = await next()
    const sections = assembly.sections.filter(section => !dropped.has(section.name))
    // 没有命中时返回同一引用，不给无关组装制造新对象。
    return sections.length === assembly.sections.length ? assembly : { ...assembly, sections }
  }), 'prompt-filter.dropSections()')
}