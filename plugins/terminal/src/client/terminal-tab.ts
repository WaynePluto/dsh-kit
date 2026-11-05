/**
 * 交互终端 sidebar tab 的注册定义、关闭二次确认与会话级打开监视器。
 *
 * tab 结构与原生终端一致：`multiple: true`，一个终端一个 chip；guide 入口点击即
 * 为当前会话 spawn 全新终端；关闭 chip = 杀进程（二次确认防误触）。模型 start 出
 * 新终端时 monitor 自动打开对应 tab；终端消失（被模型/用户关闭）时 tab 已随关闭
 * 语义同步消失，不需要抑制逻辑。
 */

import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { TerminalsSnapshot } from '../shared.js'
import type { TerminalTranslate } from './terminal-tab.types.js'

/** 本插件拥有的 tab kind；带包名前缀，不与官方 kind（terminal/files/...）冲突。 */
export const TERMINAL_TAB_KIND = 'dsh-kit-terminal'

/** 本实现 identity，也是 body/title 在 `sidebar.right.pane.tab(.title)` 槽的注册 key。 */
export const TERMINAL_TAB_ID = '@dsh-kit/dsh-plugin-terminal'

/** monitor 的轮询间隔；只做「终端 → tab」的视图收敛，不触碰进程。 */
export const MONITOR_POLL_MS = 5000

/** tab 类型的注册定义；`multiple: true` 让每个终端独立成 chip（每次 open 铸新 contentId）。 */
export function terminalTabDefinition(t: TerminalTranslate, icon: unknown): SidebarRightTabDefinition {
  return {
    id: TERMINAL_TAB_ID,
    kind: TERMINAL_TAB_KIND,
    multiple: true,
    title: () => t('title'),
    keepMounted: true,
    guide: [{
      id: 'new', order: 20,
      title: () => t('guideTitle'), description: () => t('guideDescription'),
      icon: icon as never,
    }],
  }
}

/** 处于 armed 态的 tabId 集合（不可变快照，body 经注入 hooks 订阅）。
 * armed = 居中确认弹窗打开中；由弹窗的按钮解除（确认放行 / 取消撤销），无自动过期。 */
export const armedStore = createSnapshotStore<ReadonlySet<string>>(new Set<string>())

/**
 * 关闭确认的 arm 判定（纯函数，供 close handler 与单测共用）。
 * @param armed - 当前 armed 集合。
 * @param tabId - 被关闭的 tab。
 * @returns `'kill'`（放行关闭并杀进程）或 `'arm'`（否决关闭并打开确认弹窗）。
 */
export function closeArmDecision(armed: ReadonlySet<string>, tabId: string): 'kill' | 'arm' {
  return armed.has(tabId) ? 'kill' : 'arm'
}

/** 进入 armed 态（打开确认弹窗）；解除只由弹窗按钮触发。 */
export function armClose(tabId: string): void {
  const next = new Set(armedStore.getSnapshot())
  next.add(tabId)
  armedStore.set(next)
}

/** 解除 armed 态（弹窗取消、确认放行、tab 消失时调用）。 */
export function disarmClose(tabId: string): void {
  const current = armedStore.getSnapshot()
  if (!current.has(tabId)) return
  const next = new Set(current)
  next.delete(tabId)
  armedStore.set(next)
}

/** 清空全部 armed 态（插件卸载）。 */
export function clearArmed(): void {
  if (armedStore.getSnapshot().size > 0) armedStore.set(new Set<string>())
}

/** monitor 对宿主服务的最小操作面；测试用假实现替换。 */
export interface TerminalMonitorHost {
  /** 当前前台会话；无会话时为 undefined。 */
  currentSessionId: () => string | undefined
  /** 该会话的终端列表。 */
  list: (sessionId: string) => Promise<TerminalsSnapshot>
  /** 当前窗口打开的全部 sidebar tab 元数据。 */
  openTabs: () => readonly { sessionId: string; tabId: string; kind: string }[]
  /** 读一个 tab 绑定的终端 id；未装配或无绑定返回 undefined。 */
  terminalIdOfTab: (sessionId: string, tabId: string) => string | undefined
  /** 为一个终端打开它的 tab（幂等由调用方查重保证）。 */
  openTab: (sessionId: string, terminalId: string) => void
  /** 页面是否可见；不可见时 tick 直接跳过。 */
  documentVisible: () => boolean
}

/**
 * 会话级 tab 打开监视器：模型（或页面）开出终端而它还没有自己的 tab 时，打开该
 * tab。终端被杀 → registry list 消失，对应 tab 已被关闭语义同步移除，无需处理；
 * kill 失败的孤儿终端会被这里重新开出 tab（自愈）。
 */
export class TerminalTabMonitor {
  private timer: ReturnType<typeof setInterval> | undefined
  private inflight: Promise<void> | undefined

  constructor(private readonly host: TerminalMonitorHost) {}

  /** 启动周期轮询；调用方另行在页面恢复可见时补一次 tick。 */
  start(): void {
    if (this.timer !== undefined) return
    this.timer = setInterval(() => { void this.tick() }, MONITOR_POLL_MS)
  }

  /** 停止轮询。 */
  dispose(): void {
    if (this.timer !== undefined) { clearInterval(this.timer); this.timer = undefined }
  }

  /**
   * 执行一次观测与收敛。RPC 失败按短暂 unavailable 处理：跳过本 tick。
   */
  async tick(): Promise<void> {
    if (this.inflight !== undefined) return
    if (!this.host.documentVisible()) return
    const sessionId = this.host.currentSessionId()
    if (sessionId === undefined) return
    const task = (async () => {
      try {
        const snapshotValue = await this.host.list(sessionId)
        this.reconcile(sessionId as SessionId, snapshotValue)
      } catch {
        /* 列表暂不可得；保持现状，下个 tick 重试。 */
      }
    })()
    this.inflight = task
    try { await task } finally { if (this.inflight === task) this.inflight = undefined }
  }

  /** 依据一次成功的 list 观测收敛 tab 状态。 */
  private reconcile(sessionId: SessionId, snapshotValue: TerminalsSnapshot): void {
    const bound = new Set<string>()
    for (const tab of this.host.openTabs()) {
      if (tab.sessionId !== sessionId || tab.kind !== TERMINAL_TAB_KIND) continue
      const terminalId = this.host.terminalIdOfTab(sessionId, tab.tabId)
      if (terminalId !== undefined) bound.add(terminalId)
    }
    for (const terminal of snapshotValue.terminals) {
      if (!bound.has(terminal.id)) this.host.openTab(sessionId, terminal.id)
    }
  }
}

/** 用真实宿主服务装配 monitor；返回 disposer 供 ctx.effect 使用。 */
export function installTerminalMonitor(host: TerminalMonitorHost): () => void {
  const monitor = new TerminalTabMonitor(host)
  monitor.start()
  return () => { monitor.dispose() }
}
