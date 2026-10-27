/**
 * session-workspace 的 Host half。
 * 显示当前会话工作区完全在浏览器半实现（composer 统计栏槽位 + sessions 标准服务）；
 * 本模块刻意为空，只通过 overlay 让 dsh 发现并提供 `dsh.client`。
 *
 * @module @dsh-kit/dsh-plugin-session-workspace
 */

import type { Context } from '@deepseek-ai/cordis'

/** 出现在 dsh 诊断信息中的 Cordis 插件名。 */
export const name = 'dsh-kit-session-workspace'

/** 挂载刻意为空的 Host half。 */
export function apply(_ctx: Context): void {
  // 所有行为位于 `src/client/index.tsx`。
}
