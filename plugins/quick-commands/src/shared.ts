/**
 * 两半共享的 contract：RPC channel、endpoint、wire shape 和纯校验/归一函数。
 * 本模块同时编译到 Host 与 browser，不能导入 `node:*` 或 dsh package；
 * 文件系统逻辑只在 `./store.ts`（宿主半），浏览器不会加载。
 *
 * @module @dsh-kit/dsh-plugin-quick-commands/shared
 */

/**
 * 本插件的 identity；RPC channel 与文案 namespace 都从包名后缀派生，
 * 因此单一字符串是名称的唯一来源。
 */
export const SELF_NAMESPACE = 'dsh-plugin-quick-commands'

/**
 * Host 注册、页面调用的 kit 通道。浏览器经官方 `/api` 共享桥 POST `/api/quick-commands`
 * （kit 信封 `{ endpoint, payload }`，D16，见 packages/plugin-rpc）。
 */
export const CHANNEL = '/quick-commands'

/** 本 channel 提供的全部 endpoint。 */
export const ENDPOINTS = ['get', 'put'] as const

/** 一个 endpoint 名称。 */
export type Endpoint = typeof ENDPOINTS[number]

/**
 * 判断解码后的 endpoint 是否属于本 channel。
 * @param endpoint - 相对 channel 的 endpoint 名称。
 * @returns 本插件是否提供该 endpoint。
 */
export function isQuickCommandsEndpoint(endpoint: string): endpoint is Endpoint {
  return (ENDPOINTS as readonly string[]).includes(endpoint)
}

/** 本 channel 不提供 endpoint 时的错误码。 */
export const UNKNOWN_ENDPOINT_CODE = 'quick-commands/unknown-endpoint'

/** payload 不满足 endpoint contract 时的错误码。 */
export const BAD_PAYLOAD_CODE = 'quick-commands/bad-payload'

/** Host 侧意外抛错时的错误码。 */
export const INTERNAL_CODE = 'quick-commands/internal'

/** 一条快捷指令。 */
export interface QuickCommand {
  readonly id: string
  /** 指令正文；点击该条时插入输入框光标位置。 */
  readonly text: string
  /** ISO-8601 创建时间。 */
  readonly createdAt: string
  /** ISO-8601 最后修改时间。 */
  readonly updatedAt: string
}

/** 指令文档；整份读、整份写。 */
export interface QuickCommandDocument {
  readonly version: 1
  readonly commands: readonly QuickCommand[]
}

// ── 有界上限：写路径与 RPC payload 都不许无界增长 ──────────────────────────

/** 指令条数上限。 */
export const MAX_COMMANDS = 100

/** 单条指令文本长度上限（UTF-16 code unit）。 */
export const MAX_COMMAND_TEXT_LENGTH = 2000

/** `get` 的返回：整份文档（文件缺失时为空文档，见 `loadOrEmpty`）。 */
export type QuickCommandsGetResult = QuickCommandDocument

/** `put` 的 payload：整份文档原文写回。 */
export interface QuickCommandsPutPayload {
  readonly document: QuickCommandDocument
}

/** `put` 的返回：写盘后的条数摘要，供面板诊断。 */
export interface QuickCommandsPutResult {
  readonly commands: number
}

/** 空文档；首次使用（文件不存在）时面板看到的就是它。 */
export function emptyDocument(): QuickCommandDocument {
  return { version: 1, commands: [] }
}

/**
 * 判断解码后的 `put` payload 是否良构（`{ document }` 且文档全量良构）。
 * @param value - 解码后的 payload。
 */
export function isPutPayload(value: unknown): value is QuickCommandsPutPayload {
  if (value === null || typeof value !== 'object') return false
  return isQuickCommandDocument((value as Partial<QuickCommandsPutPayload>).document)
}

function isCommand(value: unknown): value is QuickCommand {
  if (value === null || typeof value !== 'object') return false
  const command = value as Partial<QuickCommand>
  return typeof command.id === 'string' && command.id !== ''
    && typeof command.text === 'string'
    && typeof command.createdAt === 'string'
    && typeof command.updatedAt === 'string'
}

/**
 * 判断一个值是否是完整良构的指令文档（`put` 的写盘前提）。
 * 结构良构之外还要求全部有界上限满足；越界写入按 bad payload 拒绝，
 * 而不是静默裁剪——面板是唯一写方，越界说明面板逻辑出了 bug。
 * @param value - 待校验值。
 */
export function isQuickCommandDocument(value: unknown): value is QuickCommandDocument {
  if (value === null || typeof value !== 'object') return false
  const document = value as Partial<QuickCommandDocument>
  if (document.version !== 1 || !Array.isArray(document.commands)) return false
  if (document.commands.length > MAX_COMMANDS) return false
  return document.commands.every(command =>
    isCommand(command) && command.text.length <= MAX_COMMAND_TEXT_LENGTH)
}

/**
 * 宽容读取：磁盘上的历史文档可能字段不全或轻微越界，逐条丢弃坏行并按上限裁剪，
 * 而不是把整个文档判死。重复 id 的指令保留首个（id 是 React key 与编辑地址）。
 * @param value - 解析后的 JSON 值。
 * @returns 可用的指令文档；完全不可读时返回空文档。
 */
export function normalizeDocument(value: unknown): QuickCommandDocument {
  if (value === null || typeof value !== 'object') return emptyDocument()
  const raw = value as Partial<QuickCommandDocument>
  if (!Array.isArray(raw.commands)) return emptyDocument()
  const commands: QuickCommand[] = []
  const seen = new Set<string>()
  for (const candidate of raw.commands) {
    if (commands.length >= MAX_COMMANDS) break
    if (!isCommand(candidate) || seen.has(candidate.id)) continue
    seen.add(candidate.id)
    commands.push({ ...candidate, text: candidate.text.slice(0, MAX_COMMAND_TEXT_LENGTH) })
  }
  return { version: 1, commands }
}

/** 指令文本的提交前清洗：去首尾空白、按上限截断。 */
export function cleanCommandText(text: string): string {
  return text.trim().slice(0, MAX_COMMAND_TEXT_LENGTH)
}
