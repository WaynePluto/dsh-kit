/**
 * tab ↔ 终端 的持久绑定：localStorage 按 (sessionId, contentId) 记录 Host 终端身份。
 *
 * `multiple: true` 的 page tab 每次打开都铸造全新 contentId（布局记录持久保留），
 * 但导航 params 不随布局恢复——重载后 body 靠这里的绑定找回自己的终端
 * （官方 ui-sidebar-terminal 的 TerminalBindings 同款机制，key 前缀换成插件自有命名空间）。
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** 终端 id 的合法形状（与 registry 铸造的 `pty-N` 及防御校验一致）。 */
const ID_PATTERN = /^[\w-]{1,128}$/u

const PREFIX = 'dsh-plugin-terminal.binding.v1.'

const memory = new Map<string, string>()

/** 绑定键。 */
function key(sessionId: string, contentId: string): string {
  return PREFIX + JSON.stringify([sessionId, contentId])
}

/**
 * 读一个绑定；localStorage 不可用时退回内存（本窗口有效）。
 * @param sessionId - 所属会话。
 * @param contentId - tab 的 contentId（布局记录持久保留）。
 * @returns 已绑定的终端 id。
 */
export function getBinding(sessionId: SessionId | string, contentId: string): string | undefined {
  const fullKey = key(String(sessionId), contentId)
  const known = memory.get(fullKey)
  if (known !== undefined) return known
  if (typeof localStorage === 'undefined') return undefined
  try {
    const raw = localStorage.getItem(fullKey)
    if (raw === null) return undefined
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'string' || !ID_PATTERN.test(parsed)) return undefined
    memory.set(fullKey, parsed)
    return parsed
  } catch {
    return undefined
  }
}

/**
 * 在分配/换绑终端时写入绑定（先写后连，重载才找得回）。
 * @param sessionId - 所属会话。
 * @param contentId - tab 的 contentId。
 * @param terminalId - 终端 id。
 */
export function setBinding(sessionId: SessionId | string, contentId: string, terminalId: string): void {
  const fullKey = key(String(sessionId), contentId)
  memory.set(fullKey, terminalId)
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(fullKey, JSON.stringify(terminalId))
  } catch (error) {
    console.error('terminal binding persist failed:', error)
  }
}

/**
 * 删除一个绑定（终端被杀后清理）。
 * @param sessionId - 所属会话。
 * @param contentId - tab 的 contentId。
 */
export function removeBinding(sessionId: SessionId | string, contentId: string): void {
  const fullKey = key(String(sessionId), contentId)
  memory.delete(fullKey)
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.removeItem(fullKey)
  } catch {
    /* 存储不可用；内存已清。 */
  }
}

/** 清空内存缓存（插件卸载）。 */
export function clearBindings(): void {
  memory.clear()
}
