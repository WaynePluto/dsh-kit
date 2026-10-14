/** files 插件两半共享的 Git 快照合同与有界纯函数。 */
export const CHANNEL = '/files'
export const ENDPOINTS = ['snapshot', 'review', 'diff'] as const
export type FilesEndpoint = typeof ENDPOINTS[number]
export const GIT_MAX_ENTRIES = 2000
export const GIT_TIMEOUT_MS = 3000
export const GIT_MAX_OUTPUT_BYTES = 1024 * 1024
export const SESSION_ID_MAX_LENGTH = 256
export const WORKSPACE_PATH_MAX_LENGTH = 4096
export const WORKSPACE_PATH_MAX_SEGMENTS = 128
export const WORKSPACE_PATH_MAX_SEGMENT_LENGTH = 255
export const UNKNOWN_ENDPOINT_CODE = 'files/unknown-endpoint'
export const BAD_PAYLOAD_CODE = 'files/bad-payload'
export const SESSION_NOT_FOUND_CODE = 'files/session-not-found'
export const IO_CODE = 'files/io-failed'

export type GitStatus = 'conflict' | 'deleted' | 'renamed' | 'copied' | 'added' | 'untracked' | 'modified'
export interface GitStatusEntry { readonly path: string; readonly status: GitStatus }
export interface GitSnapshot {
  readonly available: boolean
  readonly entries: readonly GitStatusEntry[]
  readonly truncated: boolean
}
export interface FilesSnapshot {
  /** The exact Session cwd used to resolve the Git projection. */
  readonly workspacePath: string
  readonly git: GitSnapshot
}

/** Git review 面板的文件清单条目；`unmodified` 只由浏览器半在右键目标不在变更列表时补造。 */
export interface GitReviewFile {
  readonly path: string
  readonly status: GitStatus | 'unmodified'
  /** Lines added; zero for a binary or oversized file. */
  readonly added: number
  /** Lines deleted; zero for a binary or oversized file. */
  readonly deleted: number
  readonly binary?: true
  readonly oversized?: true
}

/** 一个会话工作区对 HEAD 的 Git 变更清单（已暂存 + 未暂存 + 未跟踪）。 */
export interface GitReviewSummary {
  readonly available: boolean
  readonly files: readonly GitReviewFile[]
  readonly truncated: boolean
}

/** One unified-diff hunk; every line keeps its `+`, `-`, or space prefix. */
export interface GitDiffHunk {
  readonly oldStart: number
  readonly oldLines: number
  readonly newStart: number
  readonly newLines: number
  readonly lines: readonly string[]
}

/** 单文件对 HEAD 的比较；unavailable 只在浏览器半作为状态出现，宿主直接报错。 */
export type GitFileDiff =
  | {
    readonly kind: 'text'
    readonly path: string
    /** Whether the file existed in HEAD. */
    readonly before: boolean
    /** Whether the file exists in the working tree. */
    readonly after: boolean
    readonly hunks: readonly GitDiffHunk[]
  }
  | { readonly kind: 'binary'; readonly path: string }
  | { readonly kind: 'oversized'; readonly path: string }

const GIT_REVIEW_STATUSES: ReadonlySet<string> = new Set([
  'conflict', 'deleted', 'renamed', 'copied', 'added', 'untracked', 'modified', 'unmodified',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/** 校验一条 review 清单记录（宿主产出与浏览器半补造条目共用同一形状）。 */
export function isGitReviewFile(value: unknown): value is GitReviewFile {
  if (!isRecord(value)) return false
  const { path, status, added, deleted, binary, oversized } = value
  return typeof path === 'string' && path.length > 0 && isSafeWorkspacePath(path)
    && typeof status === 'string' && GIT_REVIEW_STATUSES.has(status)
    && isCount(added) && isCount(deleted)
    && (binary === undefined || binary === true) && (oversized === undefined || oversized === true)
}

/** 校验 review 端点响应。 */
export function isGitReviewSummary(value: unknown): value is GitReviewSummary {
  if (!isRecord(value)) return false
  const { available, files, truncated } = value
  return typeof available === 'boolean' && typeof truncated === 'boolean'
    && Array.isArray(files) && files.every(isGitReviewFile)
}

function isGitDiffHunk(value: unknown): value is GitDiffHunk {
  if (!isRecord(value)) return false
  const { oldStart, oldLines, newStart, newLines, lines } = value
  return [oldStart, oldLines, newStart, newLines].every(field => isCount(field))
    && Array.isArray(lines) && lines.length > 0 && lines.every(line => typeof line === 'string' && /^[+ -]/.test(line))
}

/** 校验 diff 端点响应。 */
export function isGitFileDiff(value: unknown): value is GitFileDiff {
  if (!isRecord(value)) return false
  const { kind, path } = value
  if (typeof path !== 'string' || path.length === 0 || !isSafeWorkspacePath(path)) return false
  if (kind === 'binary' || kind === 'oversized') return true
  if (kind !== 'text') return false
  const { before, after, hunks } = value
  return typeof before === 'boolean' && typeof after === 'boolean'
    && Array.isArray(hunks) && hunks.every(isGitDiffHunk)
}

/** 一个工作区相对 slash 路径是否是规范、安全的 Git wire 形态。 */
export function isSafeWorkspacePath(path: string, allowRoot = false): boolean {
  if (path === '') return allowRoot
  if (path.length > WORKSPACE_PATH_MAX_LENGTH) return false
  if (path.includes('\0') || path.includes('\\') || path.startsWith('/') || path.endsWith('/')) return false
  if (/^[A-Za-z]:/u.test(path) || path.startsWith('//')) return false
  const parts = path.split('/')
  if (parts.length > WORKSPACE_PATH_MAX_SEGMENTS) return false
  return parts.every(part => part.length <= WORKSPACE_PATH_MAX_SEGMENT_LENGTH
    && part !== '' && part !== '.' && part !== '..')
}

const STATUS_PRIORITY: Readonly<Record<GitStatus, number>> = {
  modified: 1, untracked: 2, added: 3, copied: 4, renamed: 5, deleted: 6, conflict: 7,
}

export function mergeGitStatus(left: GitStatus | undefined, right: GitStatus): GitStatus {
  if (left === undefined) return right
  return STATUS_PRIORITY[right] > STATUS_PRIORITY[left] ? right : left
}

/** 文件只匹配自身；目录聚合自身及全部后代，根目录聚合所有条目。 */
export function statusForPath(path: string, directory: boolean, entries: readonly GitStatusEntry[]): GitStatus | undefined {
  const prefix = path === '' ? '' : `${path}/`
  let status: GitStatus | undefined
  for (const entry of entries) {
    const matches = directory ? path === '' || entry.path === path || entry.path.startsWith(prefix) : entry.path === path
    if (matches) status = mergeGitStatus(status, entry.status)
  }
  return status
}

export function gitStatusMarker(status: GitStatus): string {
  switch (status) {
    case 'conflict': return 'U'
    case 'deleted': return 'D'
    case 'renamed': return 'R'
    case 'copied': return 'C'
    case 'added': return 'A'
    case 'untracked': return '?'
    case 'modified': return 'M'
  }
}
