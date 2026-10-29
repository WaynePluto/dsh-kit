/**
 * 侧边栏「任务看板」行的图标占用者；行按钮、标签与选中态都由 ui-sidebar 拥有。
 *
 * @module @dsh-kit/dsh-plugin-task-board/client/TaskBoardPanelIcon
 */

import { IconChecklistOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

/**
 * 按侧边栏要求的边长渲染清单字形（展开 16px / rail 18px）。
 * 官方面板行都用 OutlineRegular 字形族。
 * @param props - 侧边栏传入的图标 share：边长与选中态。
 * @returns 装饰性图标。
 */
export function TaskBoardPanelIcon({ size }: PropsRuntime<'sidebar.panellist'>) {
  return <IconChecklistOutlineRegular size={size} />
}
