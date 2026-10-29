/**
 * panel-toggle 的 Host half。
 * 行为完全在浏览器半实现（document 捕获阶段拦截 + layout 服务）；本模块刻意为空，
 * 只通过 overlay 让 dsh 发现并提供 `dsh.client`。
 *
 * @module @dsh-kit/dsh-plugin-panel-toggle
 */

import type { Context } from '@deepseek-ai/cordis'

/** 出现在 dsh 诊断信息中的 Cordis 插件名。 */
export const name = 'dsh-kit-panel-toggle'

/** 挂载刻意为空的 Host half。 */
export function apply(_ctx: Context): void {
  // 所有行为位于 `src/client/index.ts`。
}
