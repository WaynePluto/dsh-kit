/**
 * workspace-collapse 的 Host half。
 * 一键收起完全在浏览器半实现（DOM 注入 + 合成点击走原生折叠路径）；本模块刻意为空，
 * 只通过 overlay 让 dsh 发现并提供 `dsh.client`。
 *
 * @module @dsh-kit/dsh-plugin-workspace-collapse
 */

import type { Context } from '@deepseek-ai/cordis'

/** 出现在 dsh 诊断信息中的 Cordis 插件名。 */
export const name = 'dsh-kit-workspace-collapse'

/** 挂载刻意为空的 Host half。 */
export function apply(_ctx: Context): void {
  // 所有行为位于 `src/client/index.tsx`。
}
