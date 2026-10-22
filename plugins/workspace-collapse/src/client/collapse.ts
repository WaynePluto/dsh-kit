/**
 * 侧栏「工作区」头部的一键收起按钮：注入编排与折叠动作。
 *
 * dsh 的 section header（标题 + 搜索 + 视图选项 + 新增工作区）是 ui-workspace
 * 私有界面，没有插件槽位（上游 `packages/client/ui-workspace/src/client/rows/
 * WorkspaceBrowser.tsx` 的 sectionHeader）；分组展开状态存在其私有 view store
 * （persist `dsh.workspace.view.v5`），插件拿不到实例。但每个分组头行是真实 DOM：
 * `[data-row-key^="workspace:"]`、`aria-expanded` 反映展开态、整行 onClick 即折叠
 * 开关（`rows/Rows.tsx` 的 ProjectRowItem）。因此：
 * - 注入：从任一工作区行向上找带 sectionHeader 直接子节点的祖先（浏览器根），
 *   把按钮容器插在搜索槽（searchSlot）之前；定位用类名后缀匹配，构建产物的
 *   CSS module 类名是 `<hash>_<原名>`，哈希前缀随版本变化会静默失效，升级需复核。
 * - 折叠：对全部展开中的分组行按文档逆序派发 click——树形模式下祖先折叠会卸载
 *   后代行，先子后父让每次点击都落在仍在文档中的行上；点击走原生 onToggle
 *   路径写回 store 并持久化，与用户逐个点击分组头完全同路径。
 *
 * @module @dsh-kit/dsh-plugin-workspace-collapse/client/collapse
 */

/** 工作区分组行的 data-row-key 前缀匹配；未分组桶的 key 是空串（`workspace:`）。 */
export const WORKSPACE_ROW_SELECTOR = '[data-row-key^="workspace:"]'

/** 展开中的工作区分组行；`aria-expanded` 由原生按 group.expanded 输出。 */
export const EXPANDED_ROW_SELECTOR = '[data-row-key^="workspace:"][aria-expanded="true"]'

/** 注入标记，挂在按钮容器与样式元素上。 */
export const BUTTON_ATTR = 'data-dsh-ws-collapse'

/** sectionHeader / searchSlot 的类名后缀匹配（构建产物类名是 `<hash>_<原名>`）。 */
const SECTION_HEADER_SELECTOR = '[class*="sectionHeader"]'
const SEARCH_SLOT_SELECTOR = '[class*="searchSlot"]'

/** 按钮容器与按钮的命名空间类名。 */
export const CONTAINER_CLASS = 'dsh-ws-collapse'
export const BUTTON_CLASS = 'dsh-ws-collapse-btn'
export const GLYPH_CLASS = 'dsh-ws-collapse-glyph'

/**
 * 按钮样式与「搜索展开时随原生动作簇一起退场」的规则。数值逐项对齐上游
 * `rows/WorkspaceBrowser.module.css`：容器镜像 headerActions 的 max-width/
 * opacity/transform 退场动画（同一组 token 与 `--ds-ease-in-out` 节奏），通过
 * `:has(~ …)` 认领后续兄弟上的 `headerActionsHidden` 类；按钮本体复刻
 * iconButton 的 28px 契约（含 inset 焦点圈）。
 *
 * 水平定位：searchSlot 自带 `margin-left:auto`，会在 flex:1 被 max-width 钳住后
 * 吸收剩余空间、把注入项顶到标题旁（优先级高于 justify-content）；容器同样用
 * `margin-left:auto` 接住这部分空间，并把 searchSlot 的 auto margin 归零——该
 * 覆写以容器兄弟关系为选择器前提，组件停用/卸载后自动失效，原生布局不受影响。
 */
export const COLLAPSE_STYLE = `
.${CONTAINER_CLASS} {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  max-width: 28px;
  overflow: hidden;
  box-sizing: border-box;
  margin-left: auto;
  opacity: 1;
  visibility: visible;
  transition:
    max-width 180ms var(--ds-ease-in-out),
    margin-right 180ms var(--ds-ease-in-out),
    opacity 120ms var(--ds-ease-in-out),
    transform 180ms var(--ds-ease-in-out),
    visibility 0s linear;
}
.${CONTAINER_CLASS} ~ [class*="searchSlot"] {
  margin-left: 0;
}
.${CONTAINER_CLASS}:has(~ [class*="headerActionsHidden"]) {
  max-width: 0;
  margin-right: -4px;
  opacity: 0;
  transform: translateX(4px);
  visibility: hidden;
  pointer-events: none;
  transition-delay: 0s, 0s, 0s, 0s, 180ms;
}
.${BUTTON_CLASS} {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: var(--dsw-radius-sm);
  padding: 0;
  background: transparent;
  cursor: pointer;
  color: var(--dsw-alias-label-secondary);
}
.${BUTTON_CLASS}:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}
.${BUTTON_CLASS}:focus-visible {
  outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: -2px;
}
.${GLYPH_CLASS} {
  display: flex;
  flex-direction: column;
  align-items: center;
  line-height: 0;
}
/* 两个 12px chevron 纵向叠放：墨迹在 16 viewBox 的 y≈6–10，按 12px 缩放后
   下方箭头上移 5px，两段墨迹间隙约 5px——间隙小了四条斜臂会被读成 X
   （实机反馈），拉开后才是上下两侧向内挤压的两个独立箭头。 */
.${GLYPH_CLASS} > svg + svg {
  margin-top: -5px;
}
`

/**
 * 逆序点击全部展开中的工作区分组行，折叠所有分组。会话行（`session:`）、
 * 溢出行（`overflow:`）与空状态（`empty`）都不匹配选择器；已全部分组收起时
 * 返回 0、无副作用。
 * @param root - 查询与派发点击的文档。
 * @returns 本次点击的分组行数。
 */
export function collapseExpandedRows(root: ParentNode): number {
  const rows = root.querySelectorAll(EXPANDED_ROW_SELECTOR)
  let count = 0
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    ;(rows[index] as HTMLElement).click()
    count += 1
  }
  return count
}

/**
 * 从一个工作区行向上找工作区浏览器的 sectionHeader：第一个拥有 sectionHeader
 * 直接子节点的祖先即浏览器根（行所在 listArea 的父级），从内向外首个命中不会
 * 落到更外层的巧合类名上。
 * @param row - 列表里的工作区行。
 * @returns sectionHeader 元素；找不到时为 null。
 */
export function sectionHeaderOf(row: Element): Element | null {
  let level: Element | null = row.parentElement
  while (level !== null) {
    const header = level.querySelector(`:scope > ${SECTION_HEADER_SELECTOR}`)
    if (header !== null) return header
    level = level.parentElement
  }
  return null
}

/** 按钮的挂载参数。 */
export interface CollapseButtonOptions {
  /** Tooltip 与 aria-label 文案。 */
  label: string
  /** 点击回调：折叠全部展开中的分组。 */
  onCollapse: () => void
}

/** {@link installWorkspaceCollapse} 的全部外部依赖，测试逐项注入。 */
export interface CollapseDeps {
  document: Document
  /** 在注入容器里挂按钮内容；返回卸载回调。 */
  mount: (container: HTMLElement, options: CollapseButtonOptions) => () => void
  /** 按钮的 Tooltip 与 aria-label 文案。 */
  label: string
}

/**
 * 安装工作区头部的一键收起按钮：注入样式、跟随列表出现/消失挂载与移除按钮。
 * @param deps - 外部依赖。
 * @returns 卸载函数：断开观察、移除按钮容器与样式。
 */
export function installWorkspaceCollapse(deps: CollapseDeps): () => void {
  const doc = deps.document
  let container: HTMLDivElement | null = null
  let unmount: (() => void) | null = null
  let style: HTMLStyleElement | null = null

  const remove = (): void => {
    if (unmount !== null) {
      unmount()
      unmount = null
    }
    container?.remove()
    container = null
  }

  const evaluate = (): void => {
    // 分组视图未在展示（flat 列表、搜索结果、空状态、rail 收起）时没有工作区行，
    // 按钮一并退场；再出现时由后续 mutation 重新挂载。
    const row = doc.querySelector(WORKSPACE_ROW_SELECTOR)
    if (row === null) {
      remove()
      return
    }
    // 容器仍挂在文档里（原生重渲染不会摘走插件节点）时无需重放。
    if (container !== null && container.isConnected) return
    const header = sectionHeaderOf(row)
    const searchSlot = header?.querySelector(`:scope > ${SEARCH_SLOT_SELECTOR}`) ?? null
    if (header === null || searchSlot === null) return
    container = doc.createElement('div')
    container.className = CONTAINER_CLASS
    container.setAttribute(BUTTON_ATTR, '')
    header.insertBefore(container, searchSlot)
    unmount = deps.mount(container, {
      label: deps.label,
      onCollapse: () => { collapseExpandedRows(doc) },
    })
  }

  const observer = new MutationObserver(evaluate)
  observer.observe(doc.body, { childList: true, subtree: true })
  style = doc.createElement('style')
  style.setAttribute(BUTTON_ATTR, '')
  style.textContent = COLLAPSE_STYLE
  doc.head.appendChild(style)
  evaluate()
  return () => {
    observer.disconnect()
    remove()
    style?.remove()
    style = null
  }
}
