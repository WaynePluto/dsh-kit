/**
 * 两半共享的 terminal contract：RPC channel、端点、wire shape、流式帧协议与纯校验函数。
 *
 * 浏览器与 PTY 之间的数据通道是两条：
 * - kit 通道（`POST /api/terminal`，kit 信封）承载 list/spawn/write/resize/close 等一元调用；
 * - 流式路由（`POST /api/terminal/stream`，精确 fetch 路由）承载 PTY 原始字节：
 *   请求体 `{ sessionId }`，响应体为换行分隔的 JSON 帧（{@link StreamFrame}），
 *   首帧重放 ring，随后实时帧；进程退出发 exit 帧后流结束。
 *   官方 /api 桥对响应体做增量写入 + 背压（http-bridge），流式响应是一等支持。
 *
 * @module @dsh-kit/dsh-plugin-terminal/shared
 */

/** 本插件 identity；RPC channel、文案 namespace 和 tab 注册 key 都由 package suffix 派生。 */
export const SELF_NAMESPACE = 'dsh-plugin-terminal'

/**
 * 本插件的一元 kit 通道。浏览器经官方 `/api` 共享桥 POST `/api/terminal`
 * （kit 信封 `{ endpoint, payload }`，D16，见 packages/plugin-rpc）。
 */
export const CHANNEL = '/terminal'

/** 流式路由在 /api 之下的精确路径；浏览器请求 `/api${STREAM_PATH}`。 */
export const STREAM_PATH = '/terminal/stream'

/** 本 kit 通道提供的 endpoint。没有 read/send/interrupt：读屏是模型工具的事，
 * 键盘与 Ctrl+C 直接进 PTY（页面不再有表单输入）。 */
export const ENDPOINTS = ['list', 'spawn', 'write', 'resize', 'close'] as const

/** 一个 endpoint 名称。 */
export type Endpoint = typeof ENDPOINTS[number]

/**
 * 判断解码后的 endpoint 是否属于本 channel。
 * @param endpoint - 相对 channel 的 endpoint 名称。
 * @returns 本插件是否提供它。
 */
export function isTerminalEndpoint(endpoint: string): endpoint is Endpoint {
  return (ENDPOINTS as readonly string[]).includes(endpoint)
}

/** 本 channel 不提供 endpoint 时的错误码。 */
export const UNKNOWN_ENDPOINT_CODE = 'terminal/unknown-endpoint'

/** payload 不满足 endpoint contract 时的错误码。 */
export const BAD_PAYLOAD_CODE = 'terminal/bad-payload'

/** Host 侧意外抛错时的错误码。 */
export const INTERNAL_CODE = 'terminal/internal'

/** 页面没有显示内容的原因。 */
export type TerminalsUnavailable =
  /** `ctx.terminals` 未挂载或仍在等待依赖注入。 */
  | 'no-service'
  /** session 没有 live agent，因此不拥有 terminal。 */
  | 'no-agent'

/** 页面看到的一项 live PTY session。 */
export interface TerminalView {
  /** service 生成的 session id（`pty-1`、`pty-2`、…）。 */
  id: string
  /** owner 本地显示名；`interactive_terminal` start action 提供时存在。 */
  name?: string
  /** 创建 session 时使用的 backend type（`shell`）。 */
  type: string
  /** 顶层 shell 是否仍在运行。 */
  running: boolean
  /** 顶层 shell 退出后的 exit code。 */
  exitCode?: number | null
}

/** 一次 `list` 调用报告的全部内容。 */
export interface TerminalsSnapshot {
  /** 本 conversation agent 拥有的 live sessions，按发布顺序排列。 */
  terminals: TerminalView[]
  /** 没有内容可显示时才存在，说明具体的 unavailable 原因。 */
  unavailable?: TerminalsUnavailable
  /** Host 构造 snapshot 时的时钟，供页面计算本地经过时间。 */
  now: number
}

/** `list` 的 payload。 */
export interface ListRequest {
  /** agent 拥有 terminal 的 conversation。 */
  sessionId: string
}

/** 流式 attach 的 payload：会话内一个终端的原始字节流。 */
export interface StreamAttachRequest extends ListRequest {
  /** 目标 PTY session id。 */
  terminalId: string
}

/** `spawn` 的 payload：为当前会话新开一个交互终端（guide 入口），走与模型相同的 backend 路径。 */
export type SpawnRequest = ListRequest

/** `spawn` 的结果。 */
export interface TerminalSpawnView {
  /** 新终端的 session id。 */
  id: string
}

/** `write` 的 payload：把一段键盘输入直接写进 PTY（不经过模型 send 的互斥与等待）。 */
export interface TerminalWriteRequest extends ListRequest {
  /** 目标 PTY session id。 */
  terminalId: string
  /** 要写入的 UTF-8 文本（键击、粘贴、控制字符原样）。 */
  data: string
}

/** `resize` 的 payload：PTY 尺寸跟随面板。 */
export interface TerminalResizeRequest extends ListRequest {
  /** 目标 PTY session id。 */
  terminalId: string
  cols: number
  rows: number
}

/** `close` 的 payload：杀掉一个终端（进程树）并从 registry 移除。 */
export interface TerminalCloseRequest extends ListRequest {
  /** 目标 PTY session id。 */
  terminalId: string
}

/** 一元调用结果：成功无载荷，失败带一句可直接展示的文案。 */
export interface TerminalOpResult {
  ok: boolean
  message?: string
}

/** 单次键盘写入的字节数上限（UTF-8）。 */
export const MAX_WRITE_BYTES = 64 * 1024

/**
 * PTY 宿主的平台语义。Windows ConPTY 在每次 PTY resize 后会全屏重绘，客户端 resize
 * 网格前必须先清屏（否则 xterm reflow 的旧内容与重绘叠加，错位/输入行重复）；POSIX
 * 的 tty 只发 SIGWINCH 不重绘，保留 reflow。
 */
export type TerminalPlatform = 'windows' | 'posix'

/** resize 允许的最大列数（对齐上游 terminal 上限）。 */
export const MAX_COLS = 500

/** resize 允许的最大行数。 */
export const MAX_ROWS = 200

/**
 * 判断解码后的 payload 是否携带 session id。
 * @param value - browser payload。
 * @returns 是否满足 {@link ListRequest}。
 */
export function isListRequest(value: unknown): value is ListRequest {
  return typeof value === 'object' && value !== null
    && typeof (value as ListRequest).sessionId === 'string'
    && (value as ListRequest).sessionId.length > 0
}

/**
 * 判断解码后的 payload 是否满足流式 attach 契约（会话 + 终端双 id）。
 * @param value - browser payload。
 * @returns 是否满足 {@link StreamAttachRequest}。
 */
export function isStreamAttachRequest(value: unknown): value is StreamAttachRequest {
  return hasTerminalId(value)
}

/**
 * 判断 payload 是否携带合法的 terminalId。
 * @param value - browser payload。
 * @returns 是否带非空 terminalId 字符串。
 */
function hasTerminalId(value: unknown): value is ListRequest & { terminalId: string } {
  return isListRequest(value)
    && typeof (value as { terminalId?: unknown }).terminalId === 'string'
    && ((value as unknown as { terminalId: string }).terminalId.length > 0)
}

/**
 * 判断解码后的 payload 是否满足 `write` 契约。
 * @param value - browser payload。
 * @returns 是否满足 {@link TerminalWriteRequest}。
 */
export function isWriteRequest(value: unknown): value is TerminalWriteRequest {
  if (!hasTerminalId(value)) return false
  const request = value as TerminalWriteRequest
  return typeof request.data === 'string' && request.data.length > 0
}

/**
 * 判断解码后的 payload 是否满足 `resize` 契约。
 * @param value - browser payload。
 * @returns 是否满足 {@link TerminalResizeRequest}。
 */
export function isResizeRequest(value: unknown): value is TerminalResizeRequest {
  if (!hasTerminalId(value)) return false
  const request = value as TerminalResizeRequest
  return typeof request.cols === 'number' && Number.isSafeInteger(request.cols)
    && request.cols >= 2 && request.cols <= MAX_COLS
    && typeof request.rows === 'number' && Number.isSafeInteger(request.rows)
    && request.rows >= 1 && request.rows <= MAX_ROWS
}

/**
 * 判断解码后的 payload 是否满足 `close` 契约。
 * @param value - browser payload。
 * @returns 是否满足 {@link TerminalCloseRequest}。
 */
export function isCloseRequest(value: unknown): value is TerminalCloseRequest {
  return hasTerminalId(value)
}

/**
 * 流式响应里的一帧。字节以 base64 承载，边界逐帧保留，部分 UTF-8 序列由 xterm 内部解码器拼接。
 * 帧序：`size`（PTY 当前几何 + 平台语义，重放前按它建画面，避免 160 列字节错位重放进窄面板）→
 * `ring`（重放）→ `live`（重放结束标记，此后客户端才 fit + resize PTY）→ `data`/`exit`。
 */
export type StreamFrame =
  | { readonly t: 'size'; readonly cols: number; readonly rows: number; readonly platform: TerminalPlatform }
  | { readonly t: 'ring'; readonly b64: string }
  | { readonly t: 'live' }
  | { readonly t: 'data'; readonly b64: string }
  | { readonly t: 'exit'; readonly code: number | null }

/**
 * 把一帧编码成一行 wire 文本（含结尾换行）。
 * @param frame - 要发送的帧。
 * @returns 一行 JSON + '\n'。
 */
export function encodeStreamFrame(frame: StreamFrame): string {
  return `${JSON.stringify(frame)}\n`
}

/**
 * 解码一行 wire 文本；空行或非本协议的行返回 undefined（容忍脏数据而不炸流）。
 * @param line - 不含结尾换行的一行。
 * @returns 解码后的帧。
 */
export function decodeStreamFrame(line: string): StreamFrame | undefined {
  if (line.length === 0) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const frame = parsed as Record<string, unknown>
  if (frame.t === 'size') {
    const cols = frame.cols
    const rows = frame.rows
    const platform = frame.platform
    if (typeof cols !== 'number' || !Number.isSafeInteger(cols) || cols < 2
      || typeof rows !== 'number' || !Number.isSafeInteger(rows) || rows < 1) return undefined
    // platform 缺省按 POSIX 处理（不清屏，与既有行为一致），容忍旧宿主。
    return {
      t: 'size', cols, rows,
      platform: platform === 'windows' ? 'windows' : 'posix',
    }
  }
  if (frame.t === 'live') return { t: 'live' }
  if (frame.t === 'ring' || frame.t === 'data') {
    return typeof frame.b64 === 'string' ? { t: frame.t, b64: frame.b64 } : undefined
  }
  if (frame.t === 'exit') {
    return (frame.code === null || typeof frame.code === 'number')
      ? { t: 'exit', code: frame.code }
      : undefined
  }
  return undefined
}
