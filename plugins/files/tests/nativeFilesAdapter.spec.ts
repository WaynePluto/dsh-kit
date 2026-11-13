// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { installNativeFilesEnhancement } from '../src/client/nativeFilesAdapter.js'
import { PreviewTabs } from '../src/client/previewTabs.js'
import type { FilesSnapshot } from '../src/shared.js'

const snapshot = (overlays: Partial<FilesSnapshot['git']> = {}): FilesSnapshot => ({
  workspacePath: 'C:\\work',
  git: { available: true, truncated: false, entries: [{ path: 'a.md', status: 'modified' }], ...overlays },
})

/** 两行 Git 状态的快照工厂。 */
const twoEntries = (): FilesSnapshot => ({
  workspacePath: 'C:\\work',
  git: {
    available: true,
    truncated: false,
    entries: [
      { path: 'a.md', status: 'modified' },
      { path: 'b.md', status: 'added' },
    ],
  },
})

type SidebarFake = {
  mounted: { getSnapshot: () => string | undefined; subscribe: (fn: () => void) => () => void }
  openResource: ReturnType<typeof vi.fn>
}

function sidebarWith(session: string | undefined): SidebarFake {
  const listeners = new Set<() => void>()
  return {
    mounted: {
      getSnapshot: () => session,
      subscribe: (fn: () => void) => {
        listeners.add(fn)
        return () => { listeners.delete(fn) }
      },
    },
    openResource: vi.fn(),
  }
}

let pane: HTMLElement
let tree: HTMLElement
let row: HTMLLIElement
let button: HTMLButtonElement
let dispose: (() => void) | undefined

beforeEach(() => {
  document.body.innerHTML = ''
  pane = document.createElement('div')
  pane.dataset.dockkitPane = 'pane1'
  tree = document.createElement('div')
  tree.dataset.filesState = 'tree'
  tree.dataset.filesRoot = 'C:\\work'
  row = document.createElement('li')
  row.dataset.filesEntry = 'file'
  row.dataset.filesPath = 'C:\\work\\a.md'
  button = document.createElement('button')
  button.textContent = 'a.md'
  row.append(button)
  const list = document.createElement('ul')
  list.append(row)
  tree.append(list)
  pane.append(tree)
  document.body.append(pane)
})

afterEach(() => {
  dispose?.()
  dispose = undefined
})

async function flush(): Promise<void> {
  for (let index = 0; index < 4; index += 1) {
    // eslint-disable-next-line no-await-in-loop -- 顺序等待 MutationObserver 与加载 promise 的逐轮刷新
    await new Promise(resolve => { setTimeout(resolve, 0) })
  }
}

describe('installNativeFilesEnhancement（DOM 级）', () => {
  it('发现原生树根：请求当前会话的 Git 快照并装饰行', async () => {
    const loadGit = vi.fn(async (_sessionId: string, _signal: AbortSignal) => snapshot())
    dispose = installNativeFilesEnhancement({} as never, sidebarWith('s1') as never, loadGit, key => key, { open: vi.fn(), confirm: vi.fn() } as never)
    await flush()
    expect(loadGit).toHaveBeenCalledOnce()
    expect(loadGit.mock.calls[0]?.[0]).toBe('s1')
    expect(button.dataset.filesGitStatus).toBe('modified')
    expect(button.dataset.filesGitMarker).toBe('M')
    const note = document.querySelector('.dsh-files-native-note')
    expect(note).not.toBeNull()
    expect((note as HTMLElement).hidden).toBe(true)
  })

  it('树内新增行经合并装饰；无关 body 变更不做发现扫描', async () => {
    const loadGit = vi.fn(async (_sessionId: string, _signal: AbortSignal) => twoEntries())
    dispose = installNativeFilesEnhancement({} as never, sidebarWith('s1') as never, loadGit, key => key, { open: vi.fn(), confirm: vi.fn() } as never)
    await flush()

    // 树内新增一行：rowObserver 的重装饰经 rAF 合并后落到新行上。
    const row2 = document.createElement('li')
    row2.dataset.filesEntry = 'file'
    row2.dataset.filesPath = 'C:\\work\\b.md'
    const button2 = document.createElement('button')
    button2.textContent = 'b.md'
    row2.append(button2)
    document.querySelector('ul')?.append(row2)
    // jsdom 的 rAF 按帧间隔触发，等待一个帧周期以上再断言。
    await new Promise(resolve => { setTimeout(resolve, 100) })
    await flush()
    expect(button2.dataset.filesGitStatus).toBe('added')

    // 无关 body 变更（别处新增子树）不触发全文档 [data-files-state] 扫描。
    const querySpy = vi.spyOn(document, 'querySelectorAll')
    const chat = document.createElement('div')
    chat.innerHTML = '<p>streaming <span>token</span></p>'
    document.body.append(chat)
    await flush()
    expect(querySpy.mock.calls.map(call => call[0])).not.toContain('[data-files-state]')
    querySpy.mockRestore()
  })

  it('Git 截断时在树根内部首行插入提示节点（不得成为 flex row 的兄弟节点）', async () => {
    const loadGit = vi.fn(async (_sessionId: string, _signal: AbortSignal) => snapshot({ truncated: true }))
    dispose = installNativeFilesEnhancement({} as never, sidebarWith('s1') as never, loadGit, key => `t:${key}`, { open: vi.fn(), confirm: vi.fn() } as never)
    await flush()
    const note = document.querySelector('.dsh-files-native-note') as HTMLElement
    expect(note.hidden).toBe(false)
    expect(note.textContent).toBe('t:gitTruncated')
    // 树根父容器是 flex row，提示若在树根外会把树压到 0 宽（2026-11-13 用户实机回归）。
    expect(note.parentElement).toBe(tree)
    expect(tree.firstElementChild).toBe(note)
  })

  it('单击文件行在树所在分栏打开，不再 split 分栏', async () => {
    const loadGit = vi.fn(async (_sessionId: string, _signal: AbortSignal) => snapshot())
    const sidebar = sidebarWith('s1')
    const previewTabs = new PreviewTabs()
    dispose = installNativeFilesEnhancement({} as never, sidebar as never, loadGit, key => key, previewTabs)
    await flush()
    row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(sidebar.openResource).toHaveBeenCalledOnce()
    expect(sidebar.openResource).toHaveBeenCalledWith('dsh-resource://file/session/s1/a.md', { paneId: 'pane1' })
  })

  it('浮动面板里的树打开文件不带 paneId（与原生 onOpen 同语义）', async () => {
    const loadGit = vi.fn(async (_sessionId: string, _signal: AbortSignal) => snapshot())
    const sidebar = sidebarWith('s1')
    const previewTabs = new PreviewTabs()
    const float = document.createElement('div')
    float.dataset.dockkitFloat = 'float1'
    float.append(tree)
    pane.replaceWith(float)
    dispose = installNativeFilesEnhancement({} as never, sidebar as never, loadGit, key => key, previewTabs)
    await flush()
    row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(sidebar.openResource).toHaveBeenCalledWith('dsh-resource://file/session/s1/a.md', undefined)
  })

  it('双击文件行在打开之外把目标页签转为保留', async () => {
    const loadGit = vi.fn(async (_sessionId: string, _signal: AbortSignal) => snapshot())
    const sidebar = sidebarWith('s1')
    const previewTabs = { open: vi.fn(), confirm: vi.fn() }
    dispose = installNativeFilesEnhancement({} as never, sidebar as never, loadGit, key => key, previewTabs as never)
    await flush()
    row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
    expect(previewTabs.open).toHaveBeenCalledWith('s1', 'pane1', 'dsh-resource://file/session/s1/a.md', expect.any(Function))
    expect(previewTabs.confirm).toHaveBeenCalledWith('s1', 'pane1', 'dsh-resource://file/session/s1/a.md')
    // open 的 source 仍走原生打开语义。
    const source = previewTabs.open.mock.calls[0]?.[3] as () => void
    source()
    expect(sidebar.openResource).toHaveBeenCalledWith('dsh-resource://file/session/s1/a.md', { paneId: 'pane1' })
  })

  it('右键不再被插件拦截，交给原生 contextMenus 菜单', async () => {
    const loadGit = vi.fn(async (_sessionId: string, _signal: AbortSignal) => snapshot())
    dispose = installNativeFilesEnhancement({} as never, sidebarWith('s1') as never, loadGit, key => key, { open: vi.fn(), confirm: vi.fn() } as never)
    await flush()
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    button.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })

  it('卸载后移除提示节点与装饰属性，点击不再走插件预览', async () => {
    const loadGit = vi.fn(async (_sessionId: string, _signal: AbortSignal) => snapshot())
    const sidebar = sidebarWith('s1')
    dispose = installNativeFilesEnhancement({} as never, sidebar as never, loadGit, key => key, { open: vi.fn(), confirm: vi.fn() } as never)
    await flush()
    dispose()
    dispose = undefined
    expect(document.querySelector('.dsh-files-native-note')).toBeNull()
    expect(button.dataset.filesGitStatus).toBeUndefined()
    row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(sidebar.openResource).not.toHaveBeenCalled()
  })
})
