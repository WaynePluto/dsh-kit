import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { TerminalSessionSnapshot } from '@deepseek-ai/dsh-terminal'
import type { TerminalsSnapshot, TerminalView } from './shared.js'

/** 解析拥有 terminal 的 live Agent；不从历史 session 重建身份。 */
export function agentOf(ctx: Context, sessionId: string): Agent | undefined {
  return ctx.agents.get(sessionId as SessionId)
}

/** 将 dsh registry snapshot 投影为 wire view。 */
export function toView(entry: TerminalSessionSnapshot): TerminalView {
  const running = entry.status.kind === 'running'
  return {
    id: String(entry.sessionId),
    ...entry.name === undefined ? {} : { name: entry.name },
    type: entry.type,
    running,
    ...running ? {} : { exitCode: entry.status.kind === 'exited' ? entry.status.exitCode : null },
  }
}

/** 返回当前 live Agent 拥有的 terminal 列表。 */
export function snapshot(ctx: Context, sessionId: string, now: number = Date.now()): TerminalsSnapshot {
  const terminals = ctx.get('terminals')
  if (terminals === undefined) return { terminals: [], unavailable: 'no-service', now }
  const owner = agentOf(ctx, sessionId)
  if (owner === undefined) return { terminals: [], unavailable: 'no-agent', now }
  return { terminals: terminals.list(owner).map(toView), now }
}
