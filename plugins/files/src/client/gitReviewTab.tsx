/**
 * Git review 页签（浏览器半）。
 *
 * 复刻 dsh 原生 ui-deliverables 的 changes-review 面板结构（dsh 0.2.0-rc.2 的
 * ReviewTab/FileDiff）：文件选择器 Menu + 增删计数 + 左右对比/自动换行切换 +
 * 打开文件 + 带行号与语法高亮的 diff 正文；组件与样式在插件内实现，复用
 * dsh 公开 primitives 与 dsw token。内容口径是工作区对 HEAD 的 Git 变更：
 * 右键菜单携带 `params.path` 预选文件；目标不在变更列表时补造「无改动」条目。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode, UIEvent } from 'react'
import {
  Button, IconChevronDownOutlineRegular, IconCompareSplitOutlineRegular, IconInspectOutlineRegular,
  IconNowrapFillRegular, IconWrapFillRegular, Menu, PathLabel, Tooltip, languageForPath, useCodeHighlighter,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { CodeHighlighter, HighlightSpan } from '@deepseek-ai/dsh-client-ui-primitives'
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { SidebarRightTabDefinition, TabId } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { fileAddressFor } from '@deepseek-ai/dsh-util-workspace-path'
import {
  isGitFileDiff, isGitReviewSummary,
  type GitDiffHunk, type GitFileDiff, type GitReviewFile, type GitReviewSummary,
} from '../shared.js'
import type { Translate } from './locales.js'

/** The tab kind this plugin owns. */
export const GIT_REVIEW_KIND = 'files-git-review'
/** This implementation's identity in the tab system, and the key its body registers under. */
export const GIT_REVIEW_TAB_ID = '@dsh-kit/dsh-plugin-files/git-review'
/** Resource-address prefix of a session's Git review tab. */
export const GIT_REVIEW_ADDRESS = 'dsh-resource://files-git-review/session/'

/** The file a review opens on. */
export interface GitReviewParams {
  readonly path?: string
}

declare module '@deepseek-ai/dsh-client-ui-sidebar-right/client' {
  interface SidebarRightResourceParamsMap {
    /** The file a Git review tab opens on. */
    'files-git-review': GitReviewParams
  }
}

/** 一个会话的 Git review 地址；同会话复用同一页签（原生按 (kind, contentId) 去重）。 */
export function gitReviewAddress(sessionId: SessionId): string {
  return `${GIT_REVIEW_ADDRESS}${encodeURIComponent(sessionId)}`
}

/** 读回 review 地址的会话标识；其它地址返回 undefined。 */
export function parseGitReviewAddress(address: string): { sessionId: string } | undefined {
  if (!address.startsWith(GIT_REVIEW_ADDRESS)) return undefined
  const encoded = address.slice(GIT_REVIEW_ADDRESS.length)
  if (encoded === '' || encoded.includes('/')) return undefined
  try {
    return { sessionId: decodeURIComponent(encoded) }
  } catch {
    return undefined
  }
}

/** review 页签类型的注册定义；标题是稳定文案（不随地址变化）。 */
export function gitReviewTabDefinition(t: Translate): SidebarRightTabDefinition {
  return {
    id: GIT_REVIEW_TAB_ID,
    kind: GIT_REVIEW_KIND,
    patterns: ['dsh-resource://files-git-review/**'],
    priority: 'extension',
    canOpen: address => parseGitReviewAddress(address) !== undefined,
    title: () => t('gitReviewTitle'),
  }
}

/** summary 读状态：一次成功的结果会保留到下次 reload；错误可重试。 */
export type GitSummaryState = GitReviewSummary | 'loading' | 'error'
/** 单文件 diff 读状态。 */
export type GitDiffState = GitFileDiff | 'loading' | 'error'

/** inject hooks 需要的最小 observable 形状（getSnapshot + subscribe）。 */
export interface GitReviewSource<T> {
  getSnapshot(): ReadonlyMap<string, T>
  subscribe(listener: () => void): () => void
}

/** 右键目标不在变更列表时浏览器半补造的「无改动」条目。 */
function unmodifiedEntry(path: string): GitReviewFile {
  return { path, status: 'unmodified', added: 0, deleted: 0 }
}

/**
 * 插件私有的 review/diff RPC 缓存：summary 按会话缓存，diff 按 (会话, 路径) 缓存；
 * reload 清空该会话缓存以取新数据。连接重置时整体清空。
 *
 * 快照必须不可变：渲染层把 hooks observable 绑定成
 * `useSyncExternalStoreWithSelector`（`ui-renderer/src/client/bind.ts`），它先用
 * Object.is 比较快照引用，引用不变就不会重跑 selector——原地修改 Map 会让面板
 * 永远停在 loading（2026-10-14 实机定位）。因此每次发布都换新 Map。
 */
export class GitReviewData {
  private summaries: ReadonlyMap<string, GitSummaryState> = new Map()
  private diffs: ReadonlyMap<string, GitDiffState> = new Map()
  private readonly summaryListeners = new Set<() => void>()
  private readonly diffListeners = new Set<() => void>()
  readonly summarySource: GitReviewSource<GitSummaryState> = {
    getSnapshot: () => this.summaries,
    subscribe: listener => {
      this.summaryListeners.add(listener)
      return () => { this.summaryListeners.delete(listener) }
    },
  }
  readonly diffSource: GitReviewSource<GitDiffState> = {
    getSnapshot: () => this.diffs,
    subscribe: listener => {
      this.diffListeners.add(listener)
      return () => { this.diffListeners.delete(listener) }
    },
  }

  constructor(
    private readonly call: <T>(endpoint: 'review' | 'diff', payload: Record<string, string>) => Promise<T>,
  ) {}

  /**
   * 连接重置：全部缓存作废。
   */
  reset(): void {
    this.summaries = new Map()
    this.diffs = new Map()
    this.notifySummary()
    this.notifyDiff()
  }

  /** 以新 Map 引用发布一条 summary 状态。 */
  private publishSummary(sessionId: string, state: GitSummaryState): void {
    this.summaries = new Map(this.summaries).set(sessionId, state)
    this.notifySummary()
  }

  /** 以新 Map 引用发布一条 diff 状态。 */
  private publishDiff(key: string, state: GitDiffState): void {
    this.diffs = new Map(this.diffs).set(key, state)
    this.notifyDiff()
  }

  /** 读一次 summary；成功或 loading 状态不重复发请求，错误态可重试。 */
  async loadSummary(sessionId: string): Promise<void> {
    const current = this.summaries.get(sessionId)
    if (current !== undefined && current !== 'error') return
    this.publishSummary(sessionId, 'loading')
    try {
      const value: unknown = await this.call('review', { sessionId })
      this.publishSummary(sessionId, isGitReviewSummary(value) ? value : 'error')
    } catch {
      this.publishSummary(sessionId, 'error')
    }
  }

  /** 清空该会话缓存并重新读取（右键导航、刷新命令）。 */
  async reloadSummary(sessionId: string): Promise<void> {
    if (this.summaries.has(sessionId)) {
      const nextSummaries = new Map(this.summaries)
      nextSummaries.delete(sessionId)
      this.summaries = nextSummaries
    }
    const nextDiffs = new Map<string, GitDiffState>()
    let dropped = false
    for (const [key, value] of this.diffs) {
      if (diffKeySession(key) === sessionId) dropped = true
      else nextDiffs.set(key, value)
    }
    if (dropped) this.diffs = nextDiffs
    await this.loadSummary(sessionId)
  }

  /** 读一次单文件 diff；同键成功结果保留，错误态可重试。 */
  async loadDiff(sessionId: string, path: string): Promise<void> {
    const key = diffKey(sessionId, path)
    const current = this.diffs.get(key)
    if (current !== undefined && current !== 'error') return
    this.publishDiff(key, 'loading')
    try {
      const value: unknown = await this.call('diff', { sessionId, path })
      this.publishDiff(key, isGitFileDiff(value) ? value : 'error')
    } catch {
      this.publishDiff(key, 'error')
    }
  }

  private notifySummary(): void {
    for (const listener of this.summaryListeners) listener()
  }

  private notifyDiff(): void {
    for (const listener of this.diffListeners) listener()
  }
}

function diffKey(sessionId: string, path: string): string {
  return JSON.stringify([sessionId, path])
}

/** 读回 diff 缓存键的会话标识；非本类生成的键返回 undefined。 */
function diffKeySession(key: string): string | undefined {
  try {
    const session = (JSON.parse(key) as readonly unknown[])[0]
    return typeof session === 'string' ? session : undefined
  } catch {
    return undefined
  }
}

/** review 页签的视图状态：待定位路径、当前文件、布局选择，按页签隔离。 */
export interface GitReviewTabState {
  /** 导航携带的右键路径；summary 到达后解析为 index 并清除。 */
  pending: string | undefined
  /** 已物化的补造路径（右键目标不在变更列表时），页签存续期间保留，避免选中跳变。 */
  extra: string | undefined
  index: number
  split: boolean
  wrap: boolean
  navigated: number
}

export interface GitReviewState {
  byTab: Record<TabId, GitReviewTabState>
}

function bucket(state: GitReviewState, tabId: TabId): GitReviewTabState {
  const tab = state.byTab[tabId]
  if (tab === undefined) throw new Error(`dsh-plugin-files: no git review state for tab "${tabId}"`)
  return tab
}

type GitReviewActions = {
  navigated: (draft: GitReviewState, tabId: TabId, revision: number, pending: string | undefined) => void
  resolved: (draft: GitReviewState, tabId: TabId, index: number) => void
  selected: (draft: GitReviewState, tabId: TabId, index: number) => void
  toggledSplit: (draft: GitReviewState, tabId: TabId) => void
  toggledWrap: (draft: GitReviewState, tabId: TabId) => void
  forget: (draft: GitReviewState, tabId: TabId) => void
}

/** 声明为独占 store：框架按会话铸造实例，状态随页签记录清理。 */
export function createGitReviewStore(): EngineStoreHandle<GitReviewState, GitReviewActions> {
  return defineStore({
    init: (): GitReviewState => ({ byTab: {} }),
    actions: {
      navigated: (draft, tabId: TabId, revision: number, pending: string | undefined) => {
        const tab = draft.byTab[tabId]
        if (tab === undefined) {
          draft.byTab[tabId] = { pending, extra: pending, index: 0, split: true, wrap: false, navigated: revision }
          return
        }
        tab.navigated = revision
        if (pending !== undefined) {
          tab.pending = pending
          tab.extra = pending
        }
      },
      resolved: (draft, tabId: TabId, index: number) => {
        const tab = draft.byTab[tabId]
        if (tab === undefined) return
        tab.pending = undefined
        tab.index = index
      },
      selected: (draft, tabId: TabId, index: number) => {
        const tab = bucket(draft, tabId)
        tab.pending = undefined
        tab.index = index
      },
      toggledSplit: (draft, tabId: TabId) => {
        const tab = bucket(draft, tabId)
        tab.split = !tab.split
      },
      toggledWrap: (draft, tabId: TabId) => {
        const tab = bucket(draft, tabId)
        tab.wrap = !tab.wrap
      },
      forget: (draft, tabId: TabId) => {
        draft.byTab = Object.fromEntries(Object.entries(draft.byTab).filter(([id]) => id !== tabId))
      },
    },
  })
}

/** 页签正文收到的注入面：数据 observable 与读取动作。 */
export interface GitReviewInjected {
  hooks: {
    summary: GitReviewSource<GitSummaryState>
    diff: GitReviewSource<GitDiffState>
  }
  reloadSummary: (sessionId: string) => Promise<void>
  loadDiff: (sessionId: string, path: string) => Promise<void>
}

export type GitReviewTabProps = PropsRuntime<'sidebar.right.pane.tab'> & PropsStore<ReturnType<typeof createGitReviewStore>>
  & InjectFace<GitReviewInjected> & PropsLocale<'dsh-plugin-files'>

const GROUPED = new Intl.NumberFormat('en-US')

/** Added and deleted line counts in the panel's colors. */
function Counts({ file, t }: { file: GitReviewFile } & PropsLocale<'dsh-plugin-files'>): ReactNode {
  if (file.status === 'unmodified') return <span className="dsh-files-gr-label">{t('gitReviewUnchangedLabel')}</span>
  if (file.binary === true) return <span className="dsh-files-gr-label">{t('gitReviewBinaryLabel')}</span>
  if (file.oversized === true) return <span className="dsh-files-gr-label">{t('gitReviewOversizedLabel')}</span>
  return <>
    <span className="dsh-files-gr-added">{t('gitReviewAdded', { count: GROUPED.format(file.added) })}</span>
    <span className="dsh-files-gr-deleted">{t('gitReviewDeletedCount', { count: GROUPED.format(file.deleted) })}</span>
  </>
}

/** 导航参数里的路径，当它是一个非空字符串。 */
function navigatedPath(params: unknown): string | undefined {
  const path = (params as GitReviewParams | undefined)?.path
  return typeof path === 'string' && path !== '' ? path : undefined
}

/**
 * The Git review tab body.
 * @param props - composed slot props.
 * @returns 文件选择器 + 工具栏 + 所选文件对 HEAD 的比较，或其加载/降级状态。
 */
export function GitReviewTab({
  useTabInfo, sessionId, useSessions, useStore, actions, useSummary, useDiff,
  reloadSummary, loadDiff, t,
}: GitReviewTabProps): ReactNode {
  const { tab } = useTabInfo()
  const { navigation, signal } = tab
  if (parseGitReviewAddress(tab.contentId) === undefined) {
    throw new Error(`dsh-plugin-files: not a git review address "${tab.contentId}"`)
  }
  const summaryState = useSummary(source => source.get(String(sessionId)))
  const state = useStore(store => store.byTab[tab.id])
  const cwd = useSessions(sessions => sessions.byId[sessionId]?.cwd)
  // 每次导航应用一次右键路径；首次导航播种布局选择（split 默认开）。
  useEffect(() => {
    if (state?.navigated === navigation.revision) return
    actions.navigated(tab.id, navigation.revision, navigatedPath(navigation.params))
  }, [state, navigation.revision, navigation.params, actions, tab.id])
  useEffect(() => {
    const forget = (): void => { actions.forget(tab.id) }
    signal.addEventListener('abort', forget, { once: true })
    return () => { signal.removeEventListener('abort', forget) }
  }, [signal, actions, tab.id])
  // 导航即刷新：右键一次取一次新 summary；页签首次挂载也在此覆盖。
  useEffect(() => {
    void reloadSummary(String(sessionId))
  }, [navigation.revision, sessionId, reloadSummary])
  const summary = typeof summaryState === 'object' ? summaryState : undefined
  const files = useMemo(() => {
    if (summary === undefined) return []
    const list = [...summary.files]
    const focus = state?.pending ?? state?.extra
    if (focus !== undefined && !list.some(file => file.path === focus)) list.push(unmodifiedEntry(focus))
    return list
  }, [summary, state?.pending, state?.extra])
  // summary 到达后把右键路径解析为 index（补造条目已由 files 计算并入）。
  useEffect(() => {
    const pending = state?.pending
    if (pending === undefined || summary === undefined) return
    const index = files.findIndex(file => file.path === pending)
    actions.resolved(tab.id, index >= 0 ? index : 0)
  }, [state, summary, files, actions, tab.id])
  // A navigated index the summary does not list falls back to the first file.
  const index = state !== undefined && files[state.index] !== undefined ? state.index : 0
  const file = files[index]
  const key = file === undefined ? undefined : diffKey(String(sessionId), file.path)
  const diffState = useDiff(source => (key === undefined ? undefined : source.get(key)))
  useEffect(() => {
    if (file !== undefined && diffState === undefined) void loadDiff(String(sessionId), file.path)
  }, [file, diffState, sessionId, loadDiff])
  // 把刷新命令绑给页签：Sidebar 的刷新入口重新拉取当前会话的 summary。
  useEffect(() => {
    const dispose = tab.actions.bindCommands({ refresh: () => { void reloadSummary(String(sessionId)) } })
    return () => { dispose() }
  }, [tab.actions, sessionId, reloadSummary])
  const [menuOpen, setMenuOpen] = useState(false)
  const split = state?.split === true
  const wrap = state?.wrap === true
  const phase = summaryState === undefined || summaryState === 'loading' ? 'loading'
    : summaryState === 'error' ? 'error'
      : !summaryState.available ? 'unavailable'
        : summaryState.files.length === 0 ? 'empty'
          : 'ready'
  return (
    <div className="dsh-files-gr" data-files-git-review data-dsh-files-gr-phase={phase}>
      <div className="dsh-files-gr-header">
        {file === undefined
          ? <span className="dsh-files-gr-selector-label">{t('gitReviewTitle')}</span>
          : <Menu className="dsh-files-gr-selector" open={menuOpen} autoFocus portal align="start" dense
            onClose={() => { setMenuOpen(false) }}
            anchor={<button type="button" className="dsh-files-gr-selector-button" aria-haspopup="menu" aria-expanded={menuOpen}
              aria-label={t('gitReviewSelectFile')} title={file.path} data-dsh-files-gr-file={file.path}
              onClick={() => { setMenuOpen(value => !value) }}>
              <PathLabel path={file.path} />
              <IconChevronDownOutlineRegular size={12} />
            </button>}
            items={files.map((entry, at) => ({ id: String(at), label: <span className="dsh-files-gr-item">
              <span className="dsh-files-gr-item-path">{entry.path}</span>
              <span className="dsh-files-gr-item-counts"><Counts file={entry} t={t} /></span>
            </span> }))}
            selectedId={String(index)}
            onSelect={id => {
              actions.selected(tab.id, Number(id))
              setMenuOpen(false)
            }} />}
        {file !== undefined && <span className="dsh-files-gr-counts"><Counts file={file} t={t} /></span>}
        <span className="dsh-files-gr-tools">
          <Tooltip label={t(split ? 'gitReviewUnified' : 'gitReviewSplit')} side="bottom" delayMs={500}>
            <button type="button" className="dsh-files-gr-tool" aria-pressed={split} aria-label={t('gitReviewSplitAria')}
              data-dsh-files-gr-tool="split" onClick={() => { actions.toggledSplit(tab.id) }}>
              <IconCompareSplitOutlineRegular className="dsh-files-gr-compare-icon" />
            </button>
          </Tooltip>
          <Tooltip label={t(wrap ? 'gitReviewNowrap' : 'gitReviewWrap')} side="bottom" delayMs={500}>
            <button type="button" className="dsh-files-gr-tool" aria-pressed={wrap} aria-label={t('gitReviewWrapAria')}
              data-dsh-files-gr-tool="wrap" onClick={() => { actions.toggledWrap(tab.id) }}>
              {wrap ? <IconNowrapFillRegular /> : <IconWrapFillRegular />}
            </button>
          </Tooltip>
          {file !== undefined && <Tooltip label={t('gitReviewOpenFile')} side="bottom" delayMs={500}>
            <button type="button" className="dsh-files-gr-tool" aria-label={t('gitReviewOpenFileAria', { name: file.path })}
              data-dsh-files-gr-tool="open-file"
              onClick={() => { tab.actions.openResource(fileAddressFor(sessionId, cwd, file.path)) }}>
              <IconInspectOutlineRegular />
            </button>
          </Tooltip>}
        </span>
      </div>
      {phase === 'loading' && <p className="dsh-files-gr-status" role="status">{t('gitReviewLoading')}</p>}
      {phase === 'error' && <div className="dsh-files-gr-status">
        <span>{t('gitReviewError')}</span>
        <Button className="dsh-files-gr-retry" size="sm" onClick={() => { void reloadSummary(String(sessionId)) }}>{t('gitReviewRetry')}</Button>
      </div>}
      {phase === 'unavailable' && <p className="dsh-files-gr-status">{t('gitUnavailable')}</p>}
      {phase === 'empty' && <p className="dsh-files-gr-status">{t('gitReviewEmpty')}</p>}
      {phase === 'ready' && summary?.truncated === true && <p className="dsh-files-gr-note">{t('gitReviewTruncatedList')}</p>}
      {file !== undefined && phase !== 'unavailable' && (
        <GitFileDiffView state={diffState} path={file.path} split={split} wrap={wrap} t={t}
          retry={() => { void loadDiff(String(sessionId), file.path) }} />
      )}
    </div>
  )
}

/** Maximum rendered lines per comparison（对齐原生 FileDiff）。 */
export const MAX_RENDERED_LINES = 5000

/** One drawn line of a hunk with its line numbers on each side. */
export interface DiffRow {
  kind: 'add' | 'del' | 'context'
  old: number | undefined
  new: number | undefined
  text: string
}

/** One side-by-side row: the old side, the new side, or both. */
export interface SplitRow {
  left?: { no: number; text: string; kind: 'del' | 'context' }
  right?: { no: number; text: string; kind: 'add' | 'context' }
}

interface HunkHighlights {
  old: ReadonlyMap<number, readonly HighlightSpan[]> | undefined
  new: ReadonlyMap<number, readonly HighlightSpan[]> | undefined
}

function highlightedSide(rows: readonly DiffRow[], side: 'old' | 'new', highlighter: CodeHighlighter): HunkHighlights['old'] {
  const source = rows.flatMap((row) => {
    const no = row[side]
    return no === undefined ? [] : [{ no, text: row.text }]
  })
  if (source.length === 0) return new Map()
  const highlighted = highlighter(source.map(line => line.text).join('\n'))
  if (highlighted === undefined) return undefined
  return new Map(source.map((line, index) => [line.no, highlighted[index] ?? []]))
}

function hunkHighlights(hunk: GitDiffHunk, highlighter: CodeHighlighter): HunkHighlights {
  const rows = hunkRows(hunk)
  return { old: highlightedSide(rows, 'old', highlighter), new: highlightedSide(rows, 'new', highlighter) }
}

function DiffText({ text, spans }: { text: string; spans: readonly HighlightSpan[] | undefined }): ReactNode {
  return <span className="dsh-files-gr-text" data-dsh-files-gr-code={spans === undefined ? undefined : ''}>
    {spans === undefined ? text : spans.map((span, index) => <span key={index} style={span.style}>{span.text}</span>)}
  </span>
}

/**
 * Number a hunk's lines: context lines count on both sides, deletions on the
 * old side, additions on the new side.
 */
export function hunkRows(hunk: GitDiffHunk): DiffRow[] {
  let oldNo = hunk.oldStart
  let newNo = hunk.newStart
  return hunk.lines.map((line) => {
    const text = line.slice(1)
    switch (line[0]) {
      case '+': return { kind: 'add', old: undefined, new: newNo++, text }
      case '-': return { kind: 'del', old: oldNo++, new: undefined, text }
      default: return { kind: 'context', old: oldNo++, new: newNo++, text }
    }
  })
}

/**
 * Pair a hunk's lines for the side-by-side view: each run of deletions is
 * aligned with the run of additions that follows it, row by row.
 */
export function splitRows(hunk: GitDiffHunk): SplitRow[] {
  const rows: SplitRow[] = []
  let dels: NonNullable<SplitRow['left']>[] = []
  let adds: NonNullable<SplitRow['right']>[] = []
  const flush = (): void => {
    for (let at = 0; at < Math.max(dels.length, adds.length); at += 1) {
      const left = dels[at]
      const right = adds[at]
      rows.push({ ...left === undefined ? {} : { left }, ...right === undefined ? {} : { right } })
    }
    dels = []
    adds = []
  }
  for (const row of hunkRows(hunk)) {
    if (row.kind === 'del') dels.push({ no: row.old as number, text: row.text, kind: 'del' })
    else if (row.kind === 'add') adds.push({ no: row.new as number, text: row.text, kind: 'add' })
    else {
      flush()
      rows.push({ left: { no: row.old as number, text: row.text, kind: 'context' }, right: { no: row.new as number, text: row.text, kind: 'context' } })
    }
  }
  flush()
  return rows
}

/**
 * The hunks to draw, cut at {@link MAX_RENDERED_LINES} lines in total.
 */
export function renderedHunks(hunks: readonly GitDiffHunk[]): { hunks: GitDiffHunk[]; truncated: boolean } {
  let budget = MAX_RENDERED_LINES
  const kept: GitDiffHunk[] = []
  for (const hunk of hunks) {
    if (budget === 0) return { hunks: kept, truncated: true }
    kept.push(hunk.lines.length <= budget ? hunk : { ...hunk, lines: hunk.lines.slice(0, budget) })
    budget -= Math.min(budget, hunk.lines.length)
  }
  return { hunks: kept, truncated: hunks.some((hunk, at) => kept[at] !== hunk) }
}

/** The one-line fact about a text comparison worth stating above its hunks, if any. */
function noteOf(diff: Extract<GitFileDiff, { kind: 'text' }>): 'gitReviewCreated' | 'gitReviewDeleted' | 'gitReviewUnchanged' | undefined {
  if (!diff.before) return 'gitReviewCreated'
  if (!diff.after) return 'gitReviewDeleted'
  if (diff.hunks.length === 0) return 'gitReviewUnchanged'
  return undefined
}

/**
 * Render a file comparison with the same states and highlighting as the native
 * review panel. Addition-only and deletion-only comparisons use one column
 * without changing the requested layout.
 */
export function GitFileDiffView({ state, path, split, wrap, retry, t }: {
  state: GitDiffState | undefined
  path: string
  split: boolean
  wrap: boolean
  retry: () => void
} & PropsLocale<'dsh-plugin-files'>): ReactNode {
  if (state === undefined || state === 'loading') return <p className="dsh-files-gr-status" role="status">{t('gitReviewLoading')}</p>
  if (state === 'error') {
    return <div className="dsh-files-gr-status">
      <span>{t('gitReviewError')}</span>
      <Button className="dsh-files-gr-retry" size="sm" onClick={retry}>{t('gitReviewRetry')}</Button>
    </div>
  }
  if (state.kind === 'binary') return <p className="dsh-files-gr-status">{t('gitReviewBinary')}</p>
  if (state.kind === 'oversized') return <p className="dsh-files-gr-status">{t('gitReviewOversized')}</p>
  const hasAdditions = state.hunks.some(hunk => hunk.lines.some(line => line.startsWith('+')))
  const hasDeletions = state.hunks.some(hunk => hunk.lines.some(line => line.startsWith('-')))
  const oneSided = hasAdditions !== hasDeletions
  return <TextDiff diff={{ ...state, path }} split={split && !oneSided} wrap={wrap} t={t} />
}

/** The kind a paired row carries: a deletion or addition on either side, otherwise context. */
function splitRowKind(row: SplitRow): DiffRow['kind'] {
  return row.left?.kind === 'del' ? 'del' : row.right?.kind === 'add' ? 'add' : 'context'
}

function hunkHeader(hunk: GitDiffHunk): string {
  return `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`
}

/**
 * The side-by-side view without wrapping: two columns that clip their long
 * lines and scroll together on both axes（复刻原生 SplitColumns）。
 */
function SplitColumns({ hunks, highlights }: { hunks: readonly GitDiffHunk[]; highlights: readonly HunkHighlights[] }): ReactNode {
  const paired = useMemo(() => hunks.map(hunk => ({ header: hunkHeader(hunk), rows: splitRows(hunk) })), [hunks])
  const columns = useRef<Record<'left' | 'right', HTMLDivElement | null>>({ left: null, right: null })
  const offsets = useRef({ left: { scrollLeft: 0, scrollTop: 0 }, right: { scrollLeft: 0, scrollTop: 0 } })
  const follow = (side: 'left' | 'right') => (event: UIEvent<HTMLDivElement>): void => {
    const peer = side === 'left' ? 'right' : 'left'
    const other = columns.current[peer]
    if (other === null) return
    for (const axis of ['scrollLeft', 'scrollTop'] as const) {
      const value = event.currentTarget[axis]
      if (offsets.current[side][axis] === value) continue
      offsets.current[side][axis] = value
      other[axis] = value
      offsets.current[peer][axis] = other[axis]
    }
  }
  return (
    <div className="dsh-files-gr-columns">
      {(['left', 'right'] as const).map(side => (
        <div key={side} className="dsh-files-gr-column" data-dsh-files-gr-side={side}
          ref={(element) => { columns.current[side] = element }} onScroll={follow(side)}>
          {paired.map((hunk, position) => (
            <section key={position} className="dsh-files-gr-hunk">
              <div className="dsh-files-gr-hunk-header" data-dsh-files-gr-hunk-header>{hunk.header}</div>
              {hunk.rows.map((row, at) => {
                const cell = row[side]
                const spans = cell === undefined ? undefined : highlights[position]?.[side === 'left' ? 'old' : 'new']?.get(cell.no)
                return (
                  <div key={at}
                    className={`dsh-files-gr-side-line ${cell === undefined ? 'dsh-files-gr-empty' : `dsh-files-gr-${cell.kind}`}`}
                    data-dsh-files-gr-line={splitRowKind(row)}>
                    <span className="dsh-files-gr-number">{cell?.no ?? ''}</span>
                    <DiffText text={cell?.text ?? ''} spans={spans} />
                  </div>
                )
              })}
            </section>
          ))}
        </div>
      ))}
    </div>
  )
}

/** The hunks of a text comparison with their line numbers, unified or side by side. */
function TextDiff({ diff, split, wrap, t }: {
  diff: Extract<GitFileDiff, { kind: 'text' }> & { path: string }
  split: boolean
  wrap: boolean
} & PropsLocale<'dsh-plugin-files'>): ReactNode {
  const note = noteOf(diff)
  const { hunks, truncated } = useMemo(() => renderedHunks(diff.hunks), [diff.hunks])
  const highlighter = useCodeHighlighter(languageForPath(diff.path))
  const highlights = useMemo(() => hunks.map(hunk => hunkHighlights(hunk, highlighter)), [hunks, highlighter])
  return (
    <div className="dsh-files-gr-body"
      data-dsh-files-gr-view={split ? 'split' : 'unified'} data-dsh-files-gr-wrap={wrap || undefined}>
      {note !== undefined && <p className="dsh-files-gr-note" data-dsh-files-gr-note={hunks.length === 0 ? 'empty' : 'metadata'}>{t(note)}</p>}
      {truncated && <p className="dsh-files-gr-note" data-dsh-files-gr-truncated>{t('gitReviewTruncated', { count: String(MAX_RENDERED_LINES) })}</p>}
      {split && !wrap ? <SplitColumns hunks={hunks} highlights={highlights} /> : hunks.map((hunk, position) => {
        const highlighted = highlights[position]
        return <section key={position} className="dsh-files-gr-hunk">
          <div className="dsh-files-gr-hunk-header" data-dsh-files-gr-hunk-header>{hunkHeader(hunk)}</div>
          {split ? splitRows(hunk).map((row, at) => (
            <div key={at} className="dsh-files-gr-split-line" data-dsh-files-gr-line={splitRowKind(row)}>
              <span className={`dsh-files-gr-cell ${row.left === undefined ? 'dsh-files-gr-empty' : `dsh-files-gr-${row.left.kind}`}`}>
                <span className="dsh-files-gr-number">{row.left?.no ?? ''}</span>
                <DiffText text={row.left?.text ?? ''} spans={row.left === undefined ? undefined : highlighted?.old?.get(row.left.no)} />
              </span>
              <span className={`dsh-files-gr-cell ${row.right === undefined ? 'dsh-files-gr-empty' : `dsh-files-gr-${row.right.kind}`}`}>
                <span className="dsh-files-gr-number">{row.right?.no ?? ''}</span>
                <DiffText text={row.right?.text ?? ''} spans={row.right === undefined ? undefined : highlighted?.new?.get(row.right.no)} />
              </span>
            </div>
          )) : hunkRows(hunk).map((row, at) => (
            <div key={at} className={`dsh-files-gr-line dsh-files-gr-${row.kind}`} data-dsh-files-gr-line={row.kind}>
              <span className="dsh-files-gr-number">{row.old ?? ''}</span>
              <span className="dsh-files-gr-number">{row.new ?? ''}</span>
              <span className="dsh-files-gr-sign">{row.kind === 'add' ? '+' : row.kind === 'del' ? '-' : ' '}</span>
              <DiffText text={row.text} spans={row.kind === 'add' ? highlighted?.new?.get(row.new as number) : highlighted?.old?.get(row.old as number)} />
            </div>
          ))}
        </section>
      })}
    </div>
  )
}
