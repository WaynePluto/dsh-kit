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

function lastMenuElement(): { props: { target?: { path: string }; workspaceRoot?: string } } {
  const roots = vi.mocked(createRoot).mock.results
  const renders = roots[roots.length - 1]?.value.render.mock.calls ?? []
  return renders[0]?.[0] as { props: { target?: { path: string } } }
}

describe('installNativeFilesEnhancement（DOM 级）', () => {
  it('发现原生树根：请求当前会话的 Git 快照并装饰行', async () => {
    const loadGit = vi.fn(async (_sessionId: string, _signal: AbortSignal) => snapshot())
    const sidebar = sidebarWith('s1')
    dispose = installNativeFilesEnhancement({} as never, sidebar as never, loadGit, key => key, { open: vi.fn(), confirm: vi.fn() } as never)
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

  it('Git 截断时在树根前插入提示节点', async () => {
    const loadGit = vi.fn(async (_sessionId: string, _signal: AbortSignal) => snapshot({ truncated: true }))
    dispose = installNativeFilesEnhancement({} as never, sidebarWith('s1') as never, loadGit, key => `t:${key}`, { open: vi.fn(), confirm: vi.fn() } as never)
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
    dispose = installNativeFilesEnhancement({} as never, sidebar as never, loadGit, key => key, previewTabs)
    await flush()
    row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(sidebar.openResource).toHaveBeenCalledWith('dsh-resource://file/session/s1/a.md', { paneId: 'pane1' })
  })

  it('右键文件行渲染复制菜单', async () => {
    const loadGit = vi.fn(async (_sessionId: string, _signal: AbortSignal) => snapshot())
    dispose = installNativeFilesEnhancement({} as never, sidebarWith('s1') as never, loadGit, key => key, { open: vi.fn(), confirm: vi.fn() } as never)
    await flush()
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    button.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(lastMenuElement().props.target?.path).toBe('a.md')
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
