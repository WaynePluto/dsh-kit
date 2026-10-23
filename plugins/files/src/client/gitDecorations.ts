import type { FilesSnapshot, GitStatus } from '../shared.js'
import { gitStatusMarker, statusForPath } from '../shared.js'
import type { Translate } from './locales.js'
import { workspaceRelativePath } from './treePath.js'

interface PreviousAttributes {
  readonly ariaLabel: string | null
  readonly title: string | null
}

const previous = new WeakMap<HTMLButtonElement, PreviousAttributes>()

/**
 * 每个快照的 path → status 装饰结果缓存。树内任何 mutation 都会全量重装饰
 * （幂等操作），未变化的行在此复用结果、跳过对 Git 条目上限（2000 条）的
 * 线性扫描；Git 快照刷新换新引用，缓存随 WeakMap 整体失效。
 */
const statusCache = new WeakMap<FilesSnapshot, Map<string, GitStatus | undefined>>()

function cachedStatusForPath(
  snapshot: FilesSnapshot,
  relative: string,
  directory: boolean,
): GitStatus | undefined {
  let cache = statusCache.get(snapshot)
  if (cache === undefined) {
    cache = new Map()
    statusCache.set(snapshot, cache)
  }
  const key = directory ? `d\u0000${relative}` : `f\u0000${relative}`
  if (cache.has(key)) return cache.get(key)
  const status = statusForPath(relative, directory, snapshot.git.entries)
  cache.set(key, status)
  return status
}

function statusLabel(t: Translate, status: GitStatus): string {
  switch (status) {
    case 'modified': return t('statusModified')
    case 'added': return t('statusAdded')
    case 'deleted': return t('statusDeleted')
    case 'renamed': return t('statusRenamed')
    case 'copied': return t('statusAdded')
    case 'untracked': return t('statusUntracked')
    case 'conflict': return t('statusConflict')
  }
}

function clearButton(button: HTMLButtonElement): void {
  const saved = previous.get(button)
  delete button.dataset.filesGitStatus
  delete button.dataset.filesGitMarker
  if (saved === undefined) return
  if (saved.ariaLabel === null) button.removeAttribute('aria-label')
  else button.setAttribute('aria-label', saved.ariaLabel)
  if (saved.title === null) button.removeAttribute('title')
  else button.setAttribute('title', saved.title)
  previous.delete(button)
}

function decorateButton(button: HTMLButtonElement, status: GitStatus, label: string): void {
  if (!previous.has(button)) {
    previous.set(button, {
      ariaLabel: button.getAttribute('aria-label'),
      title: button.getAttribute('title'),
    })
  }
  const marker = gitStatusMarker(status)
  button.dataset.filesGitStatus = status
  button.dataset.filesGitMarker = marker
  const name = button.textContent?.trim() ?? ''
  button.setAttribute('aria-label', name === '' ? `${marker} ${label}` : `${name}, ${label}`)
  button.title = `${name === '' ? '' : `${name}: `}${label}`
}

/**
 * Project one Git snapshot onto already-rendered native rows. This only writes
 * data/aria attributes; React owns the row and no plugin DOM node is inserted.
 */
export function decorateNativeRows(
  root: ParentNode,
  snapshot: FilesSnapshot | undefined,
  t: Translate,
): void {
  const rows = root.querySelectorAll<HTMLElement>('[data-files-entry][data-files-path]')
  for (const row of rows) {
    const button = row.querySelector<HTMLButtonElement>('button')
    if (button === null) continue
    if (snapshot === undefined) {
      clearButton(button)
      continue
    }
    const absolute = row.dataset.filesPath
    const relative = absolute === undefined
      ? undefined
      : workspaceRelativePath(snapshot.workspacePath, absolute)
    const status = relative === undefined
      ? undefined
      : cachedStatusForPath(snapshot, relative, row.dataset.filesEntry === 'directory')
    if (status === undefined) clearButton(button)
    else decorateButton(button, status, statusLabel(t, status))
  }
}

/** Remove all plugin-owned attributes before an enhancement is unloaded. */
export function clearNativeRows(root: ParentNode): void {
  const buttons = root.querySelectorAll<HTMLButtonElement>('[data-files-entry][data-files-path] button')
  for (const button of buttons) clearButton(button)
}
