import { describe, expect, it, vi } from 'vitest'
import { apply, inject } from './index.js'
import { installNativeFilesEnhancement } from './nativeFilesAdapter.js'

vi.mock('./styles.js', () => ({ installStyles: () => () => {} }))
vi.mock('./nativeFilesAdapter.js', () => ({ installNativeFilesEnhancement: vi.fn(() => () => {}) }))
vi.mock('./previewTabTitle.js', () => ({ installPreviewTitleEnhancement: () => () => {}, installTabChipConfirm: () => () => {} }))
vi.mock('./tabContextActions.js', () => ({ installTabContextActions: () => () => {} }))
vi.mock('./previewTabs.js', () => ({ PreviewTabs: class { dispose(): void {} } }))
vi.mock('./imageZoomOverlay.js', () => ({ ImageZoomStore: class { clear(): void {} } }))
vi.mock('./gitReviewTab.js', () => ({
  GIT_REVIEW_TAB_ID: '@dsh-kit/dsh-plugin-files/git-review',
  GitReviewData: class {
    summarySource = { getSnapshot: () => new Map(), subscribe: () => () => {} }
    diffSource = { getSnapshot: () => new Map(), subscribe: () => () => {} }
    reset(): void {}
    loadSummary = vi.fn(async () => {})
    reloadSummary = vi.fn(async () => {})
    loadDiff = vi.fn(async () => {})
  },
  GitReviewTab: (): null => null,
  gitReviewAddress: (sessionId: string) => `dsh-resource://files-git-review/session/${encodeURIComponent(sessionId)}`,
  gitReviewTabDefinition: () => ({
    id: '@dsh-kit/dsh-plugin-files/git-review',
    kind: 'files-git-review',
    patterns: ['dsh-resource://files-git-review/**'],
    title: () => 'Git changes',
  }),
  createGitReviewStore: () => ({ init: () => ({ byTab: {} }), actions: {} }),
}))

describe('files Sidebar 注册', () => {
  it('只包装原生文件树，不接管「开始」页或修改其入口', () => {
    const effects: Array<() => void> = []
    const register = vi.fn(() => () => {})
    const injectSlot = vi.fn((_name: string, run: () => unknown) => { run() })
    const registerTab = vi.fn((_definition: unknown) => () => {})
    const ctx = {
      locale: { register: vi.fn(() => () => {}), bind: () => (key: string) => key },
      slots: { inject: injectSlot, register },
      sidebarRight: { openResource: vi.fn() },
      sidebarRightTabs: { register: registerTab },
      on: vi.fn(() => () => {}),
      effect: (install: () => void | (() => void)) => {
        const dispose = install()
        if (dispose !== undefined) effects.push(dispose)
      },
    }

    apply(ctx as never)

    expect(inject).toEqual(['slots', 'locale', 'connection', 'sidebarRight', 'sidebarRightTabs'])
    expect(installNativeFilesEnhancement).toHaveBeenCalledOnce()
    // Git review 页签类型与正文分别注册在官方契约座位上。
    expect(registerTab).toHaveBeenCalledOnce()
    expect(registerTab.mock.calls[0]?.[0]).toMatchObject({
      id: '@dsh-kit/dsh-plugin-files/git-review',
      kind: 'files-git-review',
      patterns: ['dsh-resource://files-git-review/**'],
    })
    expect(injectSlot).toHaveBeenCalledWith('sidebar.right.pane.tab', expect.anything())
    expect(register).toHaveBeenCalledWith(expect.objectContaining({
      name: 'sidebar.right.pane.tab',
      key: '@dsh-kit/dsh-plugin-files/git-review',
    }), expect.anything())
    // 不注册开始页入口或 guide。
    expect(injectSlot).not.toHaveBeenCalledWith('sidebar.right.tab.guide', expect.anything())
    expect(register).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'sidebar.right.tab.guide' }), expect.anything())
    for (const dispose of effects.toReversed()) dispose()
  })
})
