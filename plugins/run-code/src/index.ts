/**
 * run_code 工具插件：把 dsh 的 PTC 运行时开放为模型可自主选择的工具。
 *
 * dsh 的工具展示模式分 native / ptc / both 三档：ptc 把全部工具收进一个 run_code 程序，
 * both 让原生工具与 run_code 并存、由模型自己决定每步怎么用（等价 pi codemode 的
 * 「mode on」）。本插件只挂在 Agent 预设的 config.plugins 内使用——presentAs 要求
 * scoped context，进程级默认值属于 tools 行的 mode 配置，都不是本插件的用法。
 * 程序执行、SDK 生成、审批与子调用调度全部复用 dsh 官方实现，本包不含任何运行时。
 *
 * 频道选择规则（本包唯一的模型可见文案）注册在工具指引与 tools:sdk 之前：dsh 自己的
 * 「ptc 模式只能直呼 run_code」规则同样放在 tools:ptc-only 槽位（PTC_ONLY=800）而不是
 * SDK 之后，理由是该规则必须早于各工具的指引被读到；both 模式下这一槽位渲染为空，
 * 本行的指引就落在它后面。措辞按「默认直呼、程序只用于一步内多次调用」写死：
 * 真机 A/B（同一提示词、同一模型）里，旧措辞的单工具任务会写单调用程序，
 * 新措辞单工具任务一律直呼，而并行多调用任务仍然写程序。
 */

import type { Context } from '@deepseek-ai/cordis'
// 仅类型：启用 ctx.tools 与 ctx.systemPrompt 的 Context 合并。
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'

/** dsh 诊断信息中显示的 Cordis 插件名。 */
export const name = 'dsh-kit-run-code'

/** 必需服务：tools 声明展示模式，systemPrompt 注册使用指引。 */
export const inject = ['tools', 'systemPrompt']

/** 使用指引 section 的名字；位置在 tools:ptc-only（PTC_ONLY）之后、工具指引与 tools:sdk 之前。 */
export const GUIDANCE_SECTION = 'run-code:guidance'

/**
 * 何时直呼工具、何时写 run_code 程序：默认直呼，程序只用于一步内多次调用。
 * 模型可见文案，保持英文；句子顺序即优先级（默认 → 例外 → 禁止 → 例子）。
 */
export const GUIDANCE_TEXT = [
  'Call tools directly whenever a step is a single call — that is the normal case.',
  'Reserve `run_code` for a step that needs several calls at once: independent calls run concurrently with `Promise.all`,',
  'calls that chain on earlier results, or large tool output you only distill into a summary',
  '(intermediate results stay out of the conversation).',
  'Never wrap a single tool call in a `run_code` program: it costs a process and latency for no benefit.',
  "Example: reading one file → call `read`; scanning every package's README in one step → one `run_code` program that globs and reads concurrently.",
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
  // 规则必须早于各工具指引与 SDK 被读到（与 dsh 把 ptc 模式规则放在 PTC_ONLY 槽位同理），
  // 否则模型先读到「所有工具都能在程序里调用」的 SDK，再看到规则时频道已经选定了。
  ctx.effect(() => ctx.systemPrompt.section({
    name: GUIDANCE_SECTION,
    order: ctx.systemPrompt.getSectionOrder('PTC_ONLY') + 10,
    text: GUIDANCE_TEXT,
  }), 'run-code.guidance()')
}
