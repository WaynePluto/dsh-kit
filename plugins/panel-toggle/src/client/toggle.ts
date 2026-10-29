/**
 * 侧栏活动面板行的 toggle 判定与安装编排：纯 DOM 信号，测试逐项注入依赖。
 *
 * 上游 `ui-sidebar` 的 PanelRow 点击无条件 `selectPanel(id)`，对已选中的行是无效
 * 重选（没有 toggle）。本模块在 document 捕获阶段拦截「活动面板行」的点击并改调
 * `layout.selectPanel(null)`——上游 clearMain 回会话用的同一条路径。活动行的判定
 * 不依赖 CSS module 哈希类名以外的状态：
 * - `aria-current="page"` 只有当前选中的面板行输出；
 * - 行必须位于面板列表容器内（上游是侧栏唯一的 `nav.panelList`），排除上游
 *   `ui-primitives` Menu 菜单项同样使用 `aria-current="page"` 的碰撞（portal 菜单
 *   挂在 document.body，不在该 nav 内）；
 * - 行类名含 `panelRow`（构建产物 CSS module 类名是 `<hash>_<原名>`，后缀匹配，
 *   哈希前缀变化会静默失效，升级需复核）。
 *
 * @module @dsh-kit/dsh-plugin-panel-toggle/client/toggle
 */

/** 活动面板行：aria 状态 + 行类名后缀双重限定（Menu 菜单项没有 panelRow 类名）。 */
export const ACTIVE_PANEL_ROW_SELECTOR = 'button[aria-current="page"][class*="panelRow"]'

/** 面板列表容器：侧栏唯一的 nav（上游 SidebarRoot 的 panelList）。 */
export const PANEL_LIST_SELECTOR = 'nav[class*="panelList"]'

/** {@link installPanelToggle} 的全部外部依赖，测试逐项注入。 */
export interface PanelToggleDeps {
  document: Document
  /** 当前是否有面板被选中；false 时不拦截（防御 aria-current 与真实选中态短暂不一致）。 */
  hasActivePanel: () => boolean
  /** 回到会话（layout.selectPanel(null)）。 */
  returnToConversation: () => void
}

/**
 * 安装活动面板行的 toggle 拦截。点击落在活动面板行时阻止原生处理（原生只会
 * 无效重选同一面板），改调 {@link PanelToggleDeps.returnToConversation}；其余点击
 * 一律放行。键盘 Enter/Space 在按钮上派发的是同一 click 事件，天然生效。
 * @param deps - 外部依赖。
 * @returns 卸载函数：移除捕获监听。
 */
export function installPanelToggle(deps: PanelToggleDeps): () => void {
  const onCapture = (event: MouseEvent): void => {
    if (event.defaultPrevented) return
    if (!(event.target instanceof Element)) return
    const row = event.target.closest(ACTIVE_PANEL_ROW_SELECTOR)
    if (row === null || row.closest(PANEL_LIST_SELECTOR) === null) return
    if (!deps.hasActivePanel()) return
    event.preventDefault()
    // document 捕获先于 React 根容器的委托监听，拦截后原生的无效重选不再发生。
    event.stopPropagation()
    deps.returnToConversation()
  }
  deps.document.addEventListener('click', onCapture, true)
  return () => {
    deps.document.removeEventListener('click', onCapture, true)
  }
}
