/**
 * Git review 面板的宿主侧采集：工作区对 HEAD 的变更清单（status + numstat）
 * 与单文件 patch。全部命令无 shell、有超时与 stdout 上限；工作区读取只做
 * 有界单文件读（未跟踪/空仓库的整文件新增计数与合成 hunk），不递归、不挂 watcher。
 */
import { open, type FileHandle } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  GIT_MAX_OUTPUT_BYTES, GIT_TIMEOUT_MS,
  type GitDiffHunk, type GitFileDiff, type GitReviewFile, type GitReviewSummary, type GitStatus,
} from './shared.js'
import { completeGitOutput, gitProjection, relativeGitPath, runGitCapture, statusFromXY } from './git.js'

/** review 清单里最多为多少个未跟踪文件读取工作区内容计算行数；之后的条目计为 0/0。 */
export const GIT_REVIEW_MAX_COUNTED_UNTRACKED = 200

/** 判定二进制的探测窗口；与 patch 输出一样只看前若干字节。 */
const BINARY_SNIFF_BYTES = 8192

export interface GitNumstatEntry {
  readonly added: number
  readonly deleted: number
  readonly binary: boolean
}

/**
 * 解析 `git diff --numstat -z` 输出为 cwd 相对路径 → 行数映射。
 * 记录形如 `<added>\t<deleted>\t<path>`，NUL 分隔、路径不加引号；`-` 计数代表二进制。
 */
export function parseGitNumstat(output: string, cwdPrefix = ''): Map<string, GitNumstatEntry> {
  const entries = new Map<string, GitNumstatEntry>()
  for (const record of output.split('\0')) {
    if (record === '') continue
    const firstTab = record.indexOf('\t')
    const secondTab = firstTab < 0 ? -1 : record.indexOf('\t', firstTab + 1)
    if (secondTab < 0) continue
    const addedField = record.slice(0, firstTab)
    const deletedField = record.slice(firstTab + 1, secondTab)
    const path = relativeGitPath(record.slice(secondTab + 1), cwdPrefix)
    if (path === undefined) continue
    const binary = addedField === '-' || deletedField === '-'
    const added = binary ? 0 : Number(addedField)
    const deleted = binary ? 0 : Number(deletedField)
    if (!Number.isSafeInteger(added) || added < 0 || !Number.isSafeInteger(deleted) || deleted < 0) continue
    entries.set(path, { added, deleted, binary })
  }
  return entries
}

/** 单条 porcelain-v2 记录的单值状态；`unmodified` 表示该路径没有变更记录。 */
export function statusOfRecord(record: string): GitStatus | 'unmodified' {
  if (record === '') return 'unmodified'
  if (record.startsWith('? ')) return 'untracked'
  if (record.startsWith('1 ')) return statusFromXY(record.split(' ')[1] ?? '..', '1')
  if (record.startsWith('2 ')) return statusFromXY(record.split(' ')[1] ?? '..', '2')
  if (record.startsWith('u ')) return 'conflict'
  return 'unmodified'
}

export interface UnifiedPatch {
  readonly hunks: readonly GitDiffHunk[]
  readonly binary: boolean
  readonly newFile: boolean
  readonly deletedFile: boolean
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/u

/**
 * 解析一条 `git diff --unified=3 --no-color` patch 文本。无法理解的行一律忽略；
 * 只有命中 `Binary files … differ` 才判二进制。空文本代表没有变更。
 */
export function parseUnifiedPatch(text: string): UnifiedPatch {
  const hunks: GitDiffHunk[] = []
  let binary = false
  let newFile = false
  let deletedFile = false
  let current: { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: string[] } | undefined
  for (const line of text.split('\n')) {
    if (line === '') continue
    if (line.startsWith('@@ ')) {
      const match = HUNK_HEADER.exec(line)
      if (match === null) { current = undefined; continue }
      current = {
        oldStart: Number(match[1]),
        oldLines: match[2] === undefined ? 1 : Number(match[2]),
        newStart: Number(match[3]),
        newLines: match[4] === undefined ? 1 : Number(match[4]),
        lines: [],
      }
      hunks.push(current)
      continue
    }
    if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) { binary = true; continue }
    if (line.startsWith('new file mode')) { newFile = true; continue }
    if (line.startsWith('deleted file mode')) { deletedFile = true; continue }
    if (line.startsWith('\\') || line.startsWith('diff --git ') || line.startsWith('index ')
      || line.startsWith('--- ') || line.startsWith('+++ ') || line.startsWith('old mode ')
      || line.startsWith('new mode ') || line.startsWith('similarity index ') || line.startsWith('dissimilarity index ')
      || line.startsWith('rename from ') || line.startsWith('rename to ') || line.startsWith('copy from ')
      || line.startsWith('copy to ')) continue
    if (current === undefined) continue
    if (line.startsWith('+') || line.startsWith('-') || line.startsWith(' ')) current.lines.push(line)
  }
  return {
    hunks: hunks.map(hunk => ({ ...hunk, lines: hunk.lines })),
    binary,
    newFile,
    deletedFile,
  }
}

/** 把整文件内容合成为一个全新增 hunk（未跟踪文件 / 空仓库基线）。 */
export function wholeFileHunks(text: string): readonly GitDiffHunk[] {
  if (text === '') return []
  const lines = text.endsWith('\n') ? text.slice(0, -1).split('\n') : text.split('\n')
  return [{
    oldStart: 0,
    oldLines: 0,
    newStart: 1,
    newLines: lines.length,
    lines: lines.map(line => `+${line}`),
  }]
}

export type WorktreeRead =
  | { readonly kind: 'ok'; readonly text: string; readonly lineCount: number }
  | { readonly kind: 'binary' }
  | { readonly kind: 'oversized' }
  | { readonly kind: 'missing' }

/** 有界读取工作区单文件：超限报 oversized，前 8 KiB 含 NUL 判二进制，否则给行数。 */
export async function readWorktreeFile(absolute: string, maxBytes = GIT_MAX_OUTPUT_BYTES): Promise<WorktreeRead> {
  let handle: FileHandle
  try {
    handle = await open(absolute, 'r')
  } catch {
    return { kind: 'missing' }
  }
  try {
    const size = (await handle.stat()).size
    if (size > maxBytes) return { kind: 'oversized' }
    const buffer = Buffer.alloc(size)
    if (size > 0) await handle.read(buffer, 0, size, 0)
    if (buffer.subarray(0, Math.min(buffer.length, BINARY_SNIFF_BYTES)).includes(0)) return { kind: 'binary' }
    const text = buffer.toString('utf8')
    let lineCount = 0
    for (let at = 0; at < buffer.length; at += 1) {
      if (buffer[at] === 0x0A) lineCount += 1
    }
    if (buffer.length > 0 && buffer[buffer.length - 1] !== 0x0A) lineCount += 1
    return { kind: 'ok', text, lineCount }
  } finally {
    await handle.close()
  }
}

/** HEAD 是否可解析：空仓库返回 'no'，git 不可用返回 'unavailable'。 */
export async function gitHeadState(
  cwd: string,
  timeoutMs = GIT_TIMEOUT_MS,
): Promise<'yes' | 'no' | 'unavailable'> {
  const result = await runGitCapture(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD'], {
    timeoutMs,
    maxOutputBytes: 4096,
    acceptCodes: [1],
  })
  if (result.kind !== 'ok') return 'unavailable'
  return result.stdout.toString('utf8').trim() === '' ? 'no' : 'yes'
}

export interface GitReviewOptions {
  readonly timeoutMs?: number
  readonly maxOutputBytes?: number
  readonly maxCountedUntracked?: number
}

/**
 * 采集一个会话工作区的 Git review 清单：status 条目为骨架，numstat（对 HEAD）补行数，
 * 未跟踪与空仓库条目用有界工作区读取计数。任何失败都降级为 `available:false`。
 */
export async function gitReview(cwd: string, options: GitReviewOptions = {}): Promise<GitReviewSummary> {
  const { snapshot, prefix } = await gitProjection(cwd, options)
  if (!snapshot.available) return { available: false, files: [], truncated: false }
  const head = await gitHeadState(cwd, options.timeoutMs)
  let numstat = new Map<string, GitNumstatEntry>()
  let numstatLimited = false
  if (head === 'yes') {
    const result = await runGitCapture(
      cwd,
      ['diff', '--numstat', '-z', '--no-renames', '--no-ext-diff', '--no-textconv', 'HEAD', '--', '.'],
      options,
    )
    if (result.kind === 'ok') {
      numstat = parseGitNumstat(completeGitOutput(result.stdout, result.limited).toString('utf8'), prefix)
      numstatLimited = result.limited
    }
  }
  const files: GitReviewFile[] = []
  let countedUntracked = 0
  const maxCounted = options.maxCountedUntracked ?? GIT_REVIEW_MAX_COUNTED_UNTRACKED
  for (const entry of snapshot.entries) {
    const stat = numstat.get(entry.path)
    if (stat !== undefined) {
      files.push({
        path: entry.path,
        status: entry.status,
        added: stat.added,
        deleted: stat.deleted,
        ...(stat.binary ? { binary: true as const } : {}),
      })
      continue
    }
    if (entry.status === 'deleted') {
      files.push({ path: entry.path, status: entry.status, added: 0, deleted: 0 })
      continue
    }
    if (head === 'yes' && entry.status !== 'untracked') {
      // numstat 截断（超输出上限）后缺失的已跟踪条目：计数按 0/0 呈现，单文件 diff 仍可单独获取。
      files.push({ path: entry.path, status: entry.status, added: 0, deleted: 0 })
      continue
    }
    if (countedUntracked >= maxCounted) {
      files.push({ path: entry.path, status: entry.status, added: 0, deleted: 0 })
      continue
    }
    countedUntracked += 1
    // 顺序读取（有界）：并发读会在未跟踪文件很多时放大磁盘压力。
    // eslint-disable-next-line no-await-in-loop -- 逐文件顺序读取是刻意的有界行为
    const read = await readWorktreeFile(resolve(cwd, ...entry.path.split('/')), options.maxOutputBytes)
    if (read.kind === 'ok') files.push({ path: entry.path, status: entry.status, added: read.lineCount, deleted: 0 })
    else if (read.kind === 'binary') files.push({ path: entry.path, status: entry.status, added: 0, deleted: 0, binary: true })
    else if (read.kind === 'oversized') files.push({ path: entry.path, status: entry.status, added: 0, deleted: 0, oversized: true })
    else files.push({ path: entry.path, status: entry.status, added: 0, deleted: 0 })
  }
  return { available: true, files, truncated: snapshot.truncated || numstatLimited }
}

export interface GitFileDiffOptions {
  readonly timeoutMs?: number
  readonly maxOutputBytes?: number
}

/**
 * 采集单文件对 HEAD 的比较。未跟踪/空仓库条目用有界读取合成为整文件新增；
 * patch 超出输出上限降级为 oversized；git 失败抛错（RPC 层转为错误状态）。
 */
export async function gitFileDiff(cwd: string, path: string, options: GitFileDiffOptions = {}): Promise<GitFileDiff> {
  const [head, statusResult] = await Promise.all([
    gitHeadState(cwd, options.timeoutMs),
    runGitCapture(cwd, ['status', '--porcelain=v2', '-z', '--untracked-files=all', '--', path], {
      ...options,
      maxOutputBytes: 64 * 1024,
    }),
  ])
  const status = statusResult.kind === 'ok' && !statusResult.limited
    ? statusOfRecord(completeGitOutput(statusResult.stdout, false).toString('utf8').split('\0')[0] ?? '')
    : 'unmodified'
  const absolute = resolve(cwd, ...path.split('/'))
  if (head === 'no' || status === 'untracked') {
    // 没有基线（空仓库）或 HEAD 里不存在该文件：整文件新增。
    const read = await readWorktreeFile(absolute, options.maxOutputBytes)
    if (read.kind === 'binary') return { kind: 'binary', path }
    if (read.kind === 'oversized') return { kind: 'oversized', path }
    if (read.kind === 'missing') {
      return { kind: 'text', path, before: false, after: false, hunks: [] }
    }
    return { kind: 'text', path, before: false, after: true, hunks: wholeFileHunks(read.text) }
  }
  const patch = await diffPatch(cwd, path, options)
  if (patch === undefined) return { kind: 'oversized', path }
  return patch
}

/** 跑单文件 patch 并转换为 diff 形态；输出被截断时返回 undefined（调用方降级 oversized）。 */
async function diffPatch(
  cwd: string,
  path: string,
  options: GitFileDiffOptions,
): Promise<GitFileDiff | undefined> {
  const result = await runGitCapture(
    cwd,
    ['diff', '--unified=3', '--no-color', '--no-renames', '--no-ext-diff', '--no-textconv', 'HEAD', '--', path],
    options,
  )
  if (result.kind !== 'ok') throw new Error(`git diff failed for ${path}`)
  if (result.limited) return undefined
  const patch = parseUnifiedPatch(result.stdout.toString('utf8'))
  if (patch.binary) return { kind: 'binary', path }
  const before = !patch.newFile
  const after = !patch.deletedFile
  return { kind: 'text', path, before, after, hunks: patch.hunks }
}
