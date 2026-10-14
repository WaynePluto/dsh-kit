/** 只读会话工作区 files 插件的宿主半。 */
import type { Context } from '@deepseek-ai/cordis'
// 仅类型：激活本插件使用的 session/connection Context merge。
import type {} from '@deepseek-ai/dsh-agent'
// 仅类型：激活本插件使用的 session/connection Context merge。
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { ConnectionRpcResult } from '@deepseek-ai/dsh-client-connection'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { gitSnapshot } from './git.js'
import { gitFileDiff, gitReview } from './gitReview.js'
import {
  BAD_PAYLOAD_CODE, CHANNEL, ENDPOINTS, IO_CODE, SESSION_ID_MAX_LENGTH, SESSION_NOT_FOUND_CODE,
  UNKNOWN_ENDPOINT_CODE, isSafeWorkspacePath,
  type FilesSnapshot, type GitFileDiff, type GitReviewSummary, type GitSnapshot,
} from './shared.js'
export * from './git.js'
export * from './gitReview.js'
export * from './shared.js'
export const name = 'dsh-kit-files'
export const inject = ['connection', 'webServer', 'agents']

export class FilesError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'FilesError'
  }
}
interface AgentLike {
  readonly session?: { readonly header?: { readonly cwd?: string } }
}
interface DispatchDependencies {
  readonly git: (cwd: string) => Promise<GitSnapshot>
  readonly review: (cwd: string) => Promise<GitReviewSummary>
  readonly fileDiff: (cwd: string, path: string) => Promise<GitFileDiff>
}
const DEFAULT_DEPENDENCIES: DispatchDependencies = {
  git: gitSnapshot,
  review: cwd => gitReview(cwd),
  fileDiff: (cwd, path) => gitFileDiff(cwd, path),
}
type RpcValue = FilesSnapshot | GitReviewSummary | GitFileDiff
type RpcResult = ConnectionRpcResult<RpcValue>
function failure(code: string, message: string): RpcResult {
  return { ok: false, error: { code, message, details: {} } }
}
function sessionIdOf(payload: unknown): string | undefined {
  if (payload === null || typeof payload !== 'object') return undefined
  const value = (payload as { sessionId?: unknown }).sessionId
  return typeof value === 'string' && value.length > 0 && value.length <= SESSION_ID_MAX_LENGTH && !value.includes('\0')
    ? value
    : undefined
}

/** diff 端点的工作区相对 slash 路径；与 Git 数据同一份规范化约束。 */
function reviewPathOf(payload: unknown): string | undefined {
  if (payload === null || typeof payload !== 'object') return undefined
  const value = (payload as { path?: unknown }).path
  return typeof value === 'string' && isSafeWorkspacePath(value) ? value : undefined
}
/** Host half：校验 session workspace，并提供 files RPC。 */
export function sessionWorkspace(ctx: Context, sessionId: string): string {
  const agent = ctx.agents.get(sessionId as SessionId) as AgentLike | undefined
  const cwd = agent?.session?.header?.cwd
  if (typeof cwd !== 'string' || cwd.length === 0) {
    throw new FilesError(SESSION_NOT_FOUND_CODE, `session has no active workspace: ${sessionId}`)
  }
  return cwd
}
/** 分发一个已解码的私有通道请求。 */
export async function dispatch(
  ctx: Context,
  endpoint: string,
  payload: unknown,
  dependencies: DispatchDependencies = DEFAULT_DEPENDENCIES,
): Promise<RpcResult> {
  if (!(ENDPOINTS as readonly string[]).includes(endpoint)) {
    return failure(UNKNOWN_ENDPOINT_CODE, `unknown endpoint: ${endpoint}`)
  }
  const sessionId = sessionIdOf(payload)
  if (sessionId === undefined) return failure(BAD_PAYLOAD_CODE, 'request requires a non-empty sessionId')
  // diff 的路径先于 agents 校验：畸形路径不触碰会话表。
  if (endpoint === 'diff') {
    const path = reviewPathOf(payload)
    if (path === undefined) return failure(BAD_PAYLOAD_CODE, 'diff requires a canonical workspace-relative path')
    try {
      const cwd = sessionWorkspace(ctx, sessionId)
      return { ok: true, value: await dependencies.fileDiff(cwd, path) }
    } catch (error: unknown) {
      if (error instanceof FilesError) return failure(error.code, error.message)
      return failure(IO_CODE, error instanceof Error ? error.message : String(error))
    }
  }
  try {
    const cwd = sessionWorkspace(ctx, sessionId)
    if (endpoint === 'snapshot') {
      const git = await dependencies.git(cwd)
      return { ok: true, value: { workspacePath: cwd, git } }
    }
    if (endpoint === 'review') {
      return { ok: true, value: await dependencies.review(cwd) }
    }
    return failure(UNKNOWN_ENDPOINT_CODE, `unknown endpoint: ${endpoint}`)
  } catch (error: unknown) {
    if (error instanceof FilesError) return failure(error.code, error.message)
    return failure(IO_CODE, error instanceof Error ? error.message : String(error))
  }
}
/** 在 `/files/snapshot` 上挂载 Git 快照端点。 */
export function apply(ctx: Context): void {
  const dispose = ctx.connection.rpc.handle(
    CHANNEL,
    async (endpoint: string, payload: unknown) => await dispatch(ctx, endpoint, payload),
  )
  ctx.effect(() => () => { void dispose() }, 'files: read-only workspace channel')
}




