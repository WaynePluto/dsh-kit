/**
 * 侧栏「工作区」头部的一键收起/展开按钮：注入编排与折叠动作。
 *
 * dsh 的 section header（标题 + 搜索 + 视图选项 + 新增工作区）是 ui-workspace
 * 私有界面，没有插件槽位（上游 `packages/client/ui-workspace/src/client/rows/
 * WorkspaceBrowser.tsx` 的 sectionHeader）；分组展开状态存在其私有 view store
 * （persist `dsh.workspace.view.v5`），插件拿不到实例。但每个分组头行是真实 DOM：
 * `[data-row-key^="workspace:"]`、`aria-expanded` 恒定输出展开态、整行 onClick 即
 * 折叠开关（`rows/Rows.tsx` 的 ProjectRowItem）。因此：
 * - 注入：从任一工作区行向上找带 sectionHeader 直接子节点的祖先（浏览器根），
 *   把按钮容器插在搜索槽（searchSlot）之前；定位用类名后缀匹配，构建产物的
 *   CSS module 类名是 `<hash>_<原名>`，哈希前缀随版本变化会静默失效，升级需复核。
 * - 状态：只要还有展开中的分组行，按钮就是「收起全部」；全部收起后切到
 *   「展开全部」。展开态随行内 `aria-expanded` 变化，由观察器的 attribute 监听
 *   跟随（叶子分组折叠/展开只改属性，不产生 childList mutation）。
 * - 收起：对全部展开中的分组行按文档逆序派发 click——树形模式下祖先折叠会卸载
 *   后代行，先子后父让每次点击都落在仍在文档中的行上。
 * - 展开：按文档顺序派发 click。展开是单向门——上游 renderGroup 只在父分组
 *   展开时渲染子分组行，父行展开后新挂载的子行（各自持持久化的收起态）才进
 *   文档，所以按「点击一批 → 等 React 落 DOM → 再探下一轮」循环到没有未点过的
 *   收起行；每行只点一次，行数有限故必然终止。
 * 点击都走原生 onToggle 路径写回 store 并持久化，与用户逐个点击分组头完全同路径。
 *
 * @module @dsh-kit/dsh-plugin-workspace-collapse/client/collapse
 */

/** 工作区分组行的 data-row-key 前缀匹配；未分组桶的 key 是空串（`workspace:`）。 */
export const WORKSPACE_ROW_SELECTOR = '[data-row-key^="workspace:"]'

/** 展开中的工作区分组行；`aria-expanded` 由原生按 group.expanded 输出。 */
export const EXPANDED_ROW_SELECTOR = '[data-row-key^="workspace:"][aria-expanded="true"]'

/** 收起中的工作区分组行。 */
export const COLLAPSED_ROW_SELECTOR = '[data-row-key^="workspace:"][aria-expanded="false"]'

/** 注入标记，挂在按钮容器与样式元素上。 */
export const BUTTON_ATTR = 'data-dsh-ws-collapse'

/** sectionHeader / searchSlot 的类名后缀匹配（构建产物类名是 `<hash>_<原名>`）。 */
const SECTION_HEADER_SELECTOR = '[class*="sectionHeader"]'
const SEARCH_SLOT_SELECTOR = '[class*="searchSlot"]'

/** 按钮容器与按钮的命名空间类名。 */
export const CONTAINER_CLASS = 'dsh-ws-collapse'
export const BUTTON_CLASS = 'dsh-ws-collapse-btn'
export const GLYPH_CLASS = 'dsh-ws-collapse-glyph'

/** 按钮当前指向的动作；存在展开中的分组行时是 collapse，否则是 expand。 */
export type CollapseMode = 'collapse' | 'expand'

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
 * 返回 0、无副作用。收起是单轮的：文档里的展开行祖先必全部展开（否则不渲染），
 * 先子后父一趟点完。
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
 * 按文档顺序多轮点击全部收起中的工作区分组行，展开所有分组。上游只在父分组
 * 展开时渲染子分组行，所以每轮点击后等一拍（setTimeout 让 React 在 click 事件
 * 后落 DOM），再探下一轮新挂载的收起行；每行只点一次，避免原生开关失效时死循环，
 * 全部展开（或没有行）后结束。
 * @param root - 查询与派发点击的文档。
 * @returns 本次点击的分组行数。
 */
export async function expandCollapsedRows(root: ParentNode): Promise<number> {
  const handled = new WeakSet<Element>()
  let count = 0
  for (;;) {
    const rows = Array.from(root.querySelectorAll(COLLAPSED_ROW_SELECTOR))
      .filter(row => !handled.has(row))
    if (rows.length === 0) break
    for (const row of rows) {
      handled.add(row)
      ;(row as HTMLElement).click()
      count += 1
    }
    await new Promise<void>(resolve => { setTimeout(resolve, 0) })
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
  /** 当前指向的动作，决定字形方向。 */
  mode: CollapseMode
  /** 点击回调：按 mode 收起或展开全部分组。 */
  onActivate: () => void
}

/** 按钮句柄：模式变化时就地更新，卸载时释放。 */
export interface CollapseButtonHandle {
  /** 以新参数重渲染按钮（文案与字形）。 */
  update: (options: CollapseButtonOptions) => void
  /** 卸载按钮内容。 */
  unmount: () => void
}

/** {@link installWorkspaceCollapse} 的全部外部依赖，测试逐项注入。 */
export interface CollapseDeps {
  document: Document
  /** 在注入容器里挂按钮内容；返回更新与卸载句柄。 */
  mount: (container: HTMLElement, options: CollapseButtonOptions) => CollapseButtonHandle
  /** 两个动作方向的 Tooltip 与 aria-label 文案。 */
  labels: { collapse: string; expand: string }
}

/**
 * 安装工作区头部的一键收起/展开按钮：注入样式、跟随列表出现/消失挂载与移除按钮，
 * 并跟随行内 `aria-expanded` 变化在收起/展开两个动作间切换。
 * @param deps - 外部依赖。
 * @returns 卸载函数：断开观察、移除按钮容器与样式。
 */
export function installWorkspaceCollapse(deps: CollapseDeps): () => void {
  const doc = deps.document
  let container: HTMLDivElement | null = null
  let handle: CollapseButtonHandle | null = null
  let mode: CollapseMode | null = null
  let style: HTMLStyleElement | null = null

  const remove = (): void => {
    handle?.unmount()
    handle = null
    mode = null
    container?.remove()
    container = null
  }

  const activate = (): void => {
    if (mode === 'expand') void expandCollapsedRows(doc)
    else collapseExpandedRows(doc)
  }

  const optionsFor = (next: CollapseMode): CollapseButtonOptions => ({
    label: deps.labels[next],
    mode: next,
    onActivate: activate,
  })

  const evaluate = (): void => {
    // 分组视图未在展示（flat 列表、搜索结果、空状态、rail 收起）时没有工作区行，
    // 按钮一并退场；再出现时由后续 mutation 重新挂载。
    const row = doc.querySelector(WORKSPACE_ROW_SELECTOR)
    if (row === null) {
      remove()
      return
    }
    const next: CollapseMode = doc.querySelector(EXPANDED_ROW_SELECTOR) !== null
      ? 'collapse'
      : 'expand'
    // 容器仍挂在文档里（原生重渲染不会摘走插件节点）时只跟随模式切换。
    if (container !== null && container.isConnected) {
      if (handle !== null && next !== mode) {
        mode = next
        handle.update(optionsFor(next))
      }
      return
    }
    const header = sectionHeaderOf(row)
    const searchSlot = header?.querySelector(`:scope > ${SEARCH_SLOT_SELECTOR}`) ?? null
    if (header === null || searchSlot === null) return
    mode = next
    container = doc.createElement('div')
    container.className = CONTAINER_CLASS
    container.setAttribute(BUTTON_ATTR, '')
    header.insertBefore(container, searchSlot)
    handle = deps.mount(container, optionsFor(next))
  }

  const observer = new MutationObserver(evaluate)
  observer.observe(doc.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['aria-expanded'],
  })
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
