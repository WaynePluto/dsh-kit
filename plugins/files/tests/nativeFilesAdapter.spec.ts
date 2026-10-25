// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-dom/client', () => ({
  createRoot: vi.fn(() => ({ render: vi.fn(), unmount: vi.fn() })),
}))

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Menu: (): null => null,
  writeClipboard: vi.fn(async () => true),
}))

import { installNativeFilesEnhancement } from '../src/client/nativeFilesAdapter.js'
import { createRoot } from 'react-dom/client'
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
  split: ReturnType<typeof vi.fn>
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
    split: vi.fn(() => 'pane2'),
  }
}

let pane: HTMLElement
let tree: HTMLElement
let row: HTMLLIElement
let button: HTMLButtonElement
let dispose: (() => void) | undefined

beforeEach(() => {
  vi.stubGlobal('window', { innerWidth: 600 })
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
  vi.unstubAllGlobals()
  window.innerWidth = 1024
})

async function flush(): Promise<void> {
  for (let index = 0; index < 4; index += 1) {
    // eslint-disable-next-line no-await-in-loop -- 顺序等待 MutationObserver 与加载 promise 的逐轮刷新
    await new Promise(resolve => { setTimeout(resolve, 0) })
  }
}

function lastMenuElement(): { props: { target?: { path: string; kind: 'file' | 'directory' }; workspaceRoot?: string; onGitReview?: (path: string) => void } } {
  const roots = vi.mocked(createRoot).mock.results
  const renders = roots[roots.length - 1]?.value.render.mock.calls ?? []
  return renders[0]?.[0] as { props: { target?: { path: string; kind: 'file' | 'directory' }; onGitReview?: (path: string) => void } }
}

describe('installNativeFilesEnhancement（DOM 级）', () => {
  it('发现原生树根：请求当前会话的 Git 快照并装饰行', async () => {
    const loadGit = vi.fn(async (_sessionId: string, _signal: AbortSignal) => snapshot())
    const sidebar = sidebarWith('s1')
    dispose = installNativeFilesEnhancement({} as never, sidebar as never, loadGit, key => key, { open: vi.fn(), confirm: vi.fn() } as never, vi.fn())
    await flush()
    expect(loadGit).toHaveBeenCalledOnce()
    expect(loadGit.mock.calls[0]?.[0]).toBe('s1')
    expect(button.dataset.filesGitStatus).toBe('modified')
    expect(button.dataset.filesGitMarker).toBe('M')
    const note = document.querySelector('.dsh-files-native-note')
    expect(note).not.toBeNull()
    expect((note as HTMLElement).hidden).toBe(true)
    // 菜单宿主必须零尺寸脱离布局：流内行盒会撑出 body 滚动条（右键时全页横移抖动）。
    const host = document.body.lastElementChild as HTMLElement
    expect(getComputedStyle(host).position).toBe('fixed')
    expect(getComputedStyle(host).width).toBe('0px')
    expect(getComputedStyle(host).height).toBe('0px')
  })

  it('树内新增行经合并装饰；无关 body 变更不做发现扫描', async () => {
    const loadGit = vi.fn(async (_sessionId: string, _signal: AbortSignal) => twoEntries())
    dispose = installNativeFilesEnhancement({} as never, sidebarWith('s1') as never, loadGit, key => key, { open: vi.fn(), confirm: vi.fn() } as never, vi.fn())
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

  it('Git 截断时在树根前插入提示节点', async () => {
    const loadGit = vi.fn(async (_sessionId: string, _signal: AbortSignal) => snapshot({ truncated: true }))
    dispose = installNativeFilesEnhancement({} as never, sidebarWith('s1') as never, loadGit, key => `t:${key}`, { open: vi.fn(), confirm: vi.fn() } as never, vi.fn())
    await flush()
    const note = document.querySelector('.dsh-files-native-note') as HTMLElement
    expect(note.hidden).toBe(false)
    expect(note.textContent).toBe('t:gitTruncated')
    expect(note.nextElementSibling).toBe(tree)
  })

  it('单击文件行经预览页签打开并拦截原生点击', async () => {
    const loadGit = vi.fn(async (_sessionId: string, _signal: AbortSignal) => snapshot())
    const sidebar = sidebarWith('s1')
    const previewTabs = new PreviewTabs()
    dispose = installNativeFilesEnhancement({} as never, sidebar as never, loadGit, key => key, previewTabs, vi.fn())
    await flush()
    row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(sidebar.openResource).toHaveBeenCalledWith('dsh-resource://file/session/s1/a.md', { paneId: 'pane1' })
  })

  it('右键文件行渲染复制菜单并携带文件行类型', async () => {
    const loadGit = vi.fn(async (_sessionId: string, _signal: AbortSignal) => snapshot())
    dispose = installNativeFilesEnhancement({} as never, sidebarWith('s1') as never, loadGit, key => key, { open: vi.fn(), confirm: vi.fn() } as never, vi.fn())
    await flush()
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    button.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    const menu = lastMenuElement()
    expect(menu.props.target?.path).toBe('a.md')
    expect(menu.props.target?.kind).toBe('file')
    expect(typeof menu.props.onGitReview).toBe('function')
  })

  it('右键目录行不携带文件行类型', async () => {
    const loadGit = vi.fn(async (_sessionId: string, _signal: AbortSignal) => snapshot())
    dispose = installNativeFilesEnhancement({} as never, sidebarWith('s1') as never, loadGit, key => key, { open: vi.fn(), confirm: vi.fn() } as never, vi.fn())
    row.dataset.filesEntry = 'directory'
    await flush()
    button.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    expect(lastMenuElement().props.target?.kind).toBe('directory')
  })

  it('卸载后移除提示节点与装饰属性，点击不再走插件预览', async () => {
    const loadGit = vi.fn(async (_sessionId: string, _signal: AbortSignal) => snapshot())
    const sidebar = sidebarWith('s1')
    dispose = installNativeFilesEnhancement({} as never, sidebar as never, loadGit, key => key, { open: vi.fn(), confirm: vi.fn() } as never, vi.fn())
    await flush()
    dispose()
    dispose = undefined
    expect(document.querySelector('.dsh-files-native-note')).toBeNull()
    expect(button.dataset.filesGitStatus).toBeUndefined()
    row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(sidebar.openResource).not.toHaveBeenCalled()
  })
})
