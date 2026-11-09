import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionRpcResult } from '@deepseek-ai/dsh-client-connection'
import { Buffer } from 'node:buffer'
import { NOTES } from './notes.js'
import {
  BAD_PAYLOAD_CODE, INTERNAL_CODE, MAX_WRITE_BYTES, UNKNOWN_ENDPOINT_CODE,
  isCloseRequest, isListRequest, isResizeRequest, isTerminalEndpoint, isWriteRequest,
} from './shared.js'
import type {
  ListRequest, TerminalCloseRequest, TerminalOpResult, TerminalResizeRequest, TerminalWriteRequest,
} from './shared.js'
import { agentOf, snapshot } from './terminal-runtime.js'
import type { TerminalTapRegistry } from './terminal-tap.js'

/** kit 信封的统一失败结果。 */
function failure(code: string, message: string): ConnectionRpcResult<never> {
  return { ok: false, error: { code, message, details: {} } }
}

/** 一元操作的业务失败（ok:false 且带一句可展示文案）。 */
function refused(message: string): { ok: false, message: string } {
  return { ok: false, message }
}

/** 校验 terminal channel 的 endpoint 与 payload，再分发到 registry / tap。 */
export async function dispatch(
  ctx: Context,
  endpoint: string,
  payload: unknown,
  taps: TerminalTapRegistry,
  backendType: string,
): Promise<ConnectionRpcResult<unknown>> {
  if (!isTerminalEndpoint(endpoint)) {
    return failure(UNKNOWN_ENDPOINT_CODE, `unknown endpoint "${endpoint}"`)
  }
  const wellFormed = endpoint === 'list' || endpoint === 'spawn'
    ? isListRequest(payload)
    : endpoint === 'write'
      ? isWriteRequest(payload)
      : endpoint === 'resize'
        ? isResizeRequest(payload)
        : isCloseRequest(payload)
  if (!wellFormed) {
    return failure(BAD_PAYLOAD_CODE, `"${endpoint}" payload is malformed`)
  }
  try {
    if (endpoint === 'list') {
      return { ok: true, value: snapshot(ctx, (payload as ListRequest).sessionId) }
    }
    if (endpoint === 'spawn') {
      return { ok: true, value: await spawnTerminal(ctx, payload as ListRequest, taps, backendType) }
    }
    const request = payload as TerminalWriteRequest & TerminalResizeRequest & TerminalCloseRequest
    if (endpoint === 'write') return { ok: true, value: await writeTerminal(ctx, request, taps) }
    if (endpoint === 'resize') return { ok: true, value: await resizeTerminal(request, taps) }
    return { ok: true, value: await closeTerminal(ctx, request, taps) }
  } catch (error: unknown) {
    return failure(INTERNAL_CODE, error instanceof Error ? error.message : String(error))
  }
}

/** 为当前会话新开一个交互终端；走与模型完全相同的 backend 路径（沙箱围栏一致）。 */
async function spawnTerminal(
  ctx: Context,
  request: ListRequest,
  taps: TerminalTapRegistry,
  backendType: string,
): Promise<{ id: string } | { ok: false, message: string }> {
  const terminals = ctx.get('terminals')
  if (terminals === undefined) return refused(NOTES.noService)
  const owner = agentOf(ctx, request.sessionId)
  if (owner === undefined) return refused(NOTES.noAgent)
  const result = await terminals.spawn(owner, { type: backendType })
  // tap 登记发生在 backend.spawn 内；spawn 成功即已绑定。
  void taps
  return { id: String(result.sessionId) }
}

/** 把一段键盘输入直接写进 PTY。 */
async function writeTerminal(
  ctx: Context,
  request: TerminalWriteRequest,
  taps: TerminalTapRegistry,
): Promise<TerminalOpResult> {
  const owner = agentOf(ctx, request.sessionId)
  if (owner === undefined) return refused(NOTES.noAgent)
  const entry = taps.entryOf(request.terminalId)
  if (entry === undefined) return refused(NOTES.noTerminal)
  if (entry.exited) return refused(NOTES.terminalExited)
  if (Buffer.byteLength(request.data, 'utf8') > MAX_WRITE_BYTES) {
    return refused(NOTES.tooLong(MAX_WRITE_BYTES))
  }
  await entry.handle.write(request.data)
  return { ok: true }
}

/** PTY 尺寸跟随面板。 */
async function resizeTerminal(
  request: TerminalResizeRequest,
  taps: TerminalTapRegistry,
): Promise<TerminalOpResult> {
  const entry = taps.entryOf(request.terminalId)
  if (entry === undefined) return refused(NOTES.noTerminal)
  if (entry.exited) return refused(NOTES.terminalExited)
  await entry.handle.resize(request.cols, request.rows)
  // 几何与 PTY 同步前移：size 帧（重连重放）以它为准，停留 spawn 值会让重放错位。
  taps.setGeometry(request.terminalId, { cols: request.cols, rows: request.rows })
  return { ok: true }
}

/** 杀掉一个终端并从 registry 移除；顺带清 tap 记录。 */
async function closeTerminal(
  ctx: Context,
  request: TerminalCloseRequest,
  taps: TerminalTapRegistry,
): Promise<TerminalOpResult> {
  const terminals = ctx.get('terminals')
  if (terminals === undefined) return refused(NOTES.noService)
  const owner = agentOf(ctx, request.sessionId)
  if (owner === undefined) return refused(NOTES.noAgent)
  const killed = await terminals.kill(owner, request.terminalId as Parameters<typeof terminals.kill>[1], 'user closed terminal')
  taps.remove(request.terminalId)
  return killed ? { ok: true } : refused(NOTES.noTerminal)
}
