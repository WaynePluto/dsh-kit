/**
 * workspace-collapse 的 browser half：在侧栏「工作区」头部注入两枚按钮——
 * 一键收起/展开与聚焦提醒（展开有运行中/待操作/未读会话的工作区、收起其余）。
 * 注入编排见 `collapse.ts`；按钮内容用原生 `Tooltip`（external，样式由页面提供，
 * fixed 气泡不受 sectionHeader 的 overflow:hidden 裁剪，与原生头部按钮同参数）
 * 包裹原生字形（双 chevron 纵向叠放 / IconSlidersTwoOutlineMedium），在
 * 注入容器里挂独立 React 根；动作方向切换时就地重渲染，只换文案与字形顺序。
 *
 * @module @dsh-kit/dsh-plugin-workspace-collapse/client
 */

import type { Context } from '@deepseek-ai/cordis'
// 仅类型：引入声明本插件读取的 Context service merge（locale 服务）。
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import {
  IconChevronDownOutlineMedium, IconChevronUpOutlineMedium,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { SELF_NAMESPACE } from '../shared.js'
import { BUTTON_CLASS, GLYPH_CLASS, installWorkspaceCollapse } from './collapse.js'
import type {
  CollapseButtonHandle, CollapseButtonOptions,
} from './collapse.js'
import { en, zh } from './locales.js'
import type { WorkspaceCollapseKey } from './locales.js'

/** 聚焦按钮的组合字形：三条工作区分组线 + 右侧上下 chevron（Medium 1.3px 描边，
 *  16 viewBox 与原生 outline 字形同规范；颜色走 currentColor 随按钮状态）。 */
function FocusRemindersGlyph(): ReactNode {
  return (
    <svg width={12} height={12} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={1.3}>
      <path d="M2.5 4.2H9" stroke="currentColor" />
      <path d="M2.5 8H9" stroke="currentColor" />
      <path d="M2.5 11.8H9" stroke="currentColor" />
      <path d="m10.9 6.3 1.65-1.65 1.65 1.65" stroke="currentColor" />
      <path d="m10.9 9.7 1.65 1.65 1.65-1.65" stroke="currentColor" />
    </svg>
  )
}

export { en, zh } from './locales.js'
export type { WorkspaceCollapseKey } from './locales.js'
export {
  BUTTON_ATTR, BUTTON_CLASS, COLLAPSED_ROW_SELECTOR, COLLAPSE_STYLE, CONTAINER_CLASS,
  EXPANDED_ROW_SELECTOR, REMINDER_DOT_SELECTOR, SESSION_ROW_SELECTOR,
  WORKSPACE_ROW_SELECTOR, collapseExpandedRows, expandCollapsedRows, focusReminderRows,
  installWorkspaceCollapse, sectionHeaderOf,
} from './collapse.js'
export type {
  CollapseButtonHandle, CollapseButtonOptions, CollapseDeps, CollapseMode,
} from './collapse.js'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** 本插件的文案命名空间，与包名后缀一致。 */
    'dsh-plugin-workspace-collapse': WorkspaceCollapseKey
  }
}

/** 本插件的文案 namespace。 */
const NS = SELF_NAMESPACE

/** browser half 使用的 service：locale 取文案。 */
export const inject = ['locale']

/**
 * 在注入容器里渲染 Tooltip 包裹的两枚原生风格图标按钮（收起/展开 + 聚焦提醒）。
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
            {/* 组合字形（三条分组线 + 上下 chevron）：聚焦动作仅展开有会话提醒
                （运行中/待用户操作/完成未读）的工作区。 */}
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

/** 注册文案并安装工作区头部的收起/展开与聚焦提醒按钮。 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'workspace-collapse: dictionaries')
  if (typeof document === 'undefined') return
  const translate = ctx.locale.bind(NS)
  ctx.effect(() => installWorkspaceCollapse({
    document,
    mount: mountCollapseButton,
    labels: {
      collapse: translate('collapseAll'),
      expand: translate('expandAll'),
      focus: translate('focusUpdates'),
    },
  }), 'workspace-collapse: workspace header collapse button')
}
