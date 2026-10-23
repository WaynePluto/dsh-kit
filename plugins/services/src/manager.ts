/**
 * services 的操作层：registry reconciliation、启动/停止/重启和日志读取都在此实现一次。
 * tools 与浏览器 panel 只是这些函数的两种入口；每次入口都先把 registry 与 OS 状态对齐。
 * registry 以 dsh home 为作用域，服务名在整台部署内全局唯一；
 * 跨工作区的 stop/restart/logs 都按名称直接寻址，来源项目只影响展示与日志发现顺序。
 *
 * @module @dsh-kit/dsh-plugin-services/manager
 */

import fs from 'node:fs'
import {
  claimLegacyRegistry, findExistingLog, identifyBatch, isPidAlive, killTree, listLegacyLogNames,
  listLogNames, logPath, readRegistry, reconcileIdentified, reportedIdentity, startProcess,
  tailFile, unionRoots, waitForReady, withRegistryLock, writeRegistry,
} from './core.js'
import type { Identity, IdentityEntry, ServiceRecord } from './core.js'
import { DEFAULT_LOG_LINES, MAX_LOG_LINES, isValidName } from './shared.js'
import type { ServiceActionResult, ServiceLogsResult, ServiceView, ServicesSnapshot } from './shared.js'

/** 默认就绪 deadline（毫秒）。 */
export const DEFAULT_READY_TIMEOUT_MS = 8000

/** 调用方提供的就绪 deadline 上限。 */
export const MAX_READY_TIMEOUT_MS = 120_000

/**
 * 面板轮询（snapshot）允许复用的创建时间缓存窗口：覆盖数个 5 秒轮询周期，
 * 把宿主事件循环上的同步探针从每轮一次降到每窗口一次。只影响展示；
 * stop/restart 的身份判定始终现查（缓存命中无法排除 pid 回收窗口）。
 */
export const SNAPSHOT_IDENTITY_CACHE_MS = 20_000

/** 测试注入的 probe，用于替代真实 OS。 */
export interface ManagerDeps {
  identify?: (record: ServiceRecord) => Identity
  now?: () => number
  /** 终止进程树；mock 测试注入记录器，避免真的杀 pid。 */
  kill?: (pid: number) => void
}

/** {@link refresh} 的探针选项。 */
export interface RefreshOptions {
  /**
   * 身份探针允许复用的创建时间缓存窗口（毫秒）；0（默认）始终现查。
   * 只有展示路径（snapshot）传窗口；stop/restart 必须现查。
   */
  identityCacheMs?: number
}

/**
 * 将已保存 registry 与 OS 对齐，并持久化修复结果。读取、判定与写回在同一个锁内完成。
 * 真实路径按批判定：存活逐条 signal 0 现查（实时、微秒级），创建时间一次子进程全取；
 * 每条记录只判定一次——判定结果随条目透传，不再二次询问。
 * @param home - dsh home（全局 registry 所在）。
 * @param deps - 注入的 probe。
 * @param options - 探针选项（缓存窗口）。
 * @returns 仍存活的记录及各自的身份判定。
 */
export function refresh(
  home: string,
  deps: ManagerDeps = {},
  options: RefreshOptions = {},
): IdentityEntry[] {
  return withRegistryLock(home, () => {
    const registry = readRegistry(home)
    const identifyFn = deps.identify
    const identified = identifyFn === undefined
      ? identifyBatch(registry.services, { maxCacheMs: options.identityCacheMs ?? 0 })
      : registry.services.map(record => ({ record, identity: identifyFn(record) }))
    const { live, dropped } = reconcileIdentified(identified)
    if (dropped.length > 0) writeRegistry(home, { ...registry, services: live.map(entry => entry.record) })
    return live
  })
}

/**
 * 将一条 registry 记录投影为 wire shape。
 * @param record - 已保存记录。
 * @param identity - 当前身份判定。
 * @returns 页面渲染的 view。
 */
function toView(record: ServiceRecord, identity: Identity): ServiceView {
  return {
    name: record.name,
    command: record.command,
    cwd: record.cwd,
    root: record.root,
    pid: record.pid,
    startedAt: record.startedAt,
    logFile: record.logFile,
    ...record.port === undefined ? {} : { port: record.port },
    identity: reportedIdentity(identity),
  }
}

/** {@link snapshot} 的可见性选项。 */
export interface SnapshotOptions {
  /** 发起调用的会话项目目录；没有 live agent 时为 null。 */
  cwd: string | null
  /** true 时返回整台部署的全部存活服务（面板与 `service_list scope:"all"`）；默认只看本工作区。 */
  all?: boolean
}

/**
 * 日志发现的候选目录：会话项目最优先，其余按 registry 的 roots 索引。
 * 只用于回捞 D17 前留在项目内的旧版日志；现行日志都在 home 日志目录。
 * @param home - dsh home。
 * @param cwd - 会话项目目录；可为 null。
 * @returns 去重后的候选列表，会话目录居首。
 */
function discoveryRoots(home: string, cwd: string | null): string[] {
  const roots = readRegistry(home).roots
  if (cwd === null) return roots
  return [cwd, ...roots.filter(root => root !== cwd)]
}

/**
 * 构造 panel 与 `service_list` 共用的 snapshot。all 模式下当前工作区的服务排在最前，其余保持注册顺序。
 * 已停止日志提示合并两个来源：home 日志目录（现行）与 roots 索引下的旧项目日志（D17 前存量）。
 * @param home - dsh home。
 * @param options - 会话项目目录与可见范围。
 * @param deps - 注入的 probe。
 * @returns 存活服务、可读的已停止日志和 Host 时钟。
 */
export function snapshot(home: string, options: SnapshotOptions, deps: ManagerDeps = {}): ServicesSnapshot {
  const cwd = options.cwd
  if (cwd !== null) claimLegacyRegistry(cwd, home)
  // 展示路径允许短缓存：把每 5 秒轮询的同步探针降到每窗口一次；
  // 死亡判定仍逐条实时（signal 0），缓存只作用于存活 pid 的创建时间。
  const live = refresh(home, deps, { identityCacheMs: SNAPSHOT_IDENTITY_CACHE_MS })
  const visible = options.all === true
    ? live.toSorted((a, b) => Number(b.record.root === cwd) - Number(a.record.root === cwd))
    : live.filter(entry => entry.record.root === cwd)
  const running = new Set(live.map(entry => entry.record.name))
  const stoppedLogs = [
    ...new Set([
      ...listLogNames(home),
      ...discoveryRoots(home, cwd).flatMap(root => listLegacyLogNames(root)),
    ]),
  ].filter(name => !running.has(name)).toSorted()
  return {
    cwd,
    services: visible.map(entry => toView(entry.record, entry.identity)),
    stoppedLogs,
    now: (deps.now ?? Date.now)(),
  }
}

/**
 * 按名称查找一条存活记录；名称在整台部署内唯一，跨工作区寻址不需要目录。
 * @param live - reconciliation 后的记录。
 * @param name - 服务名称。
 * @returns 匹配项；没有时返回 undefined。
 */
function find(
  live: { record: ServiceRecord; identity: Identity }[],
  name: string,
): { record: ServiceRecord; identity: Identity } | undefined {
  return live.find(entry => entry.record.name === name)
}

/**
 * 停止一个服务并从 registry 移除。无法确认 pid 仍属于该服务时返回拒绝结果而不是抛错，避免误杀其他进程树。
 * @param home - dsh home。
 * @param name - 要停止的服务。
 * @param deps - 注入的 probe。
 * @returns 是否停止成功及展示文案。
 */
export function stopService(home: string, name: string, deps: ManagerDeps = {}): ServiceActionResult {
  const kill = deps.kill ?? killTree
  const live = refresh(home, deps)
  const entry = find(live, name)
  if (entry === undefined) return { ok: false, message: `没有名为 ${name} 的运行中服务` }

  if (entry.identity === 'unknown') {
    const manual = process.platform === 'win32'
      ? `taskkill /PID ${String(entry.record.pid)} /T /F`
      : `kill -- -${String(entry.record.pid)}`
    return {
      ok: false,
      message: `无法确认 pid ${String(entry.record.pid)} 仍是 ${name} 本身（读不到进程创建时间），已放弃自动停止。`
        + `\n确认无误后手动结束：${manual}`,
    }
  }

  kill(entry.record.pid)
  withRegistryLock(home, () => {
    const registry = readRegistry(home)
    writeRegistry(home, { ...registry, services: registry.services.filter(item => item.name !== name) })
  })
  return { ok: true, message: `${name} 已停止（pid ${String(entry.record.pid)}）` }
}

/** {@link startService} 接受的全部请求字段。 */
export interface StartRequest {
  /** dsh home：全局 registry 与日志所在。 */
  home: string
  name: string
  command: string
  /**
   * 拥有该服务的项目目录（启动它的会话工作区）：面板来源徽标与重启归属。
   * 日志在 {@link home}，与此处无关；仍须与命令运行的 {@link cwd} 分开以标记归属工作区。
   */
  root: string
  /** 命令运行的工作目录；可以不同于 {@link root}。 */
  cwd: string
  port?: number
  readyLog?: string
  readyTimeoutMs?: number
  shell?: string
}

/** 一次启动尝试的结果。 */
export interface StartResult {
  ok: boolean
  message: string
  /** 实际 spawn 进程后，就绪等待的结束状态。 */
  outcome?: 'ready' | 'timeout' | 'exited'
  /** 启动后仍存活时的 registry 行。 */
  record?: ServiceRecord
}

/** 同名服务已存在（可能是本机任何工作区启动的）时的拒绝文案。 */
function duplicateMessage(name: string, owner: string): string {
  return `${name} 已在运行（属于项目 ${owner}）；要换命令请先 service_stop，或用 service_restart`
}

/**
 * 启动一个服务并等待其看起来已就绪。启动期间退出的进程会先从 registry 移除，避免后续操作把不存在的服务当成存活。
 * 名称在整台部署内全局唯一：spawn 前后各查一次重名，写入时在锁内复核——两个窗口同时用同名启动时，
 * 后写入者会杀掉自己刚拉起的进程并如实报告，而不是留下两行同名记录。
 * @param request - 名称、命令、目录和 probe 配置。
 * @param deps - 注入的 probe。
 * @returns 等待结果及合并日志 tail 的文案。
 */
export async function startService(request: StartRequest, deps: ManagerDeps = {}): Promise<StartResult> {
  const kill = deps.kill ?? killTree
  if (!isValidName(request.name)) {
    return { ok: false, message: `服务名 ${request.name} 不合法：只允许字母、数字、点、下划线和连字符，且不超过 64 字符` }
  }
  const home = request.home
  claimLegacyRegistry(request.root, home)
  const existing = find(refresh(home, deps), request.name)
  if (existing !== undefined) {
    return { ok: false, message: duplicateMessage(request.name, existing.record.root) }
  }

  // Windows pid handoff 或命令 spawn 可能失败；这是启动失败结果，不应作为异常冒泡，调用方需要可展示的句子。
  let record
  try {
    record = await startProcess({
      name: request.name,
      command: request.command,
      home: request.home,
      root: request.root,
      cwd: request.cwd,
      ...request.port === undefined ? {} : { port: request.port },
      ...request.shell === undefined ? {} : { shell: request.shell },
    })
  } catch (error: unknown) {
    return {
      ok: false,
      message: `${request.name} 没能启动：${error instanceof Error ? error.message : String(error)}`,
    }
  }
  // 锁内重读复核：spawn 期间（Windows pid handoff 最长 15 秒）另一个窗口可能已写入同名服务。
  const collision = withRegistryLock(home, () => {
    const registry = readRegistry(home)
    const clash = registry.services.find(item => item.name === request.name)
    if (clash === undefined) {
      writeRegistry(home, {
        ...registry,
        services: [...registry.services, record],
        roots: unionRoots(registry.roots, request.root),
      })
    }
    return clash
  })
  if (collision !== undefined) {
    kill(record.pid)
    return { ok: false, message: duplicateMessage(request.name, collision.root) }
  }

  const timeoutMs = Math.min(request.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS, MAX_READY_TIMEOUT_MS)
  const outcome = await waitForReady(record, {
    ...request.port === undefined ? {} : { port: request.port },
    ...request.readyLog === undefined ? {} : { readyLog: request.readyLog },
    timeoutMs,
  })
  const tail = tailFile(record.logFile, DEFAULT_LOG_LINES)

  if (outcome === 'exited') {
    withRegistryLock(home, () => {
      const registry = readRegistry(home)
      writeRegistry(home, {
        ...registry,
        services: registry.services.filter(item => item.name !== request.name),
      })
    })
    return {
      ok: false,
      outcome,
      message: `${request.name} 启动后立即退出。日志（${record.logFile}）:\n${tail}`,
    }
  }

  const head = outcome === 'ready'
    ? `${request.name} 已启动，pid ${String(record.pid)}`
    : `${request.name} 已启动（pid ${String(record.pid)}），但在超时前未确认就绪，请自行判断下面的日志`
  return {
    ok: true,
    outcome,
    record,
    message: [head, `日志 ${record.logFile}`, tail].join('\n'),
  }
}

/**
 * 使用启动时记录的命令停止并重新启动服务——可以在任何工作区发起，命令与目录都从记录重放。
 * 重放 stored command 可保证 panel 的“重启”不会意外改变实际执行内容；
 * 是否允许发起仍由调用方会话自己的沙箱门控决定（见 index.ts 的 gateSpawn）。
 * @param home - dsh home。
 * @param name - 服务名称。
 * @param readyTimeoutMs - 可选的就绪 deadline。
 * @param deps - 注入的 probe。
 * @returns 是否重新启动成功及展示文案。
 */
export async function restartService(
  home: string,
  name: string,
  readyTimeoutMs?: number,
  deps: ManagerDeps = {},
): Promise<ServiceActionResult> {
  const previous = find(refresh(home, deps), name)?.record
  if (previous === undefined) return { ok: false, message: `没有名为 ${name} 的运行中服务` }

  const stopped = stopService(home, name, deps)
  // 拒绝终止时必须中止重启：第一份服务可能仍占用 port，启动第二份比不操作更危险。
  if (!stopped.ok) return { ok: false, message: `重启中止：${stopped.message}` }

  const started = await startService({
    home,
    name: previous.name,
    command: previous.command,
    root: previous.root,
    // 从记录重放命令自身目录，因此在子包启动的服务会回到同一子包。
    cwd: previous.cwd,
    ...previous.port === undefined ? {} : { port: previous.port },
    ...previous.shell === undefined ? {} : { shell: previous.shell },
    ...readyTimeoutMs === undefined ? {} : { readyTimeoutMs },
  }, deps)
  return { ok: started.ok, message: started.message }
}

/**
 * 读取一个服务的日志 tail；服务已退出时仍可用，这正是最需要日志判断退出原因的时刻。
 * 记录在 registry 中的服务直接用记录的绝对路径（迁移前启动的服务仍指向项目内旧文件）；
 * 已停止的按「home 日志目录 → 会话项目与 roots 索引的旧版项目日志」顺序回捞。
 * 只读注册表与 signal 0 存活检查，不做全量对账——日志不需要逐 pid 的创建时间，
 * 打开弹窗不应为其他服务的身份判定付出子进程探针的钱。
 * @param home - dsh home。
 * @param cwd - 会话项目目录；没有 live agent 时为 null。
 * @param name - 服务名称。
 * @param lines - 末尾行数，截到 {@link MAX_LOG_LINES}。
 * @param deps - 注入的 probe。
 * @returns 日志路径、tail 和运行状态。
 */
export function logsOf(
  home: string,
  cwd: string | null,
  name: string,
  lines: number = DEFAULT_LOG_LINES,
  deps: ManagerDeps = {},
): ServiceLogsResult {
  const record = readRegistry(home).services.find(item => item.name === name)
  const canonical = logPath(home, name)
  const file = record?.logFile
    ?? (existsFile(canonical) ? canonical : findExistingLog(discoveryRoots(home, cwd), name))
    ?? canonical
  // running 是展示提示而非安全判定：注册表有记录且 pid 仍在即可；失效记录由下一次 snapshot 对账清理。
  const running = record !== undefined
    && (deps.identify !== undefined ? deps.identify(record) !== 'gone' : isPidAlive(record.pid))
  return {
    file,
    tail: tailFile(file, Math.min(Math.max(lines, 1), MAX_LOG_LINES)),
    running,
  }
}

/** 文件存在且是普通文件。 */
function existsFile(file: string): boolean {
  try {
    return fs.statSync(file).isFile()
  } catch {
    return false
  }
}

/**
 * 面向模型的 snapshot 文本。已停止服务按名称单独列出，因为读取日志是唯一剩余操作且需要名称。
 * 其他工作区的服务带来源目录标注，模型在排查端口占用时能直接定位项目。
 * @param value - 要描述的 snapshot。
 * @returns 紧凑的多行报告。
 */
export function formatSnapshot(value: ServicesSnapshot): string {
  const staleLine = value.stoppedLogs.length === 0
    ? []
    : [`已停止但日志可读：${value.stoppedLogs.join('、')}`]
  if (value.services.length === 0) {
    return ['没有正在运行的服务', ...staleLine].join('\n')
  }
  const rows = value.services.map((service) => {
    const parts = [service.name]
    if (service.port !== undefined) parts.push(`:${String(service.port)}`)
    parts.push(`pid ${String(service.pid)}`)
    if (service.identity === 'unknown') parts.push('(身份待确认)')
    if (value.cwd !== null && service.root !== value.cwd) parts.push(`项目 ${service.root}`)
    parts.push(service.command)
    return `  ${parts.join('  ')}\n    日志 ${service.logFile}`
  })
  return [
    `运行中 ${String(value.services.length)} 个服务：`,
    ...rows,
    ...staleLine,
  ].join('\n')
}
