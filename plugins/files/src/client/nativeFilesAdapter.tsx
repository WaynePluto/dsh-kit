/**
 * DOM 级原生文件树增强（dsh 0.2.0 契约下的替代实现）。
 *
 * 0.2.0 起原生 FilesBody 的座位登记声明 children 并在渲染期调用 props.renderSlot；
 * 同 cell 的 priority 影子条目不声明 children 就拿不到该 prop，包装组件会抛
 * `renderSlot is not a function` 并回退原生（见 docs/dsh/plugins.md）。因此这里不再
 * 替换座位，而是观察 document 中出现的原生树根（`[data-files-state]`），直接在其上
 * 挂捕获事件、插入提示节点并做行级 Git 装饰；React 归属原生，插件不渲染其组件。
 */

import { createRoot, type Root } from 'react-dom/client'
import { fileAddressFor } from '@deepseek-ai/dsh-util-workspace-path'
import type { Context } from '@deepseek-ai/cordis'
import type { ISidebarRight, PaneId } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { FilesSnapshot } from '../shared.js'
import { FileContextMenu, contextMenuRow, type ContextMenuTarget } from './FileContextMenu.js'
import { clearNativeRows, decorateNativeRows } from './gitDecorations.js'
import { openInPreviewPane, type PaneNavigationContext, type PreviewPaneRef } from './paneNavigation.js'
import type { PreviewTabs } from './previewTabs.js'
import type { Translate } from './locales.js'
import { workspaceRelativePath } from './treePath.js'

export type { PaneNavigationContext } from './paneNavigation.js'

/** One enhanced native tree root and everything attached to it. */
interface RootBinding {
  readonly root: HTMLElement
  readonly paneRef: PreviewPaneRef
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
  openGitReview: (sessionId: SessionId, path: string) => void,
): () => void {
  // 右键菜单是独立 React 根（react-dom/client 属 shell 平台模块），不进入原生树。
  // 宿主必须零尺寸且脱离 body 流：菜单打开时锚点 span 会在流内生成行盒，把 body
  // 撑出约一行高度、触发页面滚动条，整个工作台横移一个滚动条宽度（实测 5px 抖动）。
  const menuHost = document.createElement('div')
  menuHost.style.position = 'fixed'
  menuHost.style.top = '0'
  menuHost.style.left = '0'
  menuHost.style.width = '0'
  menuHost.style.height = '0'
  menuHost.style.overflow = 'hidden'
  document.body.append(menuHost)
  let menuRoot: Root | undefined
  let menuTarget: ContextMenuTarget | undefined
  let menuWorkspaceRoot: string | undefined
  const renderMenu = (): void => {
    menuRoot ??= createRoot(menuHost)
    menuRoot.render(
      <FileContextMenu
        target={menuTarget}
        workspaceRoot={menuWorkspaceRoot}
        t={translate}
        onGitReview={path => {
          const sessionId = sidebar.mounted.getSnapshot()
          if (sessionId !== undefined) openGitReview(sessionId, path)
        }}
        onClose={() => {
          menuTarget = undefined
          renderMenu()
        }}
      />,
    )
  }

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

  const openFile = (binding: RootBinding, absolute: string, permanent: boolean): void => {
    const sessionId = sidebar.mounted.getSnapshot()
    const workspaceRoot = filesRootOf(binding.root)
    const panelId = binding.root.closest<HTMLElement>('[data-dockkit-pane]')?.dataset.dockkitPane as PaneId | undefined
    if (sessionId === undefined || workspaceRoot === undefined || panelId === undefined) return
    const address = fileAddressFor(sessionId, workspaceRoot, absolute)
    const nav: PaneNavigationContext = { panelId, isLive: () => binding.root.isConnected }
    const opened = openInPreviewPane(
      sidebar, nav, sessionId, workspaceRoot, absolute, binding.paneRef,
      paneId => previewTabs.open(String(sessionId), paneId, address, () => {
        sidebar.openResource(address, { paneId })
      }),
    )
    if (opened && permanent) {
      previewTabs.confirm(String(sessionId), binding.paneRef.current ?? panelId, address)
    }
  }

  const attach = (root: HTMLElement): void => {
    const note = document.createElement('div')
    note.className = 'dsh-files-native-note'
    note.setAttribute('role', 'status')
    note.hidden = true
    // 提示节点插在原生树根之前。React 只按自身引用操作子节点，不重排外部兄弟节点；
    // 根节点离开文档时由 detach 一并移除。
    root.parentElement?.insertBefore(note, root)

    const binding: RootBinding = {
      root,
      paneRef: { current: undefined },
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
    root.addEventListener('contextmenu', (event) => {
      const row = contextMenuRow(event.target)
      if (row === undefined || filesRootOf(root) === undefined) return
      if (event instanceof MouseEvent) {
        const absolute = row.dataset.filesPath
        const workspaceRoot = filesRootOf(root)
        if (absolute === undefined || workspaceRoot === undefined) return
        event.preventDefault()
        const relative = workspaceRelativePath(workspaceRoot, absolute)
        if (relative === undefined) return
        menuWorkspaceRoot = workspaceRoot
        menuTarget = {
          path: relative,
          kind: row.dataset.filesEntry === 'file' ? 'file' : 'directory',
          x: event.clientX,
          y: event.clientY,
          focus: row.querySelector<HTMLButtonElement>('button'),
        }
        renderMenu()
      }
    })
    root.addEventListener('keydown', (event) => {
      if (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey)) return
      const row = contextMenuRow(event.target)
      if (row === undefined || filesRootOf(root) === undefined) return
      const rect = row.querySelector<HTMLButtonElement>('button')?.getBoundingClientRect()
        ?? row.getBoundingClientRect()
      const absolute = row.dataset.filesPath
      const workspaceRoot = filesRootOf(root)
      if (absolute === undefined || workspaceRoot === undefined) return
      event.preventDefault()
      const relative = workspaceRelativePath(workspaceRoot, absolute)
      if (relative === undefined) return
      menuWorkspaceRoot = workspaceRoot
      menuTarget = {
        path: relative,
        kind: row.dataset.filesEntry === 'file' ? 'file' : 'directory',
        x: rect.left + Math.min(rect.width, 16),
        y: rect.bottom,
        focus: row.querySelector('button'),
      }
      renderMenu()
    })
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
  scan()

  return () => {
    discovery.disconnect()
    unsubscribeMounted()
    for (const binding of bindings.values()) detach(binding)
    bindings.clear()
    menuTarget = undefined
    menuRoot?.unmount()
    menuRoot = undefined
    menuHost.remove()
  }
}
