/**
 * workspace-collapse 的 browser half：在侧栏「工作区」头部注入一键收起/展开按钮。
 * 注入编排见 `collapse.ts`；按钮内容用原生 `Tooltip`（external，样式由页面提供，
 * fixed 气泡不受 sectionHeader 的 overflow:hidden 裁剪，与原生头部按钮同参数）
 * 包裹上下双 chevron 字形（两条原生 `IconChevron*OutlineMedium` 纵向叠放），在
 * 注入容器里挂独立 React 根；动作方向切换时就地重渲染，只换文案与字形顺序。
 *
 * @module @dsh-kit/dsh-plugin-workspace-collapse/client
 */

import type { Context } from '@deepseek-ai/cordis'
// 仅类型：引入声明本插件读取的 Context service merge（locale 服务）。
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { createRoot } from 'react-dom/client'
import {
  IconChevronDownOutlineMedium, IconChevronUpOutlineMedium, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { SELF_NAMESPACE } from '../shared.js'
import { BUTTON_CLASS, GLYPH_CLASS, installWorkspaceCollapse } from './collapse.js'
import type {
  CollapseButtonHandle, CollapseButtonOptions,
} from './collapse.js'
import { en, zh } from './locales.js'
import type { WorkspaceCollapseKey } from './locales.js'

export { en, zh } from './locales.js'
export type { WorkspaceCollapseKey } from './locales.js'
export {
  BUTTON_ATTR, BUTTON_CLASS, COLLAPSED_ROW_SELECTOR, COLLAPSE_STYLE, CONTAINER_CLASS,
  EXPANDED_ROW_SELECTOR, WORKSPACE_ROW_SELECTOR, collapseExpandedRows,
  expandCollapsedRows, installWorkspaceCollapse, sectionHeaderOf,
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
 * 在注入容器里渲染 Tooltip 包裹的原生风格图标按钮。
 * @param container - 注入编排提供的挂载点。
 * @param options - 初始文案、动作方向与回调。
 * @returns 更新与卸载句柄。
 */
function mountCollapseButton(container: HTMLElement, options: CollapseButtonOptions): CollapseButtonHandle {
  const root = createRoot(container)
  const render = (opts: CollapseButtonOptions): void => {
    root.render(
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
      </Tooltip>,
    )
  }
  render(options)
  return {
    update: render,
    unmount: () => { root.unmount() },
  }
}

/** 注册文案并安装工作区头部收起/展开按钮。 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'workspace-collapse: dictionaries')
  if (typeof document === 'undefined') return
  const translate = ctx.locale.bind(NS)
  ctx.effect(() => installWorkspaceCollapse({
    document,
    mount: mountCollapseButton,
    labels: { collapse: translate('collapseAll'), expand: translate('expandAll') },
  }), 'workspace-collapse: workspace header collapse button')
}
