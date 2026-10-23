/**
 * 原生工作区 `···` 菜单的「复制路径」注入编排。
 *
 * dsh 只为会话行菜单提供槽位（`sidebar.workspaces.session.menu.item`，见上游
 * `packages/client/ui-workspace/src/client/contract/slots.ts`）；工作区行菜单是
 * ui-workspace 私有的 rename/delete 两行，没有插件接缝。因此按
 * deepseek-official-switch CardActions 的同款结构化注入工作：
 * 捕获工作区行（`[data-row-key="workspace:<id>"]`）的点击做归因 → 等 Menu portal
 * （`[role="menu"]`，直接挂 document.body）出现 → 在其 viewport 里挂「复制路径」行。
 * Menu 的方向键走查读 DOM（`querySelectorAll('button:not(:disabled)')`），
 * 注入的 `button[role="menuitem"]` 自动加入键盘导航。
 *
 * @module @dsh-kit/dsh-plugin-workspace-path/client/menuPath
 */

/** 工作区行 `data-row-key` 的前缀；会话行是 `session:`、溢出行是 `overflow:`。 */
export const WORKSPACE_ROW_PREFIX = 'workspace:'

/**
 * 归因窗口：点击工作区行后这么多毫秒内出现的菜单才认为是该行的 `···` 菜单。
 * React 在离散点击事件后同步提交 portal，窗口只是对其他来源菜单的防御。
 */
export const ATTRIBUTION_MS = 600

/** 注入标记，挂在菜单面元素上，保证同一菜单只注入一次。 */
const INJECTED_ATTR = 'data-dsh-workspace-path'

/**
 * 从事件目标解析工作区行的 key。
 * @param target - 事件目标。
 * @returns `data-row-key` 去掉 `workspace:` 前缀的 key；不是工作区行时为 undefined。
 */
export function workspaceRowKeyOf(target: EventTarget | null): string | undefined {
  if (!(target instanceof Element)) return undefined
  const row = target.closest('[data-row-key]')
  if (row === null) return undefined
  const key = row.getAttribute('data-row-key') ?? ''
  return key.startsWith(WORKSPACE_ROW_PREFIX) ? key.slice(WORKSPACE_ROW_PREFIX.length) : undefined
}

/**
 * 关闭当前打开的菜单：合成 Escape 派发到 document。
 * Menu 在 document 捕获层监听 Escape（`onEscape` → `onClose` + 焦点归还锚点，
 * 见上游 ui-primitives `Menu.tsx`）；注入项不在菜单的 items 数组里，
 * 得不到 owner 的 onSelect 关闭路径，用同一事件语义代偿。
 * @param document - 页面文档。
 */
export function closeOpenMenu(document: Document): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
}

/**
 * 让宿主 Menu 认为指针回到了它的 React 子树：向菜单 viewport 合成派发一次
 * `pointerover`（relatedTarget 为 null 表示来自外部）。
 * `closeOnPointerLeave` 下宿主 wrapper 的 `onPointerLeave` 会 armClose（200ms 后关闭，
 * `pointer-grace.ts`），唯一取消路径是 wrapper 的 `onPointerEnter`（由 pointerover 推导）。
 * 注入行属于独立 React 根：指针移入它时宿主只收到 leave、收不到 enter，菜单会误关；
 * viewport 是宿主 React 树成员（portal 子节点），这次合成事件让 enter 路径抵达 wrapper。
 * @param viewport - 菜单 viewport 元素（宿主 React 树成员）。
 */
export function reenterHostMenu(viewport: Element): void {
  // jsdom 可能没有 PointerEvent；React 只按事件 type（pointerover）监听，实例类无关。
  const Ctor = typeof PointerEvent === 'function' ? PointerEvent : MouseEvent
  viewport.dispatchEvent(new Ctor('pointerover', { bubbles: true, relatedTarget: null }))
}

/** {@link installWorkspaceMenuCopy} 的全部外部依赖，测试逐项注入。 */
export interface MenuPathDeps {
  document: Document
  /** 工作区 key → 完整路径；未分组桶等解析不到时返回 undefined（不注入）。 */
  resolvePath: (workspaceKey: string) => string | undefined
  /** 在菜单里挂载「复制路径」行；返回卸载回调。 */
  mount: (container: HTMLElement, options: MenuButtonOptions) => () => void
  /** 「复制路径」文案。 */
  copyLabel: string
  /** 点击菜单项后的复制动作。 */
  copy: (path: string) => void
  /** 点击菜单项后的关闭动作。 */
  closeMenu: () => void
  /** 时钟，测试注入。 */
  now?: () => number
}

/** 「复制路径」行的挂载参数。 */
export interface MenuButtonOptions {
  label: string
  path: string
  onCopy: () => void
}

/**
 * 安装工作区菜单的「复制路径」注入。
 * @param deps - 外部依赖。
 * @returns 卸载函数：移除监听、断开观察并卸载所有已挂载的行。
 */
export function installWorkspaceMenuCopy(deps: MenuPathDeps): () => void {
  const now = deps.now ?? Date.now
  let armedKey: string | undefined
  let armedUntil = 0
  const unmounts = new Map<Element, () => void>()

  const onCaptureClick = (event: Event): void => {
    const key = workspaceRowKeyOf(event.target)
    if (key === undefined) return
    armedKey = key
    armedUntil = now() + ATTRIBUTION_MS
  }

  const adoptMenu = (menu: Element): void => {
    if (menu.hasAttribute(INJECTED_ATTR)) return
    if (armedKey === undefined || now() > armedUntil) return
    // 只认真正的行菜单：至少有一个原生 menuitem（工作区菜单是 rename + delete 两行）。
    // 不是行菜单就不消费归因——窗口内先出现的无关表面不挡住随后到达的真正菜单。
    if (menu.querySelectorAll('button[role="menuitem"]').length === 0) return
    // 归因是一次性的：被认领后，同一窗口内再出现的菜单不再属于这次点击。
    const key = armedKey
    armedKey = undefined
    menu.setAttribute(INJECTED_ATTR, '')
    const path = deps.resolvePath(key)
    if (path === undefined) return
    const nativeRows = menu.querySelectorAll('button[role="menuitem"]')
    const viewport = menu.querySelector(':scope > div[role="presentation"]') ?? menu
    const container = deps.document.createElement('div')
    // 悬停可见将要复制的完整路径；行本身只显示「复制路径」。
    container.title = path
    // 指针进入注入行时补一次宿主的 enter，抵消宿主对「离开 wrapper」的 closeOnPointerLeave 判定。
    // ⚠️ 必须补两次：跨 React 根的 over/out 过渡没有共同祖先，React 会把离开侧整条祖先链都派发
    // leave——pointerout（离开原生行）和紧随其后的 pointerover（进入注入行本身）各 arm 一次。
    // pointerenter 的立即补偿只覆盖前者；后者由 pointerover 里推迟到本轮事件处理完的补偿覆盖
    // （同一事件的任何同步代码都先于 React 在 body 上的监听运行，立即补会被再次 arm 覆盖）。
    let pendingReenter: ReturnType<typeof setTimeout> | undefined
    const reenterNow = (): void => { reenterHostMenu(viewport) }
    const reenterSoon = (): void => {
      if (pendingReenter !== undefined) clearTimeout(pendingReenter)
      pendingReenter = setTimeout(() => {
        pendingReenter = undefined
        reenterHostMenu(viewport)
      }, 0)
    }
    container.addEventListener('pointerenter', reenterNow)
    container.addEventListener('pointerover', reenterSoon)
    // 指针从注入行直接移出菜单时，跨根过渡的 leave 只落在注入行自己的树里，宿主收不到
    // 任何 leave，菜单不会像原生那样延迟关闭；补一次 viewport 上的 pointerout 让宿主
    // 正常 armClose。移回原生行（relatedTarget 仍在 viewport 内）时不补——宿主自己的
    // enter 处理会取消任何挂起的关闭，补了反而误关。
    const reenterLeave = (event: Event): void => {
      const related = (event as PointerEvent).relatedTarget
      if (related instanceof Node && viewport.contains(related)) return
      const Ctor = typeof PointerEvent === 'function' ? PointerEvent : MouseEvent
      viewport.dispatchEvent(new Ctor('pointerout', { bubbles: true, relatedTarget: related instanceof Node ? related : null }))
    }
    container.addEventListener('pointerout', reenterLeave)
    // 原生最后一行是危险操作（删除工作区）；复制路径插在它前面，保持危险项收尾的原生次序。
    const last = nativeRows[nativeRows.length - 1]
    if (last !== undefined && last.parentElement === viewport) viewport.insertBefore(container, last)
    else viewport.appendChild(container)
    const unmount = deps.mount(container, {
      label: deps.copyLabel,
      path,
      onCopy: () => {
        deps.copy(path)
        deps.closeMenu()
      },
    })
    unmounts.set(menu, () => {
      container.removeEventListener('pointerenter', reenterNow)
      container.removeEventListener('pointerover', reenterSoon)
      container.removeEventListener('pointerout', reenterLeave)
      if (pendingReenter !== undefined) clearTimeout(pendingReenter)
      unmount()
    })
  }

  const releaseMenus = (removed: Node): void => {
    if (!(removed instanceof Element)) return
    for (const [menu, unmount] of unmounts) {
      if (menu === removed || removed.contains(menu)) {
        unmounts.delete(menu)
        unmount()
      }
    }
  }

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue
        // portal 菜单直接是 body 的 [role=menu] 子节点（契约见 workspace 菜单
        // portal 的 createPortal(document.body)）。只观察 body 直接子节点的增删，
        // 不用 subtree——聊天流式输出的深层 DOM 变更不进本回调。
        if (node.matches('[role="menu"]')) adoptMenu(node)
      }
      for (const node of record.removedNodes) releaseMenus(node)
    }
  })

  deps.document.addEventListener('click', onCaptureClick, true)
  observer.observe(deps.document.body, { childList: true })
  return () => {
    deps.document.removeEventListener('click', onCaptureClick, true)
    observer.disconnect()
    for (const unmount of unmounts.values()) unmount()
    unmounts.clear()
  }
}
