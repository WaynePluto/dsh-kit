/**
 * session-park 的 Host half。
 * 行为完全在浏览器半实现（窗口焦点/可见性信号 + sessions/uiSession/uiWorkspace 服务）；
 * 本模块刻意为空，只通过 overlay 让 dsh 发现并提供 `dsh.client`。
 *
 * @module @dsh-kit/dsh-plugin-session-park
 */

import type { Context } from '@deepseek-ai/cordis'

/** 出现在 dsh 诊断信息中的 Cordis 插件名。 */
export const name = 'dsh-kit-session-park'

/** 挂载刻意为空的 Host half。 */
export function apply(_ctx: Context): void {
  // 所有行为位于 `src/client/index.ts`。
}
