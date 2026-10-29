/**
 * 侧栏「工作区」头部的单枚注入按钮：聚焦/折叠双态。
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
 * - 状态：只要还有展开中的分组行，按钮就是「折叠所有工作区」；全部收起后切到
 *   「仅展开活动的工作区」（聚焦）。展开态随行内 `aria-expanded` 变化，由观察器
 *   的 attribute 监听跟随（叶子分组折叠/展开只改属性，不产生 childList mutation）。
 * - 折叠：对全部展开中的分组行按文档逆序派发 click——树形模式下祖先折叠会卸载
 *   后代行，先子后父让每次点击都落在仍在文档中的行上。
 * - 聚焦活动：先展开全部分组（收起分组的会话行不在 DOM——上游 deriveGroups 对
 *   收起分组输出空 sessions，纯 DOM 判定看不到它们的任何会话状态），再收起子树
 *   无活动会话的分组；最终态即「只展开活动的工作区」。会话行归属用 renderGroup
 *   的 section 结构（`div.groupSection > HoverCard span > 行` + `div[role=group]`
 *   包子分组）判定，见 {@link sectionOfHeader}。展开按文档顺序多轮派发 click——
 *   上游 renderGroup 只在父分组展开时渲染子分组行，父行展开后新挂载的子行（各自
 *   持持久化的收起态）才进文档，所以按「点击一批 → 等 React 落 DOM → 再探下一轮」
 *   循环到没有未点过的收起行；每行只点一次，行数有限故必然终止。
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

/** 会话行；归属判定与状态点扫描都以它为边界。 */
export const SESSION_ROW_SELECTOR = '[data-row-key^="session:"]'

/**
 * 会话行内的「活动」状态点（原生 `StateDot` 的 `data-state`，会话行内唯一）：
 * `ongoing` = 运行中（含子代理）、`warning` = 待用户操作（审批/计划确认/提问）、
 * `done` = 完成未读（打开会话才清除）。`idle` 不渲染状态点，天然不算活动。
 * 出处：`ui-workspace/src/client/rows/Rows.tsx` 的 sessionStatuses + `SessionStatusDots`。
 */
export const ACTIVE_DOT_SELECTOR = '[data-state="ongoing"], [data-state="warning"], [data-state="done"]'

/** 当前选中的会话行（role=treeitem + aria-selected）；聚焦时其所在分组保留展开。 */
export const SELECTED_SESSION_SELECTOR = `${SESSION_ROW_SELECTOR}[aria-selected="true"]`

/** 工作区分组行 data-row-key 的前缀；未分组桶 key 是空串（`workspace:`）。 */
const WORKSPACE_KEY_PREFIX = 'workspace:'

/**
 * 从工作区分组行取出工作区 id（`data-row-key="workspace:<id>"` 的 `<id>` 部分）。
 * 未分组桶（key 为 `workspace:`）与其他行返回 undefined。
 * @param row - 工作区分组行。
 * @returns 工作区 id；非工作区行或未分组桶时为 undefined。
 */
export function workspaceIdOfRow(row: Element): string | undefined {
  const key = row.getAttribute('data-row-key')
  if (key === null || !key.startsWith(WORKSPACE_KEY_PREFIX)) return undefined
  const id = key.slice(WORKSPACE_KEY_PREFIX.length)
  return id === '' ? undefined : id
}

/** 工作区的排序条目：id 用于宿主移动接口，label 是参与字母序比较的显示标题。 */
export interface WorkspaceOrderEntry {
  /** 工作区 id。 */
  readonly id: string
  /** 显示标题（标题为空时调用方回退路径末段）。 */
  readonly label: string
}

/** 一次工作区移动：把 `id` 移到 `beforeId` 之前（与原生拖拽排序同语义）。 */
export interface WorkspaceMove {
  /** 要移动的工作区 id。 */
  readonly id: string
  /** 锚点工作区 id：移动后被移动者紧邻其前。 */
  readonly beforeId: string
}

/**
 * 计算把活动工作区（按字母序）置前、其余保持现有相对顺序的移动序列。返回的
 * 每一步都基于「上一步完成后的顺序」给出锚点，调用方按序对宿主逐条执行即可；
 * 已经在目标位置的元素不产生移动。最坏 n-1 步，多数场景只有活动块整体前移的
 * 少数几步。
 * @param currentOrder - 当前宿主顺序（工作区清单条目，含显示标题）。
 * @param activeIds - 聚焦后仍展开（活动）的工作区 id 集合。
 * @returns 依次执行的移动序列；已就绪时为空数组。
 */
export function planActiveFirstMoves(
  currentOrder: readonly WorkspaceOrderEntry[],
  activeIds: readonly string[],
): WorkspaceMove[] {
  const active = new Set(activeIds)
  const targets = [
    ...currentOrder.filter(entry => active.has(entry.id))
      .toSorted((a, b) => a.label.localeCompare(b.label)),
    ...currentOrder.filter(entry => !active.has(entry.id)),
  ].map(entry => entry.id)
  const order = currentOrder.map(entry => entry.id)
  const moves: WorkspaceMove[] = []
  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index]
    const anchor = order[index]
    if (target === undefined || anchor === undefined) break
    if (anchor === target) continue
    moves.push({ id: target, beforeId: anchor })
    order.splice(order.indexOf(target), 1)
    order.splice(index, 0, target)
  }
  return moves
}

/** 注入标记，挂在按钮容器与样式元素上。 */
export const BUTTON_ATTR = 'data-dsh-ws-collapse'

/** sectionHeader / searchSlot 的类名后缀匹配（构建产物类名是 `<hash>_<原名>`）。 */
const SECTION_HEADER_SELECTOR = '[class*="sectionHeader"]'
const SEARCH_SLOT_SELECTOR = '[class*="searchSlot"]'

/** 按钮容器与按钮的命名空间类名。 */
export const CONTAINER_CLASS = 'dsh-ws-collapse'
export const BUTTON_CLASS = 'dsh-ws-collapse-btn'

/** 按钮当前指向的动作；存在展开中的分组行时是 collapse，否则是 focus。 */
export type CollapseMode = 'collapse' | 'focus'

/**
 * 按钮样式与「搜索展开时随原生动作簇一起退场」的规则。数值逐项对齐上游
 * `rows/WorkspaceBrowser.module.css`：容器镜像 headerActions 的 max-width/
 * opacity/transform 退场动画（同一组 token 与 `--ds-ease-in-out` 节奏），通过
 * `:has(~ …)` 认领后续兄弟上的 `headerActionsHidden` 类；按钮本体复刻
 * iconButton 的 28px 契约（含 inset 焦点圈），max-width 按单钮预留。
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
    // eslint-disable-next-line no-await-in-loop -- 逐轮让出事件循环，等本轮点击落 DOM 后再探
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

/**
 * 分组行的 section 根。上游 renderGroup 的结构固定为
 * `div.groupSection > HoverCard span > 行 div`，行向上两级即 section——自己的
 * 会话行（HoverCard span）与子分组容器（`div[role=group]`）都是它的直接子节点，
 * 据此把一个分组行和它的会话行、后代分组关联起来，不依赖哈希类名。
 * 结构守卫：包装层的直接子节点只应有本行，section 的直接子节点只应有包装 span
 * 与子分组容器；出现裸行元素说明包装层变了（HoverCard 摘掉等），此时判定
 * 退化为无操作，升级需复核。
 * @param header - 工作区分组行。
 * @returns section 根元素；结构不符时为 null。
 */
function sectionOfHeader(header: Element): Element | null {
  const wrapper = header.parentElement
  const section = wrapper?.parentElement ?? null
  if (wrapper === null || section === null) return null
  if (wrapper.querySelector(`:scope > ${SESSION_ROW_SELECTOR}`) !== null) return null
  if (section.querySelector(`:scope > ${SESSION_ROW_SELECTOR}, :scope > ${WORKSPACE_ROW_SELECTOR}`) !== null) {
    return null
  }
  return section
}

/**
 * 「仅展开活动的工作区」动作：先展开全部分组，再收起子树完全无活动会话的分组。
 * 两个阶段：
 * - 展开（多轮）：复用 {@link expandCollapsedRows} 点开全部收起分组。收起分组的
 *   会话行不在 DOM（上游 deriveGroups 对收起分组输出空 sessions），必须先展开，
 *   会话行（及其状态点）才进入文档可供判定；子分组行也在这一步全部挂载。
 * - 收起（单轮逆序）：点击展开中但 section 子树完全无活动状态点、也不含当前
 *   选中会话的分组行；子树含活动或当前会话的祖先链保留展开。逆序保证先子后父，
 *   已被摘除的行跳过。
 * 已知局限：分组会话超过原生水位线（默认 5 条）时，深处会话行不在 DOM（由
 * overflow 行替代），其活动状态判定不到；当前会话所在分组始终保留展开。
 * 点击都走原生 onToggle 写回 store 并持久化。
 * @param root - 查询与派发点击的文档。
 * @returns 本次点击的分组行数。
 */
export async function focusActiveRows(root: ParentNode): Promise<number> {
  let count = await expandCollapsedRows(root)
  // 等最后一轮点击的会话行落 DOM（expandCollapsedRows 内部每轮已让出事件循环，
  // 这里再让出一拍保证状态点可查询）。
  await new Promise<void>(resolve => { setTimeout(resolve, 0) })
  const rows = Array.from(root.querySelectorAll(EXPANDED_ROW_SELECTOR))
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index] as HTMLElement
    const section = sectionOfHeader(row)
    // 结构不符时跳过（宁可少收，不误收）；子树含活动状态点或当前选中会话的
    // 祖先链保留展开，避免把活动分组与用户正盯着的分组收起来。
    if (section === null || !row.isConnected
      || section.querySelector(`${ACTIVE_DOT_SELECTOR}, ${SELECTED_SESSION_SELECTOR}`) !== null) continue
    row.click()
    count += 1
  }
  return count
}

/** 按钮的挂载参数。 */
export interface CollapseButtonOptions {
  /** 按钮（按当前 mode 指向的动作）的 Tooltip 与 aria-label 文案。 */
  label: string
  /** 当前指向的动作，决定字形方向：collapse 折叠全部，focus 聚焦活动。 */
  mode: CollapseMode
  /** 点击回调：按 mode 折叠全部分组，或聚焦展开活动分组。 */
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
  /** 两个动作方向的 Tooltip/aria-label 文案。 */
  labels: { collapse: string; focus: string }
  /**
   * 聚焦动作完成后的收尾钩子：把仍展开（活动）的工作区按字母序置前。参数是查询
   * 用的文档；实现自担错误（失败不得影响已完成的聚焦动作）。缺省时聚焦后不重排。
   */
  reorder?: (root: ParentNode) => Promise<void> | void
}

/**
 * 判定一批 mutation 是否可能影响按钮：工作区行的挂载/卸载（分组视图出现/消失、
 * 子分组展开时新行落 DOM），或工作区行内的 `aria-expanded` 变化（模式切换）。
 * 观察器常驻 body 全子树，聊天流式输出等高频变更批次在此被丢弃，evaluate 的
 * 全文档查询只在相关变更后执行；对新增/移除节点的子树查询与该批变更自身的
 * 规模同阶，不随全文档大小增长。
 */
function affectsButton(records: readonly MutationRecord[]): boolean {
  for (const record of records) {
    if (record.type === 'attributes') {
      if (record.target instanceof Element
        && record.target.closest(WORKSPACE_ROW_SELECTOR) !== null) return true
      continue
    }
    for (const nodes of [record.addedNodes, record.removedNodes]) {
      for (const node of nodes) {
        if (!(node instanceof Element)) continue
        if (node.matches(WORKSPACE_ROW_SELECTOR)
          || node.querySelector(WORKSPACE_ROW_SELECTOR) !== null) return true
      }
    }
  }
  return false
}

/**
 * 安装工作区头部的注入按钮（聚焦/折叠双态）：注入样式、跟随列表出现/消失挂载
 * 与移除按钮容器，并跟随行内 `aria-expanded` 变化在折叠与聚焦两个动作间切换。
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
    if (mode === 'focus') {
      // 先等聚焦落定（收起判定依赖展开后的 DOM），再按幸存的展开行重排顺序。
      void (async () => {
        await focusActiveRows(doc)
        await deps.reorder?.(doc)
      })()
    } else {
      collapseExpandedRows(doc)
    }
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
      : 'focus'
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

  const observer = new MutationObserver(records => {
    if (affectsButton(records)) evaluate()
  })
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
