/**
 * workspace-path 的 browser half：监听原生工作区 `···` 菜单，注入「复制路径」行。
 * 工作区路径来自官方 `workspaces` 服务（`WorkspaceView.path`，与上游 hover 卡片
 * `copyText` 同源）；复制走 ui-primitives 的 `writeClipboard`，菜单行复用
 * `MenuItemButton`（external，样式与 CSS 由页面提供）。
 *
 * @module @dsh-kit/dsh-plugin-workspace-path/client
 */

import type { Context } from '@deepseek-ai/cordis'
// 仅类型：引入声明本插件读取的 Context service merge（workspaces 列表、locale 服务）。
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { createRoot } from 'react-dom/client'
import { IconCopyOutlineRegular, MenuItemButton, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { SELF_NAMESPACE } from '../shared.js'
import { closeOpenMenu, installWorkspaceMenuCopy } from './menuPath.js'
import type { MenuButtonOptions } from './menuPath.js'
import { en, zh } from './locales.js'
import type { WorkspacePathKey } from './locales.js'

export { en, zh } from './locales.js'
export type { WorkspacePathKey } from './locales.js'
export {
  ATTRIBUTION_MS, WORKSPACE_ROW_PREFIX, closeOpenMenu, installWorkspaceMenuCopy,
  reenterHostMenu, workspaceRowKeyOf,
} from './menuPath.js'
export type { MenuButtonOptions, MenuPathDeps } from './menuPath.js'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** 本插件的文案命名空间，与包名后缀一致。 */
    'dsh-plugin-workspace-path': WorkspacePathKey
  }
}

/** 本插件的文案 namespace。 */
const NS = SELF_NAMESPACE

/** browser half 使用的 service：locale 取文案，workspaces 解析工作区路径。 */
export const inject = ['locale', 'workspaces']

/**
 * 在原生菜单的挂载点上渲染一个 `MenuItemButton`。
 * @param container - 注入编排提供的挂载点。
 * @param options - 文案、路径与复制回调。
 * @returns 卸载回调。
 */
function mountMenuButton(container: HTMLElement, options: MenuButtonOptions): () => void {
  const root = createRoot(container)
  root.render(
    <MenuItemButton icon={<IconCopyOutlineRegular />} separatorBefore onSelect={options.onCopy}>
      {options.label}
    </MenuItemButton>,
  )
  return () => { root.unmount() }
}

/** 注册文案并安装工作区菜单注入。 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'workspace-path: copy dictionaries')
  if (typeof document === 'undefined') return
  const translate = ctx.locale.bind(NS)
  ctx.effect(() => installWorkspaceMenuCopy({
    document,
    resolvePath: key => ctx.workspaces.list.getSnapshot().items
      .find(item => item.workspaceId === (key as WorkspaceId))?.path,
    mount: mountMenuButton,
    copyLabel: translate('copyPath'),
    copy: path => { void writeClipboard(path) },
    closeMenu: () => { closeOpenMenu(document) },
  }), 'workspace-path: workspace menu copy')
}
