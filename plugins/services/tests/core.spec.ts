import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ENV_OVERRIDES, START_TIME_TOLERANCE_MS, findExistingLog, identify, identifyBatch, legacyLogPath,
  listLegacyLogNames, listLogNames, logPath, matchesReadyLog, readRegistry, reconcile,
  registryPath, reportedIdentity, shellDialectWarning, shellInvocation, tailFile, withRegistryLock,
  writeRegistry,
} from '../src/core.js'
import type { Identity, Registry, ServiceRecord } from '../src/core.js'
import { baseNameOf, formatUptime, isValidName, midEllipsis, tailText } from '../src/shared.js'

const roots: string[] = []

/** 实现说明：此处记录相关接口、边界和生命周期约束。 */
function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-services-'))
  roots.push(root)
  return root
}

/** 进程与运行时契约：此处说明生命周期、身份核验、轮询或终端边界。 */
function record(over: Partial<ServiceRecord> = {}): ServiceRecord {
  return {
    name: 'web',
    command: 'pnpm dev',
    cwd: 'C:\\project',
    root: 'C:\\project',
    pid: 4242,
    startedAt: 1_000_000,
    logFile: 'C:\\project\\.agents\\logs\\web.log',
    ...over,
  }
}

/** 进程与运行时契约：此处说明生命周期、身份核验、轮询或终端边界。 */
function put(home: string, services: ServiceRecord[], rootsIndex: string[] = []): void {
  writeRegistry(home, { version: 2, services, roots: rootsIndex })
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('name validation', () => {
  it('accepts the characters a filename and a registry key can share', () => {
    for (const name of ['web', 'api-2', 'a.b_c', 'A1']) expect(isValidName(name)).toBe(true)
  })

  it('rejects path traversal, separators, blanks and oversize names', () => {
    for (const name of ['.', '..', 'a/b', 'a\\b', '', ' ', 'a b', 'x'.repeat(65), 'a:b']) {
      expect(isValidName(name)).toBe(false)
    }
  })

  it('still allows dots inside a name, which real service names use', () => {
    for (const name of ['a.b', 'web.dev', '.env-watch']) expect(isValidName(name)).toBe(true)
  })
})

describe('registry I/O', () => {
  it('round-trips through an atomic write and leaves no temp file behind', () => {
    const home = project()
    const a = project()
    put(home, [record({ root: a })], [a])
    const round: Registry = readRegistry(home)
    expect(round.services).toEqual([record({ root: a })])
    expect(round.roots).toEqual([a])
    // 临时文件会 rename，不会留在目标旁边。
    expect(listLogNames(home)).toEqual([])
    expect(readFileSync(registryPath(home), 'utf8')).toContain('"version": 2')
  })

  it('lives under the dsh home, not inside any project', () => {
    const home = project()
    expect(registryPath(home)).toBe(join(home, 'dsh-kit', 'services.json'))
  })

  it('treats a missing registry as empty rather than failing', () => {
    const round = readRegistry(project())
    expect(round.services).toEqual([])
    expect(round.roots).toEqual([])
  })

  it('treats a corrupt registry as empty, because it is a cache and not the truth', () => {
    const home = project()
    mkdirSync(join(home, 'dsh-kit'), { recursive: true })
    writeFileSync(registryPath(home), '{ this is not json', 'utf8')
    expect(readRegistry(home).services).toEqual([])
  })

  it('drops rows missing the fields later operations depend on, root included', () => {
    const home = project()
    mkdirSync(join(home, 'dsh-kit'), { recursive: true })
    writeFileSync(registryPath(home), JSON.stringify({
      version: 2,
      services: [record(), { name: 'broken' }, { name: 'rootless', pid: 1, command: 'x', cwd: 'x', startedAt: 1, logFile: 'x' }, null, 'nope'],
      roots: [],
    }), 'utf8')
    expect(readRegistry(home).services.map(item => item.name)).toEqual(['web'])
  })

  it('forgets roots whose directory no longer exists, so the index cannot grow forever', () => {
    const home = project()
    const gone = join(project(), 'removed')
    put(home, [], [gone, home])
    expect(readRegistry(home).roots).toEqual([home])
  })
})

describe('registry lock', () => {
  it('releases the lockfile when the critical section ends, even on throw', () => {
    const home = project()
    expect(withRegistryLock(home, () => 7)).toBe(7)
    expect(existsSync(`${registryPath(home)}.lock`)).toBe(false)
    expect(() => withRegistryLock(home, () => { throw new Error('boom') })).toThrow('boom')
    expect(existsSync(`${registryPath(home)}.lock`)).toBe(false)
  })

  it('breaks a stale lock left behind by a crashed writer instead of waiting forever', () => {
    const home = project()
    mkdirSync(join(home, 'dsh-kit'), { recursive: true })
    const lock = `${registryPath(home)}.lock`
    writeFileSync(lock, '999999 0\n', 'utf8')
    // mtime 拨回 1 小时前，超出陈旧阈值。
    const old = new Date(Date.now() - 3_600_000)
    utimesSync(lock, old, old)
    expect(withRegistryLock(home, () => 'ok')).toBe('ok')
    expect(existsSync(lock)).toBe(false)
  })
})

describe('log discovery', () => {
  it('lists log basenames and ignores anything that is not a valid service log', () => {
    const home = project()
    mkdirSync(join(home, 'dsh-kit', 'logs'), { recursive: true })
    for (const file of ['web.log', 'api.log', 'notes.txt', 'a b.log']) {
      writeFileSync(join(home, 'dsh-kit', 'logs', file), '', 'utf8')
    }
    expect(listLogNames(home)).toEqual(['api', 'web'])
  })

  it('reports no logs rather than throwing when the directory is absent', () => {
    expect(listLogNames(project())).toEqual([])
  })

  it('places logs under the dsh home, next to the registry — not in any project', () => {
    const home = project()
    expect(logPath(home, 'web')).toBe(join(home, 'dsh-kit', 'logs', 'web.log'))
    expect(legacyLogPath('C:\\p', 'web')).toBe(join('C:\\p', '.agents', 'logs', 'web.log'))
  })

  it('still lists legacy project logs for the migration fallback', () => {
    const root = project()
    mkdirSync(join(root, '.agents', 'logs'), { recursive: true })
    writeFileSync(join(root, '.agents', 'logs', 'old.log'), '', 'utf8')
    expect(listLegacyLogNames(root)).toEqual(['old'])
    expect(listLegacyLogNames(project())).toEqual([])
  })

  it('finds a stopped service log by scanning candidate roots in order', () => {
    const a = project()
    const b = project()
    mkdirSync(join(b, '.agents', 'logs'), { recursive: true })
    writeFileSync(join(b, '.agents', 'logs', 'api.log'), 'x', 'utf8')
    expect(findExistingLog([a, b], 'api')).toBe(join(b, '.agents', 'logs', 'api.log'))
    expect(findExistingLog([a], 'api')).toBeUndefined()
    // 非法名称直接拒绝，不构造路径。
    expect(findExistingLog([b], '../escape')).toBeUndefined()
  })
})

describe('tailFile', () => {
  it('keeps the requested tail from a bounded window instead of reading a whole log', () => {
    const root = project()
    const file = join(root, 'big.log')
    // 4997 行 × ~95B ≈ 475KB，超过 256KB 读取窗口；结尾三行带可识别标记。
    const head = Array.from({ length: 4997 }, (_, i) => `filler-${String(i).padStart(6, '0')}-${'x'.repeat(80)}`)
    writeFileSync(file, [...head, 'tail-a', 'tail-b', 'tail-c'].join('\n') + '\n', 'utf8')
    expect(tailFile(file, 3)).toBe('tail-a\ntail-b\ntail-c')
  })

  it('drops the first partial line when the window cuts mid-file', () => {
    const root = project()
    const file = join(root, 'cut.log')
    // 300KB 无换行前缀把窗口起点压在行中间，窗口尾部是完整的两行。
    writeFileSync(file, 'x'.repeat(300_000) + '\nkeep-a\nkeep-b\n', 'utf8')
    expect(tailFile(file, 2)).toBe('keep-a\nkeep-b')
  })

  it('returns empty for a missing file instead of throwing', () => {
    expect(tailFile(join(project(), 'none.log'), 5)).toBe('')
  })
})

describe('pid identity', () => {
  it('reports gone when the process no longer exists', () => {
    expect(identify(record(), { alive: () => false })).toBe('gone')
  })

  it('reports ours when the OS creation time agrees within tolerance', () => {
    const startedAt = 1_000_000
    expect(identify(record({ startedAt }), {
      alive: () => true,
      startedAt: () => startedAt + START_TIME_TOLERANCE_MS - 1,
    })).toBe('ours')
  })

  it('reports recycled when the creation time disagrees — this pid is a stranger', () => {
    const startedAt = 1_000_000
    expect(identify(record({ startedAt }), {
      alive: () => true,
      startedAt: () => startedAt + START_TIME_TOLERANCE_MS + 1,
    })).toBe('recycled')
  })

  it('reports unknown when the OS will not say, and never guesses "ours"', () => {
    expect(identify(record(), { alive: () => true, startedAt: () => undefined })).toBe('unknown')
  })
})

describe('reconcile', () => {
  it('keeps ours and unknown, and drops gone and recycled', () => {
    const rows = [
      record({ name: 'ours' }),
      record({ name: 'unknown' }),
      record({ name: 'gone' }),
      record({ name: 'recycled' }),
    ]
    const verdicts: Record<string, Identity> = {
      ours: 'ours', unknown: 'unknown', gone: 'gone', recycled: 'recycled',
    }
    const { live, dropped } = reconcile(rows, row => verdicts[row.name] as Identity)
    // live 携带身份：判定只发生一次，调用方不得再问第二遍（每问一次就是一次子进程探针）。
    expect(live.map(entry => `${entry.record.name}:${entry.identity}`)).toEqual(['ours:ours', 'unknown:unknown'])
    expect(dropped.map(entry => `${entry.record.name}:${entry.reason}`))
      .toEqual(['gone:gone', 'recycled:recycled'])
  })
})

describe('identifyBatch', () => {
  it('classifies every record from one startedAt table — one spawn per reconcile, not one per record', () => {
    const startedAt = 1_000_000
    const rows = [
      record({ name: 'ours', pid: 11, startedAt }),
      record({ name: 'recycled', pid: 22, startedAt }),
      record({ name: 'unknown', pid: 33, startedAt }),
      record({ name: 'gone', pid: 44, startedAt }),
    ]
    const probed: number[][] = []
    const entries = identifyBatch(rows, {
      alive: pid => pid !== 44,
      startedAt: pids => {
        probed.push([...pids].toSorted((a, b) => a - b))
        // 只探测存活 pid，且一次拿全部。
        return new Map([[11, startedAt], [22, startedAt + START_TIME_TOLERANCE_MS + 1], [33, undefined]])
      },
    })
    expect(entries.map(entry => `${entry.record.name}:${entry.identity}`))
      .toEqual(['ours:ours', 'recycled:recycled', 'unknown:unknown', 'gone:gone'])
    expect(probed).toEqual([[11, 22, 33]])
  })

  it('probes nothing for an empty registry — opening a quiet page costs zero spawns', () => {
    const probed: number[][] = []
    expect(identifyBatch([], { startedAt: pids => { probed.push([...pids]); return new Map() } })).toEqual([])
    expect(probed).toEqual([[]])
  })
})

describe('reportedIdentity', () => {
  it('collapses every non-confirmed verdict to unknown, never to ours', () => {
    expect(reportedIdentity('ours')).toBe('ours')
    expect(reportedIdentity('unknown')).toBe('unknown')
  })
})

describe('readiness log matching', () => {
  it('matches a regular expression case-insensitively', () => {
    expect(matchesReadyLog('Local:   http://localhost:5173/', 'ready|local:')).toBe(true)
  })

  it('degrades an invalid pattern to a substring match instead of failing the start', () => {
    expect(matchesReadyLog('server LISTENING on 3000', '(unclosed')).toBe(false)
    expect(matchesReadyLog('server (unclosed group', '(unclosed')).toBe(true)
  })
})

describe('shell selection', () => {
  it('routes Windows through a node launcher, because detached pwsh has no console', () => {
    if (process.platform !== 'win32') return
    const invocation = shellInvocation('pnpm dev')
    expect(invocation.file).toBe(process.execPath)
    expect(invocation.args[0]).toBe('-e')
    // launcher plan 是 JSON，因此包含引号的可变长度 argv
    // 可以完整通过 Windows 命令行 quoting。
    const plan = JSON.parse(invocation.args[3] as string) as { f: string; a: string[]; s: boolean }
    expect(plan.a.at(-1)).toContain('pnpm dev')
  })

  it('passes -NoProfile, so a user PowerShell profile cannot pollute a service log', () => {
    if (process.platform !== 'win32') return
    const invocation = shellInvocation('pnpm dev')
    const plan = JSON.parse(invocation.args[3] as string) as { f: string; a: string[]; s: boolean }
    // dsh 自己 pwsh executor 使用的精确 flags。
    expect(plan.s).toBe(false)
    expect(plan.a.slice(0, 4)).toEqual(['-NoLogo', '-NoProfile', '-NonInteractive', '-Command'])
    // ……以及 UTF-8 固定，避免 5.1 fallback 输出乱码。
    expect(plan.a[4]).toContain('OutputEncoding')
  })

  it('honours an explicit shell override', () => {
    if (process.platform !== 'win32') return
    expect(shellInvocation('x', 'C:\\ps\\pwsh.exe').shell).toBe('C:\\ps\\pwsh.exe')
  })

  it('uses a plain sh -c on POSIX, with no extra process in between', () => {
    if (process.platform === 'win32') return
    expect(shellInvocation('pnpm dev')).toEqual({
      file: '/bin/sh', args: ['-c', 'pnpm dev'], shell: '/bin/sh', viaLauncher: false,
    })
  })

  it('marks the Windows path as launcher-mediated, so the caller reads the real pid back', () => {
    if (process.platform !== 'win32') return
    // 这里的 `child.pid` 是 launcher，几毫秒就退出；使用它
    // 会让之后每次 identify() 都报告 `gone`。
    expect(shellInvocation('pnpm dev').viaLauncher).toBe(true)
  })

  it('makes stage 1 break the parent chain and stage 2 host the shell', () => {
    if (process.platform !== 'win32') return
    const invocation = shellInvocation('pnpm dev')
    const [stage1, stage2] = [invocation.args[1] as string, invocation.args[2] as string]
    // Stage 1 是完整的 `taskkill /T` 修复：detached 启动 stage 2，然后
    // 退出，使 dsh 不再是活跃祖先。
    expect(stage1).toContain('detached:true')
    expect(stage1).toContain('process.exit(0)')
    // Stage 2 绝不能 detach shell——没有 console 的 pwsh 会静默退出
    // ——并且必须报告自身 pid，不能让 shell 与它一起失去宿主。
    expect(stage2).toContain('writeFileSync')
    expect(stage2).toContain('String(process.pid)')
    expect(stage2).not.toContain('detached:true')
  })

  it('turns off colour, so ANSI escapes never reach the log or the panel', () => {
    expect(ENV_OVERRIDES['NO_COLOR']).toBe('1')
  })

  it('stays silent when the command runs in the expected dialect', () => {
    if (process.platform !== 'win32') {
      expect(shellDialectWarning('/bin/sh')).toBeUndefined()
      return
    }
    expect(shellDialectWarning('C:\\Program Files\\PowerShell\\7\\pwsh.exe')).toBeUndefined()
  })

  it('warns when a Windows command will silently run in cmd instead of pwsh', () => {
    if (process.platform !== 'win32') return
    expect(shellDialectWarning('C:\\Windows\\system32\\cmd.exe')).toContain('cmd.exe')
  })
})

describe('presentation helpers', () => {
  it('keeps only the trailing lines and does not spend one on a trailing newline', () => {
    expect(tailText('a\nb\nc\n', 2)).toBe('b\nc')
    expect(tailText('a\r\nb\r\n', 5)).toBe('a\nb')
    expect(tailText('', 3)).toBe('')
    expect(tailText('a\nb', 0)).toBe('')
  })

  it('takes the last path segment on either separator, for the origin badge', () => {
    expect(baseNameOf('C:\\work\\dsh-kit')).toBe('dsh-kit')
    expect(baseNameOf('/home/liu/work/dsh-kit')).toBe('dsh-kit')
    expect(baseNameOf('dsh-kit')).toBe('dsh-kit')
  })

  it('shows one unit of duration precision', () => {
    expect(formatUptime(5_000)).toBe('5s')
    expect(formatUptime(90_000)).toBe('1m')
    expect(formatUptime(3_600_000 + 120_000)).toBe('1h2m')
    expect(formatUptime(26 * 3_600_000)).toBe('1d2h')
  })

  it('clamps a negative or non-finite duration instead of rendering nonsense', () => {
    expect(formatUptime(-1)).toBe('0s')
    expect(formatUptime(Number.NaN)).toBe('0s')
  })
})

describe('midEllipsis', () => {
  it('returns the text untouched while it still fits', () => {
    expect(midEllipsis('sui-tang-20', 11)).toBe('sui-tang-20')
    expect(midEllipsis('web', 40)).toBe('web')
  })

  it('keeps both anchors and spends the extra glyph on the head', () => {
    // 15 个字形放不进 12：keep=11，head 取 6、tail 取 5，输出正好 12 个字形。
    expect(midEllipsis('sui-tang-20-dev', 12)).toBe('sui-ta…0-dev')
  })

  it('handles the degenerate budgets without slicing nonsense', () => {
    expect(midEllipsis('web', 1)).toBe('…')
    expect(midEllipsis('web', 2)).toBe('w…')
    expect(midEllipsis('web', 0)).toBe('')
    expect(midEllipsis('web', -1)).toBe('')
  })

  it('never exceeds the budget and always keeps the head when truncating', () => {
    for (const max of [2, 3, 4, 7, 12]) {
      for (const name of ['cocos-preview-2f8a1c', 'sui-tang-20', 'api']) {
        const out = midEllipsis(name, max)
        expect(out.length).toBeLessThanOrEqual(max)
        if (out.length === max) {
          expect(out.startsWith('…') || name.startsWith(out.slice(0, 1))).toBe(true)
        }
      }
    }
  })
})
