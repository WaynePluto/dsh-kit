// @vitest-environment jsdom
/**
 * hooks observable 与渲染层绑定语义的回归：
 * dsh 渲染层（`ui-renderer/src/client/bind.ts`）把 inject hooks 的 observable 绑定成
 * `useSyncExternalStoreWithSelector`——它先用 Object.is 比较快照引用，引用不变就不会
 * 重跑 selector。本测试用同一 API 驱动真实 React 渲染，确保 GitReviewData 的每次发布
 * 都能被看见（原地修改 Map 的旧实现会停在本测试的 loading 断言上）。
 */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { useSyncExternalStoreWithSelector } from 'use-sync-external-store/shim/with-selector'
import { describe, expect, it, vi } from 'vitest'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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

import { GitReviewData, type GitReviewSource, type GitSummaryState } from './gitReviewTab.js'

describe('hooks observable × useSyncExternalStoreWithSelector', () => {
  it('状态发布驱动重渲染：loading → summary', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>(resolve => { release = resolve })
    let gated = true
    const data = new GitReviewData(async <T,>(endpoint: 'review' | 'diff'): Promise<T> => {
      if (endpoint === 'review' && gated) await gate
      return (endpoint === 'review'
        ? { available: true, files: [{ path: 'a.ts', status: 'modified', added: 1, deleted: 0 }], truncated: false }
        : { kind: 'text', path: 'a.ts', before: true, after: true, hunks: [] }) as T
    })
    const seen: Array<GitSummaryState | undefined> = []

    function Probe({ source }: { source: GitReviewSource<GitSummaryState> }): null {
      const value = useSyncExternalStoreWithSelector(
        listener => source.subscribe(listener),
        () => source.getSnapshot(),
        undefined,
        snapshot => snapshot.get('s1'),
      )
      seen.push(value)
      return null
    }

    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => { root.render(<Probe source={data.summarySource} />) })
      expect(seen.at(-1)).toBeUndefined()
      // 第一次 review 请求被 gate 挡住：组件应停留在并显示 loading 发布。
      await act(async () => { void data.loadSummary('s1') })
      expect(seen.at(-1)).toBe('loading')
      await act(async () => {
        gated = false
        release()
        await new Promise(resolve => { setTimeout(resolve, 0) })
      })
      expect(seen.at(-1)).toMatchObject({ available: true })
    } finally {
      await act(async () => { root.unmount() })
      container.remove()
    }
  })
})
