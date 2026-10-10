import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { RemoteRuntimeStatus } from '../contract.js'
import { RemoteSection } from './RemoteSection.js'
import { en, NS, zh } from './locales.js'
import type { RemoteRuntimeKey } from './locales.js'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'dsh-plugin-remote-runtime': RemoteRuntimeKey
  }
}

const ORDER = 57

export const inject = ['slots', 'locale', 'connection']

class RemoteChannelError extends Error {
  constructor(message: string) { super(message); this.name = 'RemoteChannelError' }
}

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'remote-runtime: copy dictionaries')
  const t = ctx.locale.bind(NS)

  const load = async (): Promise<RemoteRuntimeStatus> => {
    const connection = ctx.get('connection') as ConnectionHandle | undefined
    if (connection === undefined) throw new RemoteChannelError('no active connection')
    const result = await connection.rpc.call('/remote-runtime', 'status', {})
    if (!result.ok) throw new RemoteChannelError(result.error.message)
    return result.value as RemoteRuntimeStatus
  }

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: NS,
    order: ORDER,
    label: () => t('nav'),
    locale: NS,
    inject: () => ({ load }),
  }, RemoteSection))
}
