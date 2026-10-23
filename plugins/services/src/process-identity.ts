/**
 * Node-only pid 存活与身份核验：记录的 pid 只有在创建时间一致时才可确认属于本插件。
 * 无法取得 OS 创建时间时保留 `unknown`，停止路径必须 fail closed。
 *
 * 性能契约：Windows 读创建时间要 spawn 一个 PowerShell（实测 ~0.4s/次），因此
 * 身份判定按批进行——一次子进程拿全部 pid 的创建时间；展示路径（面板轮询）
 * 还可复用短时限的缓存。**终止/重启路径必须现查**：缓存命中只能证明「pid 活着且
 * 创建时间曾与记录一致」，pid 死后被回收的窗口内缓存会误报 `ours`，杀进程的决策
 * 不能建立在缓存上（manager 层的 stop/restart 不传缓存窗口）。
 *
 * @module @dsh-kit/dsh-plugin-services/process-identity
 */

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { ServiceIdentity } from './shared.js'
import type { ServiceRecord } from './registry.js'

/** OS 报告的创建时间与 `startedAt` 允许的最大差值。 */
export const START_TIME_TOLERANCE_MS = 60_000

/** 一条记录连同其身份判定的不可分结果；reconcile 与批量判定都以它为原子。 */
export interface IdentityEntry {
  record: ServiceRecord
  identity: Identity
}

/** 缓存条目：创建时间与取得时刻。 */
interface StartedAtEntry {
  startedAt: number
  at: number
}

/**
 * pid → OS 创建时间的展示缓存。只在 pid 仍存活时才可能被读取（先过 signal 0 的
 * 存活检查），且读取方必须显式给出缓存窗口；进程死亡的判定永远不经过缓存。
 */
const startedAtCache = new Map<number, StartedAtEntry>()

/** 已解析的 PowerShell 解释器路径；PATH 扫描一次后复用，避免每次探针重复扫盘。 */
let cachedShell: string | undefined
let shellResolved = false

/**
 * 判断 pid 当前是否存在。signal 0 只执行权限和存在性检查；`EPERM` 表示进程存在但属于其他用户，仍算存活。
 * 微秒级、无子进程：是唯一可以高频调用的实时信号，也是缓存的第一道守卫。
 * @param pid - 进程 id。
 * @returns 是否存在该进程。
 */
export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error: unknown) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * 在 PATH 中查找可执行文件但不运行它。
 * @param name - 不带路径的程序名。
 * @returns 绝对路径；不在 PATH 中时返回 undefined。
 */
export function findExecutable(name: string): string | undefined {
  const entries = (process.env['PATH'] ?? '').split(path.delimiter).filter(Boolean)
  const extensions = process.platform === 'win32'
    ? (process.env['PATHEXT'] ?? '.EXE;.CMD;.BAT').split(';').filter(Boolean)
    : ['']
  for (const dir of entries) {
    for (const ext of extensions) {
      const candidate = path.join(dir, name + ext)
      try {
        if (fs.statSync(candidate).isFile()) return candidate
      } catch {
        // 尝试下一个候选路径。
      }
    }
  }
  return undefined
}

/** 解析创建时间探针用的解释器（Windows）；结果跨调用复用。 */
function probeShell(): string | undefined {
  if (!shellResolved) {
    cachedShell = findExecutable('pwsh') ?? findExecutable('powershell')
    shellResolved = true
  }
  return cachedShell
}

/** 把 .NET ticks（自 0001-01-01 的 100ns 单位）换算为 Unix epoch 毫秒。 */
function ticksToEpochMs(ticks: string): number | undefined {
  try {
    return Number((BigInt(ticks.trim()) - 621_355_968_000_000_000n) / 10_000n)
  } catch {
    return undefined
  }
}

/**
 * 一次子进程读取一批 pid 的 OS 创建时间（epoch ms）；只包含查到的 pid，缺席即「OS 不提供」。
 * 没有可查 pid 时不 spawn。任何失败按整体不可用处理（返回空表，调用方按 unknown 处理）。
 * @param pids - 要查询的 pid 列表（调用方已确认存活）。
 * @returns pid → 创建时间；查不到的 pid 不在表内。
 */
function readStartedAtRaw(pids: readonly number[]): Map<number, number> {
  if (pids.length === 0) return new Map()
  const table = new Map<number, number>()
  try {
    if (process.platform === 'win32') {
      const shell = probeShell()
      if (shell === undefined) return table
      // 一个子进程拿全部：Get-Process 接受 id 列表；无权限读 StartTime 的行被跳过（缺席 = unknown）。
      const script = `Get-Process -Id ${pids.join(',')} -ErrorAction SilentlyContinue`
        + ' | ForEach-Object { try { "$($_.Id) $($_.StartTime.ToUniversalTime().Ticks)" } catch { } }'
      const result = spawnSync(shell, ['-NoProfile', '-NonInteractive', '-Command', script], {
        encoding: 'utf8',
        windowsHide: true,
      })
      if (result.status !== 0) return table
      for (const line of result.stdout.split(/\r?\n/u)) {
        const match = /^(\d+)\s+(\d+)$/u.exec(line.trim())
        if (match === null) continue
        const startedAt = ticksToEpochMs(match[2] as string)
        if (startedAt !== undefined) table.set(Number(match[1]), startedAt)
      }
      return table
    }
    const result = spawnSync('ps', ['-p', pids.join(','), '-o', 'pid=,lstart='], { encoding: 'utf8' })
    if (result.status !== 0) return table
    for (const line of result.stdout.split('\n')) {
      const match = /^\s*(\d+)\s+(.+?)\s*$/u.exec(line)
      if (match === null) continue
      const parsed = Date.parse(match[2] as string)
      if (!Number.isNaN(parsed)) table.set(Number(match[1]), parsed)
    }
  } catch {
    // 探针整体失败：保持空表，调用方按 unknown 处理。
  }
  return table
}

/**
 * 批量读取 pid 的创建时间，可选复用展示缓存。
 * 缓存命中只代表「该 pid 在窗口内曾以这个创建时间存活」，不能作为终止决策依据。
 * @param pids - 要查询的 pid 列表。
 * @param options.maxCacheMs - 缓存窗口（毫秒）；0（默认）表示始终现查。
 * @returns pid → 创建时间；OS 不提供时为 undefined。
 */
export function processStartTimes(
  pids: readonly number[],
  options: { maxCacheMs?: number } = {},
): Map<number, number | undefined> {
  const maxCacheMs = options.maxCacheMs ?? 0
  const result = new Map<number, number | undefined>()
  const unique = [...new Set(pids.filter(pid => Number.isInteger(pid) && pid > 0))]
  const now = Date.now()
  const toProbe: number[] = []
  for (const pid of unique) {
    const cached = startedAtCache.get(pid)
    if (maxCacheMs > 0 && cached !== undefined && now - cached.at <= maxCacheMs) {
      result.set(pid, cached.startedAt)
    } else {
      if (cached !== undefined) startedAtCache.delete(pid)
      toProbe.push(pid)
    }
  }
  if (toProbe.length > 0) {
    const probed = readStartedAtRaw(toProbe)
    const probedAt = Date.now()
    for (const pid of toProbe) {
      const startedAt = probed.get(pid)
      if (startedAt !== undefined) startedAtCache.set(pid, { startedAt, at: probedAt })
      result.set(pid, startedAt)
    }
  }
  return result
}

/**
 * 读取单个 pid 的 OS 创建时间（epoch ms）。始终现查（不读缓存），结果写入缓存供展示路径复用。
 * `undefined` 表示 OS 不提供，调用方必须按未知身份处理而不能视作一致。
 * @param pid - 进程 id。
 * @returns 创建时间；不可用时为 undefined。
 */
export function processStartedAt(pid: number): number | undefined {
  if (!isPidAlive(pid)) return undefined
  const startedAt = readStartedAtRaw([pid]).get(pid)
  if (startedAt !== undefined) startedAtCache.set(pid, { startedAt, at: Date.now() })
  return startedAt
}

/** 已记录 pid 的身份判定。 */
export type Identity = 'ours' | 'gone' | 'unknown' | 'recycled'

/** 用预取的存活与创建时间事实分类一条记录；三个分支与单条 identify 完全一致。 */
function classify(record: ServiceRecord, alive: boolean, osStart: number | undefined): Identity {
  if (!alive) return 'gone'
  if (osStart === undefined) return 'unknown'
  return Math.abs(osStart - record.startedAt) <= START_TIME_TOLERANCE_MS ? 'ours' : 'recycled'
}

/**
 * 判断记录的 pid 是否仍是启动的那个服务：`gone` 可丢弃，`ours` 表示创建时间一致，`recycled` 严禁终止，`unknown` 需要人工确认。
 * @param record - 已保存记录。
 * @param deps - 注入的 probe，供测试使用。
 * @returns 身份判定。
 */
export function identify(
  record: ServiceRecord,
  deps: { alive?: typeof isPidAlive; startedAt?: typeof processStartedAt } = {},
): Identity {
  const alive = (deps.alive ?? isPidAlive)(record.pid)
  if (!alive) return 'gone'
  return classify(record, true, (deps.startedAt ?? processStartedAt)(record.pid))
}

/**
 * 批量身份判定：存活检查（signal 0，微秒级）逐条现做，创建时间一次子进程全取。
 * 一次 reconcile 从 2N 次 spawn 降为最多 1 次；死亡判定永远实时，绝不来自缓存。
 * @param records - 已保存记录。
 * @param options.maxCacheMs - 创建时间缓存的展示窗口（毫秒）；0（默认）始终现查。
 * @param options.alive / options.startedAt - 测试注入。
 * @returns 记录 + 身份判定的原子列表。
 */
export function identifyBatch(
  records: readonly ServiceRecord[],
  options: {
    maxCacheMs?: number
    alive?: typeof isPidAlive
    startedAt?: (pids: readonly number[]) => Map<number, number | undefined>
  } = {},
): IdentityEntry[] {
  const aliveFn = options.alive ?? isPidAlive
  const alivePids = new Set<number>()
  const aliveByRecord = new Map<ServiceRecord, boolean>()
  for (const record of records) {
    const alive = aliveFn(record.pid)
    aliveByRecord.set(record, alive)
    if (alive) alivePids.add(record.pid)
    // 已死的 pid 顺手清缓存，缓存尺寸随注册表收缩。
    else startedAtCache.delete(record.pid)
  }
  const starts = options.startedAt === undefined
    ? processStartTimes([...alivePids], { maxCacheMs: options.maxCacheMs ?? 0 })
    : options.startedAt([...alivePids])
  return records.map(record =>
    ({ record, identity: classify(record, aliveByRecord.get(record) === true, starts.get(record.pid)) }))
}

/**
 * 将已保存列表拆分为仍存活和已失效记录。`recycled` 与 `gone` 一样移除，避免后续操作触碰已经属于其他进程的 pid。
 * 身份随结果一起返回——reconcile 已经判定过一次，调用方不得再问一遍（那正是
 * 曾经让每次对账付出 2N 次探针的重复）。
 * @param services - 已保存记录。
 * @param identifyFn - 注入的判定函数。
 * @returns 存活记录（带身份）及带原因的丢弃记录。
 */
export function reconcile(
  services: ServiceRecord[],
  identifyFn: (record: ServiceRecord) => Identity,
): { live: IdentityEntry[]; dropped: { record: ServiceRecord; reason: Identity }[] } {
  const identified = services.map(record => ({ record, identity: identifyFn(record) }))
  return reconcileIdentified(identified)
}

/**
 * 对已判定的条目做存活/丢弃拆分；`identifyBatch` 与单条 `identify` 的结果共用这一个出口。
 * @param entries - 记录 + 身份的原子列表。
 * @returns 存活条目及带原因的丢弃记录。
 */
export function reconcileIdentified(entries: readonly IdentityEntry[]): {
  live: IdentityEntry[]
  dropped: { record: ServiceRecord; reason: Identity }[]
} {
  const live: IdentityEntry[] = []
  const dropped: { record: ServiceRecord; reason: Identity }[] = []
  for (const entry of entries) {
    if (entry.identity === 'ours' || entry.identity === 'unknown') live.push(entry)
    else dropped.push({ record: entry.record, reason: entry.identity })
  }
  return { live, dropped }
}

/**
 * 将完整 {@link Identity} 收窄为 wire 对外报告的身份。
 * @param identity - 内部判定。
 * @returns 对外报告的 confidence。
 */
export function reportedIdentity(identity: Identity): ServiceIdentity {
  return identity === 'ours' ? 'ours' : 'unknown'
}
