/**
 * workspace-collapse 的 browser half：在侧栏「工作区」头部注入两枚按钮——
 * 一键收起/展开与仅展开活动的工作区（有运行中/待操作/未读会话的分组保留展开，
 * 收起其余；聚焦完成后把活动工作区按字母序置前——走官方 `workspaces` 服务的
 * `insertBefore`，与原生拖拽排序同一条宿主路径）。注入编排见 `collapse.ts`；
 * 按钮内容用原生 `Tooltip`（external，样式由页面提供，fixed 气泡不受
 * sectionHeader 的 overflow:hidden 裁剪，与原生头部按钮同参数）包裹原生字形
 * （双 chevron 纵向叠放 / 三线+上下 chevron 组合），在注入容器里挂独立 React 根；
 * 动作方向切换时就地重渲染，只换文案与字形顺序。
 *
 * @module @dsh-kit/dsh-plugin-workspace-collapse/client
 */

import type { Context } from '@deepseek-ai/cordis'
// 仅类型：引入声明本插件读取的 Context service merge（workspaces 列表、locale 服务）。
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import {
  IconChevronDownOutlineMedium, IconChevronUpOutlineMedium,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { SELF_NAMESPACE } from '../shared.js'
import {
  BUTTON_CLASS, EXPANDED_ROW_SELECTOR, GLYPH_CLASS, installWorkspaceCollapse,
  planActiveFirstMoves, workspaceIdOfRow,
} from './collapse.js'
import type {
  CollapseButtonHandle, CollapseButtonOptions,
} from './collapse.js'
import { en, zh } from './locales.js'
import type { WorkspaceCollapseKey } from './locales.js'

/** 聚焦按钮的组合字形：三条工作区分组线 + 右侧上下 chevron（Regular 1px 描边——
 *  相邻原生头部图标搜索/视图选项/新增全是 `*OutlineRegular` 字形族，Medium 1.3px
 *  是 14px dock 字形族，用在 16px 头部会显粗；16 viewBox、显示尺寸 16px 与邻居
 *  一致，颜色走 currentColor 随按钮状态）。墨迹按 2026-10-29 实机截图（DPR=1）
 *  量到邻居为搜索 15×15、视图选项 14×12、新增 16×14，旧路径墨迹 13×8.9 偏矮被
 *  读小；现路径（线 y=3/8/13、chevron 2.2×2.2）墨迹约 13.4×11.8，与邻居同档。 */
function FocusRemindersGlyph(): ReactNode {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={1}>
      <path d="M2.5 3H8.8" stroke="currentColor" />
      <path d="M2.5 8H8.8" stroke="currentColor" />
      <path d="M2.5 13H8.8" stroke="currentColor" />
      <path d="m10.4 5.2 2.2-2.2 2.2 2.2" stroke="currentColor" />
      <path d="m10.4 10.8 2.2 2.2 2.2-2.2" stroke="currentColor" />
    </svg>
  )
}

export { en, zh } from './locales.js'
export type { WorkspaceCollapseKey } from './locales.js'
export {
  ACTIVE_DOT_SELECTOR, BUTTON_ATTR, BUTTON_CLASS, COLLAPSED_ROW_SELECTOR, COLLAPSE_STYLE, CONTAINER_CLASS,
  EXPANDED_ROW_SELECTOR, SELECTED_SESSION_SELECTOR, SESSION_ROW_SELECTOR,
  WORKSPACE_ROW_SELECTOR, collapseExpandedRows, expandCollapsedRows, focusActiveRows,
  installWorkspaceCollapse, planActiveFirstMoves, sectionHeaderOf, workspaceIdOfRow,
} from './collapse.js'
export type {
  CollapseButtonHandle, CollapseButtonOptions, CollapseDeps, CollapseMode, WorkspaceMove, WorkspaceOrderEntry,
} from './collapse.js'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** 本插件的文案命名空间，与包名后缀一致。 */
    'dsh-plugin-workspace-collapse': WorkspaceCollapseKey
  }
}

/** 本插件的文案 namespace。 */
const NS = SELF_NAMESPACE

/** browser half 使用的 service：locale 取文案，workspaces 读写宿主工作区顺序。 */
export const inject = ['locale', 'workspaces']

/**
 * 在注入容器里渲染 Tooltip 包裹的两枚原生风格图标按钮（收起/展开 + 仅展开活动）。
 * @param container - 注入编排提供的挂载点。
 * @param options - 两个动作的文案、方向与回调。
 * @returns 更新与卸载句柄。
 */
function mountCollapseButton(container: HTMLElement, options: CollapseButtonOptions): CollapseButtonHandle {
  const root = createRoot(container)
  const render = (opts: CollapseButtonOptions): void => {
    root.render(
      <>
        <Tooltip label={opts.label} side="bottom" delayMs={500}>
          <button
            type="button"
            className={BUTTON_CLASS}
            aria-label={opts.label}
            aria-expanded={opts.mode === 'collapse'}
            onClick={opts.onActivate}
          >
            {/* 双 chevron 纵向叠放的挤压记号：收起时下箭头在上、上箭头在下（指向
                彼此），展开时上下互换（指向外侧）；间距契约见 COLLAPSE_STYLE。 */}
            <span className={GLYPH_CLASS} aria-hidden="true">
              {opts.mode === 'collapse'
                ? (
                    <>
                      <IconChevronDownOutlineMedium size={12} />
                      <IconChevronUpOutlineMedium size={12} />
                    </>
                  )
                : (
                    <>
                      <IconChevronUpOutlineMedium size={12} />
                      <IconChevronDownOutlineMedium size={12} />
                    </>
                  )}
            </span>
          </button>
        </Tooltip>
        <Tooltip label={opts.focusLabel} side="bottom" delayMs={500}>
          <button
            type="button"
            className={BUTTON_CLASS}
            aria-label={opts.focusLabel}
            onClick={opts.onFocus}
          >
            {/* 组合字形（三条分组线 + 上下 chevron）：聚焦动作仅展开活动的工作区
                （有运行中/待用户操作/完成未读会话的分组）。 */}
            <FocusRemindersGlyph />
          </button>
        </Tooltip>
      </>,
    )
  }
  render(options)
  return {
    update: render,
    unmount: () => { root.unmount() },
  }
}

/** 参与字母序的显示标题：标题为空（默认工作区形态）时回退路径末段，再回退 id。 */
function workspaceLabel(item: WorkspaceView): string {
  if (item.title !== '') return item.title
  const segments = item.path.split(/[\\/]/)
  return segments[segments.length - 1] || item.workspaceId
}

/**
 * 注册文案并安装工作区头部的收起/展开与「仅展开活动」按钮。聚焦动作完成后把
 * 仍展开（活动）的工作区按字母序置前：从幸存的展开行取 id，对官方 `workspaces`
 * 服务的 `insertBefore`（原生拖拽排序的同一条宿主路径，顺序持久化）按
 * {@link planActiveFirstMoves} 的计划逐条执行；任一步被拒即告警并放弃剩余移动，
 * 不影响已完成的聚焦动作。
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'workspace-collapse: dictionaries')
  if (typeof document === 'undefined') return
  const translate = ctx.locale.bind(NS)
  const reorderActiveFirst = async (root: ParentNode): Promise<void> => {
    try {
      const snapshot = ctx.workspaces.list.getSnapshot()
      if (snapshot.phase !== 'ready' || snapshot.items.length === 0) return
      const byId = new Set(snapshot.items.map(item => item.workspaceId as string))
      const activeIds = Array.from(root.querySelectorAll(EXPANDED_ROW_SELECTOR))
        .map(workspaceIdOfRow)
        .filter((id): id is string => id !== undefined && byId.has(id))
      if (activeIds.length === 0) return
      const moves = planActiveFirstMoves(
        snapshot.items.map(item => ({ id: item.workspaceId as string, label: workspaceLabel(item) })),
        activeIds,
      )
      for (const move of moves) {
        // eslint-disable-next-line no-await-in-loop -- 每步锚点基于上一步移动后的宿主顺序，必须串行
        await ctx.workspaces.insertBefore(move.id as WorkspaceId, move.beforeId as WorkspaceId)
      }
    } catch (reason) {
      console.warn('workspace-collapse: active-first reorder rejected:', reason)
    }
  }
  ctx.effect(() => installWorkspaceCollapse({
    document,
    mount: mountCollapseButton,
    labels: {
      collapse: translate('collapseAll'),
      expand: translate('expandAll'),
      focus: translate('focusUpdates'),
    },
    reorder: reorderActiveFirst,
  }), 'workspace-collapse: workspace header collapse button')
}
