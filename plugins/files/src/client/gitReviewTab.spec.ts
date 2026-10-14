import { describe, expect, it, vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: (): null => null,
  IconChevronDownOutlineRegular: (): null => null,
  IconCompareSplitOutlineRegular: (): null => null,
  IconInspectOutlineRegular: (): null => null,
  IconNowrapFillRegular: (): null => null,
  IconWrapFillRegular: (): null => null,
  Menu: (): null => null,
  PathLabel: (): null => null,
  Tooltip: (): null => null,
  languageForPath: (): null => null,
  useCodeHighlighter: (): null => null,
}))

import {
  GitReviewData, MAX_RENDERED_LINES, createGitReviewStore, gitReviewAddress, hunkRows,
  parseGitReviewAddress, renderedHunks, splitRows,
} from './gitReviewTab.js'

describe('git review 地址', () => {
  it('往返编码会话标识并拒绝畸形地址', () => {
    expect(parseGitReviewAddress(gitReviewAddress('session/1 x' as never))?.sessionId).toBe('session/1 x')
    expect(parseGitReviewAddress('dsh-resource://files-git-review/session/')).toBeUndefined()
    expect(parseGitReviewAddress('dsh-resource://files-git-review/session/a/b')).toBeUndefined()
    expect(parseGitReviewAddress('dsh-resource://file/session/a')).toBeUndefined()
  })
})

describe('git review store', () => {
  it('导航播种选择，补造条目在解析与手动选择后保留', () => {
    const instance = createGitReviewStore().create()
    instance.actions.navigated('tab1', 1, 'unchanged.ts')
    expect(instance.getSnapshot().byTab.tab1).toMatchObject({
      pending: 'unchanged.ts', extra: 'unchanged.ts', index: 0, split: true, wrap: false, navigated: 1,
    })
    instance.actions.resolved('tab1', 2)
    expect(instance.getSnapshot().byTab.tab1).toMatchObject({ pending: undefined, extra: 'unchanged.ts', index: 2 })
    instance.actions.selected('tab1', 0)
    expect(instance.getSnapshot().byTab.tab1).toMatchObject({ extra: 'unchanged.ts', index: 0 })
    instance.actions.toggledSplit('tab1')
    instance.actions.toggledWrap('tab1')
    expect(instance.getSnapshot().byTab.tab1).toMatchObject({ split: false, wrap: true })
    instance.actions.forget('tab1')
    expect(instance.getSnapshot().byTab.tab1).toBeUndefined()
  })

  it('无路径导航不清空既有补造条目', () => {
    const instance = createGitReviewStore().create()
    instance.actions.navigated('tab1', 1, 'a.ts')
    instance.actions.navigated('tab1', 2, undefined)
    expect(instance.getSnapshot().byTab.tab1).toMatchObject({ extra: 'a.ts', navigated: 2 })
  })
})

describe('GitReviewData 缓存', () => {
  it('每次发布都换新快照引用（uSES 先按 Object.is 比较快照，原地修改会卡 loading）', async () => {
    const data = new GitReviewData(async <T,>(endpoint: 'review' | 'diff'): Promise<T> =>
      endpoint === 'review'
        ? { available: true, files: [{ path: 'a.ts', status: 'modified', added: 1, deleted: 0 }], truncated: false } as T
        : { kind: 'text', path: 'a.ts', before: true, after: true, hunks: [] } as T)
    const summaryBefore = data.summarySource.getSnapshot()
    await data.loadSummary('s1')
    const summaryLoaded = data.summarySource.getSnapshot()
    expect(summaryLoaded).not.toBe(summaryBefore)
    expect(summaryLoaded.get('s1')).toMatchObject({ available: true })
    const diffBefore = data.diffSource.getSnapshot()
    await data.loadDiff('s1', 'a.ts')
    expect(data.diffSource.getSnapshot()).not.toBe(diffBefore)
    await data.reloadSummary('s1')
    expect(data.summarySource.getSnapshot()).not.toBe(summaryLoaded)
    expect(data.diffSource.getSnapshot().get('["s1","a.ts"]')).toBeUndefined()
    const resetBefore = data.summarySource.getSnapshot()
    data.reset()
    expect(data.summarySource.getSnapshot()).not.toBe(resetBefore)
  })

  it('summary 失败重试、成功缓存；reload 只清本会话 diff；reset 全清', async () => {
    let fail = true
    const calls: string[] = []
    const data = new GitReviewData(async <T,>(endpoint: 'review' | 'diff', payload: Record<string, string>): Promise<T> => {
      calls.push(`${endpoint}:${payload.sessionId ?? ''}:${payload.path ?? ''}`)
      if (endpoint === 'review') {
        if (fail) throw new Error('rpc down')
        return { available: true, files: [{ path: 'a.ts', status: 'modified', added: 1, deleted: 2 }], truncated: false } as T
      }
      return { kind: 'text', path: payload.path ?? '', before: true, after: true, hunks: [] } as T
    })
    await data.loadSummary('s1')
    expect(data.summarySource.getSnapshot().get('s1')).toBe('error')
    fail = false
    await data.loadSummary('s1')
    expect(data.summarySource.getSnapshot().get('s1')).toMatchObject({ available: true })
    const before = calls.length
    await data.loadSummary('s1')
    expect(calls.length).toBe(before)
    await data.loadDiff('s1', 'a.ts')
    await data.loadDiff('s2', 'a.ts')
    expect(data.diffSource.getSnapshot().get('["s1","a.ts"]')).toMatchObject({ kind: 'text' })
    let notified = 0
    const unsubscribe = data.summarySource.subscribe(() => { notified += 1 })
    await data.reloadSummary('s1')
    unsubscribe()
    expect(notified).toBeGreaterThan(0)
    expect(data.diffSource.getSnapshot().get('["s1","a.ts"]')).toBeUndefined()
    expect(data.diffSource.getSnapshot().get('["s2","a.ts"]')).toMatchObject({ kind: 'text' })
    data.reset()
    expect(data.summarySource.getSnapshot().size).toBe(0)
    expect(data.diffSource.getSnapshot().size).toBe(0)
  })

  it('diff 同键成功缓存、失败可重试', async () => {
    let fail = true
    const data = new GitReviewData(async <T,>(endpoint: 'review' | 'diff'): Promise<T> => {
      if (endpoint === 'review') return { available: true, files: [], truncated: false } as T
      if (fail) throw new Error('rpc down')
      return { kind: 'binary', path: 'a.png' } as T
    })
    await data.loadDiff('s1', 'a.png')
    expect(data.diffSource.getSnapshot().get('["s1","a.png"]')).toBe('error')
    fail = false
    await data.loadDiff('s1', 'a.png')
    expect(data.diffSource.getSnapshot().get('["s1","a.png"]')).toEqual({ kind: 'binary', path: 'a.png' })
  })
})

describe('diff 纯函数', () => {
  const hunk = { oldStart: 1, oldLines: 2, newStart: 1, newLines: 3, lines: [' ctx', '-del', '+a', '+b'] }

  it('hunkRows 按前缀编号增删与上下文', () => {
    expect(hunkRows(hunk)).toEqual([
      { kind: 'context', old: 1, new: 1, text: 'ctx' },
      { kind: 'del', old: 2, new: undefined, text: 'del' },
      { kind: 'add', old: undefined, new: 2, text: 'a' },
      { kind: 'add', old: undefined, new: 3, text: 'b' },
    ])
  })

  it('splitRows 把删除段与后续新增段逐行对齐', () => {
    expect(splitRows(hunk)).toEqual([
      { left: { no: 1, text: 'ctx', kind: 'context' }, right: { no: 1, text: 'ctx', kind: 'context' } },
      { left: { no: 2, text: 'del', kind: 'del' }, right: { no: 2, text: 'a', kind: 'add' } },
      { right: { no: 3, text: 'b', kind: 'add' } },
    ])
  })

  it('renderedHunks 在渲染上限处截断并标记', () => {
    const large = { oldStart: 1, oldLines: MAX_RENDERED_LINES + 1, newStart: 1, newLines: 1, lines: ['-x'.repeat(2)] }
    const filled = { ...large, lines: Array.from({ length: MAX_RENDERED_LINES + 1 }, () => '-x') }
    expect(renderedHunks([filled])).toEqual({ hunks: [{ ...filled, lines: filled.lines.slice(0, MAX_RENDERED_LINES) }], truncated: true })
    expect(renderedHunks([hunk]).truncated).toBe(false)
  })
})
