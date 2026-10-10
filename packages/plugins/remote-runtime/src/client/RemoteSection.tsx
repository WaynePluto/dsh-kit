import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { Button, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { RemoteRuntimeStatus } from '../contract.js'
import type { RemoteRuntimeKey } from './locales.js'

export interface RemoteSectionInjected {
  load: () => Promise<RemoteRuntimeStatus>
}

export type RemoteSectionProps = Partial<RemoteSectionInjected> & {
  t?: (key: RemoteRuntimeKey) => string
}

const page: CSSProperties = { display: 'flex', flexDirection: 'column', gap: '16px', fontSize: '13px' }

const intro: CSSProperties = { display: 'flex', flexDirection: 'column', gap: '4px' }

const note: CSSProperties = {
  margin: 0,
  color: 'var(--dsw-alias-label-secondary, #6b7280)',
}

const row: CSSProperties = { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }

const label: CSSProperties = { fontWeight: 600, minWidth: '88px' }

const mono: CSSProperties = {
  fontFamily: 'var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
  wordBreak: 'break-all',
}

const statusStyle = (running: boolean): CSSProperties => ({
  color: running
    ? 'var(--dsw-alias-state-success-primary, #16a34a)'
    : 'var(--dsw-alias-label-tertiary, #9ca3af)',
})

/** 设置页「远程」分区：本机远程运行时状态、入口地址与管理页入口。 */
export function RemoteSection({ load, t }: RemoteSectionProps): ReactNode {
  const [status, setStatus] = useState<RemoteRuntimeStatus | undefined>()
  const [failed, setFailed] = useState(false)
  const [copied, setCopied] = useState(false)

  const refresh = useCallback((): void => {
    if (load === undefined) return
    setFailed(false)
    void (async () => {
      try {
        setStatus(await load())
      } catch {
        setFailed(true)
      }
    })()
  }, [load])

  useEffect(() => { refresh() }, [refresh])

  const translate = t ?? ((key: RemoteRuntimeKey): string => key)
  const copyEntry = useCallback(async (): Promise<void> => {
    const address = status?.entryUrl
    if (address === undefined) return
    if (await writeClipboard(address)) {
      setCopied(true)
      setTimeout(() => { setCopied(false) }, 1500)
    }
  }, [status])

  return (
    <div style={page}>
      <div style={intro}>
        <p style={note}>{translate('intro')}</p>
      </div>
      {failed && <p style={note}>{translate('loadFailed')}</p>}
      <div style={row}>
        <span style={label}>{translate('relayLabel')}</span>
        <span style={statusStyle(status?.relayRunning === true)}>{translate(status?.relayRunning === true ? 'running' : 'stopped')}</span>
        <span style={label}>{translate('connectorLabel')}</span>
        <span style={statusStyle(status?.connectorRunning === true)}>{translate(status?.connectorRunning === true ? 'running' : 'stopped')}</span>
        <Button size="sm" disabled={load === undefined} onClick={refresh}>{translate('refresh')}</Button>
      </div>
      <div style={intro}>
        <span style={label}>{translate('entryLabel')}</span>
        <span style={mono}>{status?.entryUrl ?? '—'}</span>
        <p style={note}>{translate(status?.mode === 'domain' ? 'entryDomainHint' : 'entryLanHint')}</p>
        <div style={row}>
          <Button size="sm" disabled={status === undefined} onClick={() => { void copyEntry() }}>{translate(copied ? 'copied' : 'copy')}</Button>
        </div>
      </div>
      <div style={intro}>
        <span style={label}>{translate('adminLabel')}</span>
        <p style={note}>{translate('adminHint')}</p>
        <div style={row}>
          <Button
            size="sm"
            disabled={status === undefined}
            onClick={() => { if (status !== undefined) window.open(status.adminUrl, '_blank', 'noopener,noreferrer') }}
          >
            {translate('openAdmin')}
          </Button>
        </div>
      </div>
    </div>
  )
}
