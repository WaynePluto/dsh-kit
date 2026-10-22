/**
 * workspace-path 的 Host half。
 * 「复制路径」完全在浏览器半实现（DOM 注入 + workspaces 服务读路径）；本模块刻意为空，
 * 只通过 overlay 让 dsh 发现并提供 `dsh.client`。
 *
 * @module @dsh-kit/dsh-plugin-workspace-path
 */

import type { Context } from '@deepseek-ai/cordis'

/** 出现在 dsh 诊断信息中的 Cordis 插件名。 */
export const name = 'dsh-kit-workspace-path'

/** 挂载刻意为空的 Host half。 */
export function apply(_ctx: Context): void {
  // 所有行为位于 `src/client/index.tsx`。
}
