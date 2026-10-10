/**
 * run_code 工具插件：把 dsh 的 PTC 运行时开放为模型可自主选择的工具。
 *
 * dsh 的工具展示模式分 native / ptc / both 三档：ptc 把全部工具收进一个 run_code 程序，
 * both 让原生工具与 run_code 并存、由模型自己决定每步怎么用（等价 pi codemode 的
 * 「mode on」）。本插件只挂在 Agent 预设的 config.plugins 内使用——presentAs 要求
 * scoped context，进程级默认值属于 tools 行的 mode 配置，都不是本插件的用法。
 * 程序执行、SDK 生成、审批与子调用调度全部复用 dsh 官方实现，本包不含任何运行时。
 */

import type { Context } from '@deepseek-ai/cordis'
// 仅类型：启用 ctx.tools 与 ctx.systemPrompt 的 Context 合并。
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'

/** dsh 诊断信息中显示的 Cordis 插件名。 */
export const name = 'dsh-remote-run-code'

/** 必需服务：tools 声明展示模式，systemPrompt 注册使用指引。 */
export const inject = ['tools', 'systemPrompt']

/** 使用指引 section 的名字；排在官方 tools:sdk（TOOLS_SDK）之后。 */
export const GUIDANCE_SECTION = 'run-code:guidance'

/** 何时优先写 run_code 程序、何时直呼工具（对齐 pi codemode 的 guideline）。 */
export const GUIDANCE_TEXT = [
  'Tools are available two ways: called directly, or composed inside one `run_code` program.',
  'Prefer `run_code` when a step needs several independent tool calls (run them concurrently with `Promise.all`),',
  'when later calls depend on earlier results, or when tool outputs are large and only a distilled part matters —',
  'intermediate results stay out of the conversation, so extract just what you need.',
  'For a single straightforward call, invoke the tool directly.',
].join(' ')

/**
 * 为所在预设作用域声明 both 展示模式并追加使用指引。
 * @param ctx - 预设行挂载的 scoped context。
 */
export function apply(ctx: Context): void {
  // 与官方 @deepseek-ai/dsh-agent-tool-presentation 相同的等待模式：ptcRuntime 未就绪时
  // 行保持 pending、由 preset 注册表审计点名，而不是等到首个请求才失败。
  ctx.inject(['ptcRuntime'], (runtimeCtx: Context) => {
    runtimeCtx.tools.presentAs('both')
  })
  ctx.effect(() => ctx.systemPrompt.section({
    name: GUIDANCE_SECTION,
    order: ctx.systemPrompt.getSectionOrder('TOOLS_SDK') + 100,
    text: GUIDANCE_TEXT,
  }), 'run-code.guidance()')
}
