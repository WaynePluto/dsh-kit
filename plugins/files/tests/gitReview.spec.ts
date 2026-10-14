/** git review 采集：纯解析函数单测 + 真实临时仓库集成。 */
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  gitFileDiff, gitReview, parseGitNumstat, parseUnifiedPatch, readWorktreeFile, statusOfRecord, wholeFileHunks,
} from '../src/gitReview.js'

let root: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'dsh-files-review-')) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

describe('numstat 解析', () => {
  it('解析行数、二进制标记并做 cwd 前缀投影', () => {
    const map = parseGitNumstat('3\t1\tpackages/app/src/a.ts\0-\t-\tpackages/app/bin.dat\0', 'packages/app/')
    expect(map.get('src/a.ts')).toEqual({ added: 3, deleted: 1, binary: false })
    expect(map.get('bin.dat')).toEqual({ added: 0, deleted: 0, binary: true })
    expect(parseGitNumstat('1\t1\tsrc/a.ts\0').get('src/a.ts')).toEqual({ added: 1, deleted: 1, binary: false })
    expect(parseGitNumstat('garbage\0')).toEqual(new Map())
  })
})

describe('porcelain 单记录状态', () => {
  it('区分未跟踪、普通、冲突与无记录', () => {
    expect(statusOfRecord('? new.txt')).toBe('untracked')
    expect(statusOfRecord('1 .M N... 100644 100644 100644 abc def a.txt')).toBe('modified')
    expect(statusOfRecord('1 A. N... 100644 100644 100644 abc def a.txt')).toBe('added')
    expect(statusOfRecord('2 R. N... 100644 100644 100644 abc def R100 new.ts')).toBe('renamed')
    expect(statusOfRecord('u UU N... 100644 100644 100644 100644 a b c x')).toBe('conflict')
    expect(statusOfRecord('')).toBe('unmodified')
  })
})

describe('unified patch 解析', () => {
  const PATCH = [
    'diff --git a/a.ts b/a.ts',
    'index 111..222 100644',
    '--- a/a.ts',
    '+++ b/a.ts',
    '@@ -1,2 +1,3 @@',
    ' context',
    '-old',
    '+new',
    '+extra',
    '\\ No newline at end of file',
    'diff --git a/bin.png b/bin.png',
    'index 111..222 100644',
    'Binary files a/bin.png and b/bin.png differ',
    '',
  ].join('\n')

  it('解析 hunk 头、增删行，跳过元数据与 no-newline 标记', () => {
    const patch = parseUnifiedPatch(PATCH)
    expect(patch.hunks).toEqual([{
      oldStart: 1, oldLines: 2, newStart: 1, newLines: 3, lines: [' context', '-old', '+new', '+extra'],
    }])
    expect(patch.binary).toBe(true)
    expect(patch.newFile).toBe(false)
    expect(patch.deletedFile).toBe(false)
  })

  it('识别新建/删除文件标记与缺省计数', () => {
    const patch = parseUnifiedPatch([
      'diff --git a/n.txt b/n.txt',
      'new file mode 100644',
      'index 000..222',
      '--- /dev/null',
      '+++ b/n.txt',
      '@@ -0,0 +1 @@',
      '+hello',
      '',
    ].join('\n'))
    expect(patch.newFile).toBe(true)
    expect(patch.hunks).toEqual([{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 1, lines: ['+hello'] }])
    expect(parseUnifiedPatch('deleted file mode 100644\n').deletedFile).toBe(true)
    expect(parseUnifiedPatch('')).toEqual({ hunks: [], binary: false, newFile: false, deletedFile: false })
  })
})

describe('整文件新增与有界读取', () => {
  it('合成全新增 hunk，空文件无 hunk', () => {
    expect(wholeFileHunks('a\nb\n')).toEqual([{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 2, lines: ['+a', '+b'] }])
    expect(wholeFileHunks('x')).toEqual([{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 1, lines: ['+x'] }])
    expect(wholeFileHunks('')).toEqual([])
  })

  it('读取计数行数、识别二进制、超限与缺失', async () => {
    await writeFile(join(root, 'lines.txt'), 'a\nb\nc', 'utf8')
    const ok = await readWorktreeFile(join(root, 'lines.txt'))
    expect(ok).toEqual({ kind: 'ok', text: 'a\nb\nc', lineCount: 3 })
    await writeFile(join(root, 'bin.dat'), Buffer.from([0x00, 0x01]))
    expect(await readWorktreeFile(join(root, 'bin.dat'))).toEqual({ kind: 'binary' })
    expect(await readWorktreeFile(join(root, 'lines.txt'), 2)).toEqual({ kind: 'oversized' })
    expect(await readWorktreeFile(join(root, 'missing.txt'))).toEqual({ kind: 'missing' })
  })
})

/** 在临时目录里准备一个带一次提交的仓库；git 不可用时跳过集成段。 */
function initRepo(): boolean {
  const init = spawnSync('git', ['init', '--quiet'], { cwd: root, stdio: 'ignore' })
  if (init.status !== 0) return false
  for (const args of [
    ['config', 'user.email', 'test@dsh-kit'],
    ['config', 'user.name', 'dsh-kit test'],
  ]) {
    if (spawnSync('git', args, { cwd: root, stdio: 'ignore' }).status !== 0) return false
  }
  return true
}

describe('真实仓库集成', () => {
  // 集成段要串行跑十多个 git 子进程，慢速 CI runner（windows-latest）上会超过默认 5 秒。
  const GIT_INTEGRATION_TIMEOUT = 30_000

  it('review 列出修改/新增/未跟踪并给出计数；diff 给出 hunk 与 before/after', { timeout: GIT_INTEGRATION_TIMEOUT }, async () => {
    if (!initRepo()) return
    await writeFile(join(root, 'a.txt'), 'one\ntwo\nthree\n', 'utf8')
    await writeFile(join(root, 'keep.txt'), 'keep\n', 'utf8')
    if (spawnSync('git', ['add', '.'], { cwd: root, stdio: 'ignore' }).status !== 0) return
    if (spawnSync('git', ['commit', '--quiet', '-m', 'base'], { cwd: root, stdio: 'ignore' }).status !== 0) return
    await writeFile(join(root, 'a.txt'), 'one\nTWO\nthree\nfour\n', 'utf8')
    await writeFile(join(root, 'staged.txt'), 'staged\n', 'utf8')
    if (spawnSync('git', ['add', 'staged.txt'], { cwd: root, stdio: 'ignore' }).status !== 0) return
    await writeFile(join(root, 'untracked.txt'), 'u1\nu2\n', 'utf8')

    const summary = await gitReview(root)
    expect(summary.available).toBe(true)
    expect(summary.truncated).toBe(false)
    const byPath = new Map(summary.files.map(file => [file.path, file]))
    expect(byPath.get('a.txt')).toMatchObject({ status: 'modified', added: 2, deleted: 1 })
    expect(byPath.get('staged.txt')).toMatchObject({ status: 'added', added: 1, deleted: 0 })
    expect(byPath.get('untracked.txt')).toMatchObject({ status: 'untracked', added: 2, deleted: 0 })
    expect(byPath.has('keep.txt')).toBe(false)

    const modified = await gitFileDiff(root, 'a.txt')
    expect(modified).toMatchObject({ kind: 'text', before: true, after: true })
    if (modified.kind === 'text') {
      expect(modified.hunks).toHaveLength(1)
      expect(modified.hunks[0]?.lines).toEqual([' one', '-two', '+TWO', ' three', '+four'])
    }
    const staged = await gitFileDiff(root, 'staged.txt')
    expect(staged).toMatchObject({ kind: 'text', before: false, after: true })
    const untracked = await gitFileDiff(root, 'untracked.txt')
    expect(untracked).toEqual({
      kind: 'text', path: 'untracked.txt', before: false, after: true,
      hunks: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 2, lines: ['+u1', '+u2'] }],
    })
    const unchanged = await gitFileDiff(root, 'keep.txt')
    expect(unchanged).toMatchObject({ kind: 'text', before: true, after: true, hunks: [] })
  })

  it('cwd 在仓库子目录时投影为会话相对路径', { timeout: GIT_INTEGRATION_TIMEOUT }, async () => {
    if (!initRepo()) return
    await mkdir(join(root, 'packages', 'app'), { recursive: true })
    await writeFile(join(root, 'packages', 'app', 'n.ts'), 'n\n', 'utf8')
    if (spawnSync('git', ['add', '.'], { cwd: root, stdio: 'ignore' }).status !== 0) return
    if (spawnSync('git', ['commit', '--quiet', '-m', 'base'], { cwd: root, stdio: 'ignore' }).status !== 0) return
    await writeFile(join(root, 'packages', 'app', 'n.ts'), 'n\nn2\n', 'utf8')
    const nested = join(root, 'packages', 'app')
    const summary = await gitReview(nested)
    expect(summary.available).toBe(true)
    expect(summary.files).toEqual([{ path: 'n.ts', status: 'modified', added: 1, deleted: 0 }])
    expect(await gitFileDiff(nested, 'n.ts')).toMatchObject({ kind: 'text', before: true, after: true })
  })

  it('空仓库（无 HEAD）把未跟踪文件按整文件新增呈现', { timeout: GIT_INTEGRATION_TIMEOUT }, async () => {
    if (!initRepo()) return
    await writeFile(join(root, 'fresh.txt'), 'f1\nf2\nf3\n', 'utf8')
    const summary = await gitReview(root)
    expect(summary.available).toBe(true)
    expect(summary.files).toEqual([{ path: 'fresh.txt', status: 'untracked', added: 3, deleted: 0 }])
    expect(await gitFileDiff(root, 'fresh.txt')).toEqual({
      kind: 'text', path: 'fresh.txt', before: false, after: true,
      hunks: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 3, lines: ['+f1', '+f2', '+f3'] }],
    })
  })
})
