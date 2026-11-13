/**
 * DOM 级原生文件树增强（dsh 0.2.0 契约下的替代实现）。
 *
 * 0.2.0 起原生 FilesBody 的座位登记声明 children 并在渲染期调用 props.renderSlot；
 * 同 cell 的 priority 影子条目不声明 children 就拿不到该 prop，包装组件会抛
 * `renderSlot is not a function` 并回退原生（见 docs/dsh/plugins.md）。因此这里不再
 * 替换座位，而是观察 document 中出现的原生树根（`[data-files-state]`），直接在其上
 * 挂捕获事件、插入提示节点并做行级 Git 装饰；React 归属原生，插件不渲染其组件。
 *
 * 文件打开跟随原生行为（2026-11-10 用户需求）：不再 split 分栏，文件打进树所在
 * 分栏（浮动面板不带 paneId，与原生 FilesBody.onOpen 同语义）；斜体临时页签语义
 * 由 PreviewTabs 继续提供。右键菜单完全交给原生 `ctx.contextMenus` 贡献
 * （见 contextMenuContributions.ts），这里不再拦截 contextmenu 或渲染自绘菜单。
 */

import { fileAddressFor } from '@deepseek-ai/dsh-util-workspace-path'
import type { Context } from '@deepseek-ai/cordis'
import type { ISidebarRight, PaneId } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { FilesSnapshot } from '../shared.js'
import { clearNativeRows, decorateNativeRows } from './gitDecorations.js'
import { installNavigatorAutoOpen } from './navigatorAutoOpen.js'
import type { PreviewTabs } from './previewTabs.js'
import type { Translate } from './locales.js'

/** Find a native tree row without mistaking the path header for a row. */
export function contextMenuRow(target: EventTarget | null): HTMLElement | undefined {
  if (!(target instanceof Element)) return undefined
  const row = target.closest<HTMLElement>('[data-files-entry][data-files-path]')
  return row?.dataset.filesPath === undefined ? undefined : row
}

/** One enhanced native tree root and everything attached to it. */
interface RootBinding {
  readonly root: HTMLElement
  readonly note: HTMLElement
  readonly rowObserver: MutationObserver
  /** 待执行重装饰的 rAF 句柄；0 表示无待执行。 */
  decorateFrame: number
  controller: AbortController
  git: FilesSnapshot | undefined
  failure: boolean
  loading: boolean
}

/** Locate the workspace root the native tree is currently showing, if any. */
function filesRootOf(root: HTMLElement): string | undefined {
  return root.dataset.filesState === 'tree' ? root.dataset.filesRoot : undefined
}

// 只有伴随树根挂载/卸载的 mutation 才需要扫描绑定表；聊天流式输出等高频
// 变更批次在此被丢弃，全文档 [data-files-state] 扫描不再随每个批次执行。
function affectsDiscovery(records: readonly MutationRecord[]): boolean {
  for (const record of records) {
    for (const nodes of [record.addedNodes, record.removedNodes]) {
      for (const node of nodes) {
        if (!(node instanceof Element)) continue
        if (node.matches('[data-files-state]')
          || node.querySelector('[data-files-state]') !== null) return true
      }
    }
  }
  return false
}

/**
 * Install the DOM enhancement for the lifetime of the caller's plugin. Discovery
 * reattaches as native trees mount (tab open, session switch, pane split) and
 * detaches when their roots leave the document.
 */
export function installNativeFilesEnhancement(
  _ctx: Context,
  sidebar: ISidebarRight,
  loadGit: (sessionId: SessionId, signal: AbortSignal) => Promise<FilesSnapshot>,
  translate: Translate,
  previewTabs: PreviewTabs,
): () => void {
  const bindings = new Map<HTMLElement, RootBinding>()

  const decorate = (binding: RootBinding): void => {
    decorateNativeRows(binding.root, binding.git, translate)
  }

  // 树内 mutation（展开/折叠、懒加载、行挂载）密集出现时，把全量重装饰合并到
  // 下一帧一次；配合 gitDecorations 的快照级 status 缓存，重复装饰只做幂等属性写。
  const scheduleDecorate = (binding: RootBinding): void => {
    if (binding.decorateFrame !== 0) return
    binding.decorateFrame = requestAnimationFrame(() => {
      binding.decorateFrame = 0
      decorate(binding)
    })
  }

  const updateNote = (binding: RootBinding): void => {
    // 失败/不可用与截断不可能同时成立：前者来自失败或快照自述，后者只在成功快照上出现。
    const message = binding.loading
      ? undefined
      : binding.failure || binding.git?.git.available === false
        ? translate('gitUnavailable')
        : binding.git?.git.truncated === true ? translate('gitTruncated') : undefined
    binding.note.textContent = message ?? ''
    binding.note.hidden = message === undefined
  }

  const refreshGit = (binding: RootBinding): void => {
    const sessionId = sidebar.mounted.getSnapshot()
    const workspaceRoot = filesRootOf(binding.root)
    binding.controller.abort()
    const controller = new AbortController()
    binding.controller = controller
    if (sessionId === undefined || workspaceRoot === undefined) {
      binding.git = undefined
      binding.failure = false
      binding.loading = false
      updateNote(binding)
      decorate(binding)
      return
    }
    binding.loading = true
    updateNote(binding)
    void (async () => {
      try {
        const value = await loadGit(sessionId, controller.signal)
        if (controller.signal.aborted) return
        binding.git = value
        binding.failure = false
      } catch {
        if (controller.signal.aborted) return
        binding.git = undefined
        binding.failure = true
      } finally {
        if (!controller.signal.aborted) {
          binding.loading = false
          updateNote(binding)
          decorate(binding)
        }
      }
    })()
  }

  /**
   * 打开一个文件：与原生 FilesBody.onOpen 同语义，打进树所在分栏；
   * PreviewTabs 在同一分栏内提供斜体临时页签的替换语义。
   */
  const openFile = (binding: RootBinding, absolute: string, permanent: boolean): void => {
    const sessionId = sidebar.mounted.getSnapshot()
    const workspaceRoot = filesRootOf(binding.root)
    const paneElement = binding.root.closest<HTMLElement>('[data-dockkit-pane]')
      ?? binding.root.closest<HTMLElement>('[data-dockkit-float]')
    const panelId = paneElement?.dataset.dockkitPane ?? paneElement?.dataset.dockkitFloat as PaneId | undefined
    if (sessionId === undefined || workspaceRoot === undefined || panelId === undefined) return
    const address = fileAddressFor(sessionId, workspaceRoot, absolute)
    // 浮动面板与原生一致：不带 paneId，交给 Sidebar 自己的放置规则。
    const floating = paneElement?.dataset.dockkitFloat !== undefined
    previewTabs.open(String(sessionId), panelId, address, () => {
      sidebar.openResource(address, floating ? undefined : { paneId: panelId })
    })
    if (permanent) previewTabs.confirm(String(sessionId), panelId, address)
  }

  const attach = (root: HTMLElement): void => {
    const note = document.createElement('div')
    note.className = 'dsh-files-native-note'
    note.setAttribute('role', 'status')
    note.hidden = true
    // 提示节点必须插在树根内部（树根是 flex column，提示成为自身一行）。
    // 若作为树根的前一个兄弟插入，树根的父容器是 flex row（files 页 content、
    // 预览 navigator row），可见的提示会以 width:100% 吃掉整行宽度，把
    // flex:1 1 auto; min-width:0 的树根压到 0——Git 状态不可用时整棵树不可见。
    // React 只操作自身节点，忽略外部子节点；树根卸载时由 detach 一并移除。
    root.insertBefore(note, root.firstChild)

    const binding: RootBinding = {
      root,
      note,
      rowObserver: new MutationObserver(() => { scheduleDecorate(binding) }),
      decorateFrame: 0,
      controller: new AbortController(),
      git: undefined,
      failure: false,
      loading: false,
    }
    bindings.set(root, binding)

    root.addEventListener('click', (event) => {
      const row = contextMenuRow(event.target)
      if (row?.dataset.filesEntry !== 'file' || filesRootOf(root) === undefined) return
      const absolute = row.dataset.filesPath
      if (absolute === undefined || sidebar.mounted.getSnapshot() === undefined) return
      openFile(binding, absolute, false)
      event.preventDefault()
      event.stopPropagation()
    }, true)
    root.addEventListener('dblclick', (event) => {
      const row = contextMenuRow(event.target)
      if (row?.dataset.filesEntry !== 'file' || filesRootOf(root) === undefined) return
      const absolute = row.dataset.filesPath
      if (absolute === undefined || sidebar.mounted.getSnapshot() === undefined) return
      openFile(binding, absolute, true)
      event.preventDefault()
      event.stopPropagation()
    }, true)
    root.addEventListener('click', (event) => {
      if (event.target instanceof Element && event.target.closest('[data-files-reload]') !== null) {
        refreshGit(binding)
      }
    })

    binding.rowObserver.observe(root, { childList: true, subtree: true })
    refreshGit(binding)
  }

  const detach = (binding: RootBinding): void => {
    if (binding.decorateFrame !== 0) cancelAnimationFrame(binding.decorateFrame)
    binding.decorateFrame = 0
    binding.rowObserver.disconnect()
    binding.controller.abort()
    binding.note.remove()
    clearNativeRows(binding.root)
  }

  const scan = (): void => {
    for (const root of document.querySelectorAll<HTMLElement>('[data-files-state]')) {
      if (!bindings.has(root) && root instanceof HTMLElement) attach(root)
    }
    for (const [root, binding] of bindings) {
      if (!root.isConnected) {
        detach(binding)
        bindings.delete(root)
      }
    }
  }

  const discovery = new MutationObserver(records => {
    if (affectsDiscovery(records)) scan()
  })
  discovery.observe(document.body, { childList: true, subtree: true })
  const unsubscribeMounted = sidebar.mounted.subscribe(() => {
    for (const binding of bindings.values()) refreshGit(binding)
  })
  // 预览页签的目录树默认展开（每个分栏一次，用户接管后不代点）。
  const disposeAutoOpen = installNavigatorAutoOpen()
  scan()

  return () => {
    disposeAutoOpen()
    discovery.disconnect()
    unsubscribeMounted()
    for (const binding of bindings.values()) detach(binding)
    bindings.clear()
  }
}
