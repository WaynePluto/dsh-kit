/** browser half：在 `conversation.input.dock` 注册 services panel，并通过 shared RPC channel 调用 Host。 */

import type { Context } from '@deepseek-ai/cordis'
// 仅类型：引入声明本插件读取的 Context service merge。
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
// 仅类型：引入声明本插件使用的 slot 与 sessionId merge。
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { CHANNEL, SELF_NAMESPACE } from '../shared.js'
import type { ServiceActionResult, ServiceLogsResult, ServicesSnapshot } from '../shared.js'
import { ServicesPanel } from './ServicesDock.js'
import type { ServicesDockInjected } from './ServicesDock.js'
import { en, zh } from './locales.js'
import type { ServicesKey } from './locales.js'
import { callKitChannel } from '@dsh-kit/plugin-rpc'

export { POLL_MS, ServicesPanel } from './ServicesDock.js'
export type { ServicesDockInjected, ServicesPanelProps } from './ServicesDock.js'
export type { ServicesKey } from './locales.js'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** 本插件的文案命名空间，与包名后缀一致。 */
    'dsh-plugin-services': ServicesKey
  }
}

/** 本插件的文案 namespace。 */
const NS = SELF_NAMESPACE

/** panel 在 dock 中的 order。 */
const ORDER = 10

/** services dock entry 的组合 props。 */
export type ServicesDockProps =
  PropsRuntime<'conversation.input.dock'>
  & Partial<ServicesDockInjected>
  & PropsLocale<'dsh-plugin-services'>

/** RPC channel 错误。 */
export class ServicesChannelError extends Error {}

/** 将 slot props 转为 ServicesPanel props。 */
export function ServicesDock({ sessionId, onList, onStop, onRestart, onLogs, t }: ServicesDockProps) {
  return (
    <ServicesPanel
      sessionId={sessionId === undefined ? undefined : String(sessionId)}
      actions={{ onList, onStop, onRestart, onLogs } as Partial<ServicesDockInjected>}
      t={t}
    />
  )
}

/** 所需 service：slots、locale 和 connection。 */
export const inject = ['slots', 'locale', 'connection']

/** 注册文案、RPC channel 和 dock slot。 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'services: copy dictionaries')

  /** 调用 `/services/<endpoint>` RPC，并将失败转换为 ServicesChannelError。 */
  const call = async (endpoint: string, payload: object): Promise<unknown> => {
    const result = await callKitChannel(CHANNEL, endpoint, payload)
    if (!result.ok) throw new ServicesChannelError(result.error.message)
    return result.value
  }

  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: SELF_NAMESPACE,
    order: ORDER,
    locale: NS,
    inject: (sessionId): ServicesDockInjected => {
      const id = String(sessionId)
      return {
        onList: async () => await call('list', { sessionId: id }) as ServicesSnapshot,
        onStop: async name => await call('stop', { sessionId: id, name }) as ServiceActionResult,
        onRestart: async name => await call('restart', { sessionId: id, name }) as ServiceActionResult,
        onLogs: async name => await call('logs', { sessionId: id, name }) as ServiceLogsResult,
      }
    },
  }, ServicesDock))
}
