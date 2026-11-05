/**
 * 交互终端 sidebar tab 的注入面与组件 props 类型。
 *
 * Host verbs 由 registration inject 按会话绑定；tab 元数据（可见性、生命周期、
 * 布局动作）经框架注入的 useTabInfo 读取。
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TerminalKey } from './locales.js'

/** 本插件注入自身 registration 的 Host 操作。 */
export interface TerminalHostVerbs {
  /** 为本会话新开一个终端（guide 入口 / 退出后的新建），走与模型相同的 backend 路径。 */
  onSpawn: () => Promise<{ id: string }>
  /** 把一段键盘输入直接写进 PTY。 */
  onWrite: (terminalId: string, data: string) => Promise<unknown>
  /** 让 PTY 尺寸跟随面板。 */
  onResize: (terminalId: string, cols: number, rows: number) => Promise<unknown>
  /** 杀掉一个终端（进程树）并从 registry 移除。 */
  onClose: (terminalId: string) => Promise<unknown>
}

/** tab 组件使用的 locale 翻译函数。 */
export type TerminalTranslate = (key: TerminalKey) => string

/** registration inject 工厂收到的会话标准面。 */
export interface TerminalInjectInput {
  /** 所属会话。 */
  sessionId: SessionId | undefined
}

/** inject 工厂返回的完整注入面（verbs + armed/theme 两个 observable）。 */
export interface TerminalTabInjected {
  verbs: TerminalHostVerbs
  hooks: {
    /** 处于「确认关闭」 armed 态的 tabId 集合（close handler 与 body 共享）。 */
    armed: {
      getSnapshot: () => ReadonlySet<string>
      subscribe: (listener: () => void) => () => void
    }
    /** dsh 主题快照；变化时 body 重读 token 应用底座四色。 */
    theme: {
      getSnapshot: () => unknown
      subscribe: (listener: () => void) => () => void
    }
  }
}
