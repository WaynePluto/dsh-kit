/**
 * browser half：注册右侧边栏「交互终端」tab（原生级：一个终端一个 chip、xterm 实时
 * 渲染、键盘直写、关 chip 杀进程），并通过本包 RPC channel 操作 Host PTY。
 *
 * tab 走官方两段式注册（`ctx.sidebarRightTabs` 类型 + `sidebar.right.pane.tab(.title)`
 * body/title）；guide 入口为当前会话 spawn 全新终端；关闭走二次确认（close handler
 * 抛错否决第一次 × 并打开居中确认弹窗，弹窗内确认放行并杀进程）。会话级 monitor 只做
 * 「终端 → tab」的视图收敛。数据通道：一元 kit 调用 + `/api/terminal/stream` 流式响应。
 *
 * @module @dsh-kit/dsh-plugin-terminal/client
 */

import type { Context } from '@deepseek-ai/cordis'
// 仅类型：引入本插件读取的 Context service merge。插件之间禁止 value import（页面冻结 module table 无法解析），service 是协作接缝。
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
// 仅类型：引入声明本插件 locale namespace 的 SlotMap merge。
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { TabId } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { IconApiOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { CHANNEL, SELF_NAMESPACE } from '../shared.js'
import type { TerminalsSnapshot } from '../shared.js'
import {
  TERMINAL_TAB_ID, TERMINAL_TAB_KIND, TerminalTabMonitor,
  armedStore, clearArmed, closeArmDecision, armClose, disarmClose,
  terminalTabDefinition,
} from './terminal-tab.js'
import { TerminalTab, TerminalTabTitle } from './TerminalTab.js'
import { clearBindings, getBinding, removeBinding } from './terminal-bindings.js'
import { TERMINAL_CSS, XTERM_CSS } from './terminal-tab.styles.js'
import { en, zh } from './locales.js'
import type { TerminalKey } from './locales.js'
import type { TerminalTabInjected } from './terminal-tab.types.js'
import { callKitChannel } from '@dsh-kit/plugin-rpc'

export { MONITOR_POLL_MS, TERMINAL_TAB_ID, TERMINAL_TAB_KIND, TerminalTabMonitor, armClose, closeArmDecision, disarmClose, installTerminalMonitor, terminalTabDefinition } from './terminal-tab.js'
export type { TerminalMonitorHost } from './terminal-tab.js'
export { TerminalTab as TerminalTabBody, TerminalTabTitle } from './TerminalTab.js'
export type { TerminalTabBodyProps, TerminalTitleProps } from './TerminalTab.js'
export { clearBindings, getBinding, removeBinding, setBinding } from './terminal-bindings.js'
export { resolveTerminalTheme, terminalOptions } from './terminal-theme.js'
export type { TerminalKey } from './locales.js'
export type { TerminalHostVerbs, TerminalTabInjected } from './terminal-tab.types.js'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** 本插件的文案 namespace，与包名后缀一致。 */
    'dsh-plugin-terminal': TerminalKey
  }
}

/** 本插件拥有的文案 namespace。 */
const NS = SELF_NAMESPACE

/** Host 返回错误时本插件报告的 failure。 */
export class TerminalChannelError extends Error {}

/**
 * 调用本插件 kit 通道的一个 endpoint；经官方 /api 共享桥 POST `/api/terminal`（kit 信封，D16）。
 * @param endpoint - channel-relative endpoint。
 * @param payload - endpoint payload。
 * @returns 解码后的值。
 * @throws 没有 connection 或 Host 失败时抛出 TerminalChannelError。
 */
const call = async (endpoint: string, payload: object): Promise<unknown> => {
  const result = await callKitChannel(CHANNEL, endpoint, payload)
  if (!result.ok) throw new TerminalChannelError(result.error.message)
  return result.value
}

/** 把官方 xterm.css 与插件覆盖样式注入页面（一次）。 */
export function installTerminalStyles(): () => void {
  const style = document.createElement('style')
  style.textContent = XTERM_CSS + TERMINAL_CSS
  document.head.append(style)
  return () => { style.remove() }
}

/** 读一个 tab 绑定的终端 id；tab 未装配或无绑定返回 undefined。
 * 识别顺序：导航 params（monitor/恢复开的 tab）→ bindings（guide 入口的 body 自绑定，
 * 该类 tab 没有 params，漏识别会让 monitor 误开第二个 tab——multiple 模式永不去重）。 */
function terminalIdOfTab(ctx: Context, sessionId: string, tabId: string): string | undefined {
  try {
    const params = ctx.sidebarRight.tabDomain
      .occurrence(sessionId as SessionId, { id: tabId as TabId })
      .navigation.getSnapshot().params
    const terminalId = (params as { terminalId?: unknown } | undefined)?.terminalId
    if (typeof terminalId === 'string') return terminalId
  } catch {
    return undefined
  }
  const contentId = ctx.sidebarRight.openTabs.getSnapshot()
    .find(entry => entry.sessionId === sessionId && entry.tabId === tabId)?.contentId
  return contentId === undefined ? undefined : getBinding(sessionId, contentId)
}

/** 所需 service：`connection` 承载通道，`slots` 是 seat，`locale`/`theme` 提供 tab 文案与主题，
 * `sidebarRight`/`sidebarRightTabs` 承载 tab 注册与打开，`uiSession` 提供 monitor 的当前会话锚点。 */
export const inject = ['slots', 'locale', 'connection', 'sidebarRight', 'sidebarRightTabs', 'uiSession', 'theme']

/** 注册 tab 类型、body/title、关闭确认与会话级打开监视器。
 * @param ctx - client root context。
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'terminal: copy dictionaries')
  ctx.effect(installTerminalStyles, 'terminal: xterm styles')
  const t = ctx.locale.bind(NS)

  ctx.effect(() => ctx.sidebarRightTabs.register(terminalTabDefinition(t, IconApiOutlineRegular)), 'terminal: sidebar tab type')

  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: TERMINAL_TAB_ID,
    locale: NS,
    inject: (sessionId): TerminalTabInjected => ({
      verbs: {
        onSpawn: async () => await call('spawn', { sessionId: String(sessionId) }) as { id: string },
        onWrite: async (terminalId, data) => await call('write', { sessionId: String(sessionId), terminalId, data }),
        onResize: async (terminalId, cols, rows) => await call('resize', { sessionId: String(sessionId), terminalId, cols, rows }),
        onClose: async terminalId => await call('close', { sessionId: String(sessionId), terminalId }),
      },
      hooks: {
        armed: armedStore,
        theme: {
          getSnapshot: () => ctx.theme.getTheme(),
          subscribe: listener => ctx.on('theme/change', listener),
        },
      },
    }),
  }, TerminalTab)), 'terminal: sidebar tab body')

  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab.title',
    key: TERMINAL_TAB_ID,
    locale: NS,
  }, TerminalTabTitle)), 'terminal: sidebar tab title')

  // 关闭 = 杀进程，二次确认防误触：第一次 × 进入 armed 并抛错否决（官方契约：handler
  // 抛错则 tab 保留），body 据 armed 打开居中确认弹窗；弹窗确认放行并杀进程，取消撤销。
  // 未绑定终端的壳 tab 直接放行。
  ctx.effect(() => ctx.sidebarRight.registerCloseHandler(TERMINAL_TAB_KIND, (sessionId, tab) => {
    const sid = String(sessionId)
    const terminalId = getBinding(sid, tab.contentId)
    if (terminalId === undefined) return
    if (closeArmDecision(armedStore.getSnapshot(), tab.id) === 'arm') {
      armClose(tab.id)
      throw new Error('terminal close needs confirmation')
    }
    disarmClose(tab.id)
    removeBinding(sid, tab.contentId)
    void call('close', { sessionId: sid, terminalId }).catch(() => undefined)
  }), 'terminal: close confirm')

  ctx.effect(() => {
    const monitor = new TerminalTabMonitor({
      currentSessionId: () => {
        const key = ctx.uiSession.adapter.current.getSnapshot().key
        return key === undefined ? undefined : String(key)
      },
      list: async sessionId => await call('list', { sessionId }) as TerminalsSnapshot,
      openTabs: () => ctx.sidebarRight.openTabs.getSnapshot(),
      terminalIdOfTab: (sessionId, tabId) => terminalIdOfTab(ctx, sessionId, tabId),
      openTab: (sessionId, terminalId) => {
        try {
          ctx.sidebarRight.openTabIn(sessionId as SessionId, TERMINAL_TAB_KIND, { params: { terminalId } })
        } catch (error) {
          console.warn('terminal: failed to open tab for new terminal', error)
        }
      },
      documentVisible: () => document.visibilityState !== 'hidden',
    })
    monitor.start()
    // 页面恢复可见时立即补一次；隐藏期间 tick 自行跳过，不发 RPC。
    const onVisibility = (): void => {
      if (document.visibilityState !== 'hidden') void monitor.tick()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      monitor.dispose()
    }
  }, 'terminal: sidebar tab monitor')

  ctx.effect(() => () => {
    clearArmed()
    clearBindings()
  }, 'terminal: client state')
}
