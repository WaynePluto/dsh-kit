// remote-runtime 的纯契约与进程编排共享逻辑，无 dsh 依赖、可单测。
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, hostname, networkInterfaces } from 'node:os'
import { dirname, join } from 'node:path'

/** 与 connector/relay 的默认一致（D24：数据目录 ~/.dsh-remote）。 */
export function defaultStationHome(): string {
  return process.env.DSH_REMOTE_HOME ?? join(homedir(), '.dsh-remote')
}

/** 这台机器在 relay 控制台上的名称；与 launcher/connector 的推导保持一致。 */
export function defaultMachineSlug(host: string = hostname()): string {
  const label = host.toLowerCase().replaceAll(/[^a-z0-9-]+/gu, '-').slice(0, 63).replace(/^-+|-+$/gu, '')
  return /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/u.test(label) || /^[a-z0-9]$/u.test(label)
    ? label
    : 'dsh-remote-machine'
}

/** 这台机器的第一个非内部、非 APIPA 的 IPv4 地址。 */
export function lanAddress(): string | undefined {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family !== 'IPv4' || address.internal) continue
      if (address.address.startsWith('169.254.')) continue
      return address.address
    }
  }
  return undefined
}

/** dsh 接受的裸 authority（host 或 host:port）；其余返回 false。 */
export function isBareAuthority(entry: string): boolean {
  try {
    const url = new URL(`http://${entry}`)
    const port = url.port === '' ? new URL(`https://${entry}`).port : url.port
    const canonical = port === '' ? url.hostname : `${url.hostname}:${port}`
    return canonical === entry.toLowerCase()
  } catch {
    return false
  }
}

/** 浏览器可能放进到达这台机器 dsh 的 Host 的全部 authority（launcher trusted-hosts 的移植）。 */
export function trustedAuthorities(options: {
  readonly lanAddress?: string | undefined
  readonly publicAuthority?: string | undefined
  readonly hubAuthority?: string | undefined
}): string[] {
  const values = [
    '127.0.0.1',
    'localhost',
    ...options.lanAddress === undefined ? [] : [options.lanAddress],
    ...options.publicAuthority === undefined ? [] : [options.publicAuthority],
    ...options.hubAuthority === undefined ? [] : [options.hubAuthority],
  ].filter(isBareAuthority)
  return [...new Set(values.map(value => value.toLowerCase()))]
}

/** dsh-remote home 内的插件时代配置；不存在时使用内置默认（局域网模式）。 */
export interface StationRuntimeConfig {
  readonly home: string
  readonly relayPort: number
  readonly domain: string | undefined
}

export function readStationConfig(home: string = defaultStationHome()): StationRuntimeConfig {
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(join(home, 'dsh-remote.config.json'), 'utf8'))
  } catch {
    return { home, relayPort: 30_809, domain: undefined }
  }
  const relay = (raw as { relay?: { port?: unknown, domain?: unknown } }).relay ?? {}
  const port = typeof relay.port === 'number' && Number.isInteger(relay.port) && relay.port >= 1 && relay.port <= 65_535
    ? relay.port
    : 30_809
  const domain = typeof relay.domain === 'string' && relay.domain.trim() !== '' ? relay.domain.toLowerCase() : undefined
  return { home, relayPort: port, domain }
}

/** membership.json 里入口机器面向浏览器的 authority；未加入任何入口时为 undefined。 */
export function hubAuthority(home: string): string | undefined {
  try {
    const membership = JSON.parse(readFileSync(join(home, 'membership.json'), 'utf8')) as {
      hub?: { browserAuthority?: unknown }
    }
    const authority = membership.hub?.browserAuthority
    return typeof authority === 'string' && isBareAuthority(authority) ? authority : undefined
  } catch {
    return undefined
  }
}

/** trust 服务的全部输入集中在此，bootstrap 与测试共用。 */
export function computeTrust(home: string): { authorities: string[] } {
  const config = readStationConfig(home)
  const slug = defaultMachineSlug()
  return {
    authorities: trustedAuthorities({
      lanAddress: config.domain === undefined ? lanAddress() : undefined,
      publicAuthority: config.domain === undefined ? undefined : `${slug}.${config.domain}`,
      hubAuthority: hubAuthority(home),
    }),
  }
}

/** relay/connector 子进程注册表条目。 */
export interface ProcessRecord {
  readonly name: 'relay' | 'connector'
  readonly pid: number
  readonly startedAtMs: number
}

export function processRecordPath(home: string, name: ProcessRecord['name']): string {
  return join(home, 'processes', `${name}.json`)
}

export function readProcessRecord(home: string, name: ProcessRecord['name']): ProcessRecord | undefined {
  try {
    const value = JSON.parse(readFileSync(processRecordPath(home, name), 'utf8')) as Partial<ProcessRecord>
    const { pid, startedAtMs } = value
    if (value.name !== name || typeof pid !== 'number' || !Number.isInteger(pid)
      || typeof startedAtMs !== 'number' || !Number.isSafeInteger(startedAtMs)) {
      return undefined
    }
    return { name, pid, startedAtMs }
  } catch {
    return undefined
  }
}

export function writeProcessRecord(home: string, record: ProcessRecord): void {
  mkdirSync(dirname(processRecordPath(home, record.name)), { recursive: true })
  writeFileSync(processRecordPath(home, record.name), `${JSON.stringify(record)}\n`)
}

/** pid 对应进程是否存活（signal 0 探测）。 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** dsh 登录令牌文件（本插件写，relay 读）；返回 true 表示内容有更新。 */
export function writeTokenFile(home: string, token: string): boolean {
  const path = join(home, 'dsh-token')
  mkdirSync(home, { recursive: true })
  const previous = existsSync(path) ? readFileSync(path, 'utf8').trim() : undefined
  if (previous === token) return false
  writeFileSync(path, `${token}\n`, { mode: 0o600 })
  return true
}

/** 从 authenticatedUrl 中提取裸 token。 */
export function tokenFromAuthenticatedUrl(url: string): string | undefined {
  try {
    const token = new URL(url).searchParams.get('token')
    return typeof token === 'string' && token !== '' ? token : undefined
  } catch {
    return undefined
  }
}

/**
 * 读取（不存在则生成）relay 的 JWT 签名密钥。移植自 launcher 的 jwt-secret：
 * 32 字节随机数的 base64url；文件落在 dsh-remote home。
 */
export function ensureJwtSecret(home: string): string {
  const path = join(home, 'relay-jwt.secret')
  try {
    const existing = readFileSync(path, 'utf8').trim()
    if (existing.length >= 43) return existing
  } catch {
    // 不存在则生成。
  }
  const secret = randomBytes(32).toString('base64url')
  mkdirSync(home, { recursive: true })
  writeFileSync(path, `${secret}\n`, { mode: 0o600 })
  return secret
}
