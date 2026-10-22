/**
 * Node-only registry：以 `$DSH_HOME` 为作用域保存服务记录，跨工作区可见。
 * 注册表是本 dsh 部署（同一 home、同一用户）内全局唯一的；日志仍留在拥有服务的项目目录。
 * 记录本身不代表进程真实状态，身份核验由 `process-identity.ts` 负责；
 * read-modify-write 由 {@link withRegistryLock} 的 lockfile 串行化（不可重入）。
 *
 * @module @dsh-kit/dsh-plugin-services/registry
 */

import fs from 'node:fs'
import path from 'node:path'

/** 磁盘 registry 中的一行。 */
export interface ServiceRecord {
  /** 全局唯一的名称；也是 registry 主键和日志文件基本名。 */
  name: string
  /** 原样保存，供 `restart` 精确重放启动请求。 */
  command: string
  /** 命令实际运行的工作目录。 */
  cwd: string
  /** 拥有该服务的项目目录（会话启动它的 cwd）：日志所在地、面板的来源徽标。 */
  root: string
  pid: number
  /** 本插件完成 spawn 的时间（epoch ms）；与 OS 报告的创建时间比较以检测 pid 回收。 */
  startedAt: number
  logFile: string
  port?: number
  /** 命令实际运行所用的 shell 可执行文件。 */
  shell?: string
}

/** registry 文档。 */
export interface Registry {
  version: 2
  services: ServiceRecord[]
  /** 已知启动过服务的项目目录；跨工作区的已停止日志发现索引。读取时丢弃已不存在的目录。 */
  roots: string[]
}

/** 当前 registry schema 版本。 */
export const REGISTRY_VERSION = 2

/** lockfile 视为陈旧并被打破的持有时长。 */
const LOCK_STALE_MS = 10_000

/** 等待他人 lockfile 的总预算；超时后按陈旧处理强行接管。 */
const LOCK_WAIT_MS = 5_000

/** 自旋等待的步长。 */
const LOCK_STEP_MS = 20

/**
 * 全局 registry 文件的绝对路径。
 * @param home - dsh home（`$DSH_HOME`，默认 `~/.dsh`）。
 * @returns home 下 `dsh-kit/` 内的 registry 路径；子目录以项目名命名，避免与官方文件冲突。
 */
export function registryPath(home: string): string {
  return path.join(home, 'dsh-kit', 'services.json')
}

/**
 * 读取 registry，容忍文件不存在、损坏或字段不完整；cache 不可读时按空 registry 处理，
 * 避免所有服务被 cache 故障阻塞。roots 顺带丢弃已不存在的目录，索引不随历史无限增长。
 * @param home - dsh home。
 * @returns 解析后的 registry，或空 registry。
 */
export function readRegistry(home: string): Registry {
  try {
    const raw = fs.readFileSync(registryPath(home), 'utf8')
    const parsed = JSON.parse(raw) as Partial<Registry>
    if (!Array.isArray(parsed.services)) return emptyRegistry()
    return {
      version: REGISTRY_VERSION,
      services: parsed.services.filter(isRecord),
      roots: Array.isArray(parsed.roots)
        ? [...new Set(parsed.roots.filter(root => fs.existsSync(root)))]
        : [],
    }
  } catch {
    return emptyRegistry()
  }
}

/** 空 registry。 */
function emptyRegistry(): Registry {
  return { version: REGISTRY_VERSION, services: [], roots: [] }
}

/**
 * 检查一条已保存记录的结构；v2 起必须有 {@link ServiceRecord.root}。
 * @param value - 解析后的数组元素。
 * @returns 是否包含后续操作所需的全部字段。
 */
function isRecord(value: unknown): value is ServiceRecord {
  if (value === null || typeof value !== 'object') return false
  const record = value as Partial<ServiceRecord>
  return typeof record.name === 'string'
    && typeof record.pid === 'number'
    && typeof record.command === 'string'
    && typeof record.cwd === 'string'
    && typeof record.root === 'string'
    && typeof record.startedAt === 'number'
    && typeof record.logFile === 'string'
}

/**
 * 原子替换 registry。先写临时文件再 rename，保证读者不会看到半写入 JSON；
 * 跨进程的 read-modify-write 一致性由 {@link withRegistryLock} 负责。
 * @param home - dsh home。
 * @param registry - 完整的新文档。
 */
export function writeRegistry(home: string, registry: Registry): void {
  const file = registryPath(home)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const payload: Registry = { ...registry, version: REGISTRY_VERSION }
  const temporary = `${file}.${String(process.pid)}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  fs.renameSync(temporary, file)
}

/**
 * 在 lockfile 保护下执行一段 registry read-modify-write。
 * 同一台机器上多个 dsh 窗口会并发写同一个全局文件；`O_EXCL` 创建 lockfile 串行化写入方，
 * 持有超过 {@link LOCK_STALE_MS} 的锁视为宿主崩溃残留而被打破，等待超过 {@link LOCK_WAIT_MS}
 * 也强制接管——丢失一次写入可由 OS reconciliation 自愈，写不进去才是故障。
 * ⚠️ 不可重入：临界区内不得再调用任何会加锁的函数。
 * @param home - dsh home。
 * @param run - 临界区；返回值原样透传。
 * @returns run 的返回值。
 */
export function withRegistryLock<T>(home: string, run: () => T): T {
  const lockFile = `${registryPath(home)}.lock`
  fs.mkdirSync(path.dirname(lockFile), { recursive: true })
  acquireLock(lockFile)
  try {
    return run()
  } finally {
    // 只释放自己持有的锁；这里必然持有（acquire 返回即成功创建）。
    fs.rmSync(lockFile, { force: true })
  }
}

/**
 * 获取 lockfile；已被持有时自旋等待，陈旧或超预算则打破。
 * @param lockFile - lockfile 路径。
 */
function acquireLock(lockFile: string): void {
  const deadline = Date.now() + LOCK_WAIT_MS
  for (;;) {
    try {
      fs.writeFileSync(lockFile, `${String(process.pid)} ${String(Date.now())}\n`, { flag: 'wx' })
      return
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    let heldSince = Number.NaN
    try {
      heldSince = fs.statSync(lockFile).mtimeMs
    } catch {
      // 锁刚被释放；直接重试创建。
      continue
    }
    if (Date.now() - heldSince > LOCK_STALE_MS) {
      // 陈旧锁（持有者崩溃）：打破后立即重试。
      fs.rmSync(lockFile, { force: true })
      continue
    }
    if (Date.now() > deadline) {
      // 等待超预算：强制接管。临界区是毫秒级同步代码，持有超过预算视为已楔死；
      // 打破后先退避一步，避免和刚拿到锁的其他等待者互相连破。
      fs.rmSync(lockFile, { force: true })
      syncSleep(LOCK_STEP_MS)
      continue
    }
    syncSleep(LOCK_STEP_MS)
  }
}

/** 主线程安全的同步休眠；临界区是纯同步代码，不能用异步等待。 */
function syncSleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/**
 * 把 roots 并入去重集合。
 * @param roots - 既有集合。
 * @param root - 新目录。
 * @returns 并集。
 */
export function unionRoots(roots: readonly string[], root: string): string[] {
  return roots.includes(root) ? [...roots] : [...roots, root]
}

/** 旧版（v1，项目内）registry 文件的相对路径。 */
const LEGACY_RELATIVE = path.join('.agents', 'services.json')

/**
 * 惰性认领旧版项目内注册表：工作区首次被打开时把存活记录并入全局 registry 并删除旧文件。
 * 死亡记录一并并入即可——下一次 reconciliation 会按 OS 状态清理；
 * 重名（全局已有同名服务）跳过，以全局为准。文件删除保证只认领一次，重复调用无副作用。
 * @param cwd - 会话项目目录。
 * @param home - dsh home。
 */
export function claimLegacyRegistry(cwd: string, home: string): void {
  const legacyPath = path.join(cwd, LEGACY_RELATIVE)
  let raw: string
  try {
    raw = fs.readFileSync(legacyPath, 'utf8')
  } catch {
    // 没有旧文件是绝大多数情况：v2 安装后的首次启动，或该项目从未用过旧版。
    return
  }
  let incoming: ServiceRecord[] = []
  try {
    const parsed = JSON.parse(raw) as { services?: unknown }
    if (Array.isArray(parsed.services)) {
      incoming = parsed.services
        .filter((value): value is Omit<ServiceRecord, 'root'> => isLegacyRecord(value))
        // v1 记录没有 root；日志与记录都归属它所在的项目。
        .map(record => ({ ...record, root: cwd }))
    }
  } catch {
    // 旧文件损坏：按空认领处理，仍删除文件避免每次打开都重读。
  }
  withRegistryLock(home, () => {
    const registry = readRegistry(home)
    const known = new Set(registry.services.map(record => record.name))
    writeRegistry(home, {
      ...registry,
      services: [...registry.services, ...incoming.filter(record => !known.has(record.name))],
      roots: unionRoots(registry.roots, cwd),
    })
  })
  fs.rmSync(legacyPath, { force: true })
}

/**
 * v1 记录的结构检查（无 root 字段）。
 * @param value - 解析后的数组元素。
 * @returns 是否包含 v1 所需的全部字段。
 */
function isLegacyRecord(value: unknown): value is Omit<ServiceRecord, 'root'> {
  if (value === null || typeof value !== 'object') return false
  const record = value as Partial<ServiceRecord>
  return typeof record.name === 'string'
    && typeof record.pid === 'number'
    && typeof record.command === 'string'
    && typeof record.cwd === 'string'
    && typeof record.startedAt === 'number'
    && typeof record.logFile === 'string'
}
