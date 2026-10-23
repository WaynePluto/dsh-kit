/** services 页面的共享类型；这里不包含状态逻辑或浏览器副作用。 */

import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ServiceActionResult, ServiceLogsResult, ServicesSnapshot } from '../shared.js'

/** 本插件注入自身 registration 的内容。 */
export interface ServicesActions {
  /**
   * 向 Host 请求刚 reconciliation 的全局 snapshot。
   * anchor 是当前会话 id（可能没有）：只影响「当前工作区排前」与外来源徽标，缺省时 Host 不排序。
   */
  onList: (anchorSessionId: string | undefined) => Promise<ServicesSnapshot>
  /** 请求 Host 停止一个服务。 */
  onStop: (name: string) => Promise<ServiceActionResult>
  /** 请求 Host 使用记录的命令重启一个服务；门控按注入时提供的锚点会话判定。 */
  onRestart: (name: string) => Promise<ServiceActionResult>
  /** 向 Host 请求一个服务的日志 tail。 */
  onLogs: (name: string) => Promise<ServiceLogsResult>
  /** 读取当前主会话 id；全局面板没有会话绑定，排序锚点在每次轮询时现取。 */
  currentSessionId: () => string | undefined
}

/** 页面 entry 的组合 props：框架 runtime share + 注入的 Host 操作 + locale seat。 */
export type ServicesPageProps =
  PropsRuntime<'main'>
  & Partial<ServicesActions>
  & PropsLocale<'dsh-plugin-services'>

/** 一行的临时状态。 */
export type Busy = 'stop' | 'restart' | undefined
