/** 插件管理页 → 本 Bundle 详情页的配置区：官方网页搜索行的状态与启停开关。 */

import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import { restartHintActive } from '../shared.js'
import type { WebSearchState } from '../shared.js'
import type { WebSearchController } from './controller.js'
import { fill } from './locales.js'
import type { LocaleKey } from './locales.js'

/** 槽位注入：绑定的文案函数与远程控制器。 */
export interface WebSearchSwitchInjected {
  readonly t: (key: LocaleKey, values?: Readonly<Record<string, string | number>>) => string
  readonly controller: WebSearchController
}

type Phase = 'loading' | 'settled' | 'read-error'

/** 一次写入后需要保留到生效为止的提示。 */
interface Notice {
  readonly kind: 'error' | 'info'
  readonly text: string
}

export function WebSearchSwitchCard({ t, controller }: WebSearchSwitchInjected): ReactNode {
  const [phase, setPhase] = useState<Phase>('loading')
  const [state, setState] = useState<WebSearchState>({ kind: 'unsupported' })
  const [readError, setReadError] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice>()
  const [pendingRestart, setPendingRestart] = useState<{ readonly enabled: boolean }>()

  const absorb = useCallback((outcome: Awaited<ReturnType<WebSearchController['read']>>) => {
    if (outcome.kind === 'error') {
      setPhase('read-error')
      setReadError(outcome.detail)
      return
    }
    setPhase('settled')
    setState(outcome.state)
    // 状态已经追上写入目标（或行已不可用）时撤下重启提示，其余情况保留。
    setPendingRestart(previous => (restartHintActive(previous, outcome.state) ? previous : undefined))
  }, [])

  useEffect(() => {
    void controller.read().then(absorb)
  }, [controller, absorb])

  const onToggle = useCallback((next: boolean) => {
    if (state.kind !== 'ready' || busy) return
    setBusy(true)
    setNotice(undefined)
    void (async () => {
      const outcome = await controller.setEnabled(state.entryId, next)
      setBusy(false)
      if (outcome.kind === 'restart-required') setPendingRestart({ enabled: outcome.enabled })
      else if (outcome.kind === 'applied') setPendingRestart(undefined)
      else if (outcome.kind === 'overridden') setNotice({ kind: 'info', text: t('hintOverridden') })
      else if (outcome.kind === 'failed') {
        const text = outcome.detail !== undefined && outcome.detail !== ''
          ? t('writeFailed', { detail: outcome.detail })
          : t('writeFailedCode', { code: outcome.code ?? 'unknown' })
        setNotice({ kind: 'error', text })
      }
      // unchanged 不提示；写入后重读，让状态行与重启提示立即对齐。
      absorb(await controller.read())
    })()
  }, [state, busy, controller, t, absorb])

  let status: string
  let toggle: ReactNode = null
  if (phase === 'loading') {
    status = t('loading')
  } else if (phase === 'read-error') {
    return (
      <div className="dsh-web-search-switch">
        <p className="dsh-web-search-switch-error" role="alert">{fill(t('readFailed'), { detail: readError })}</p>
      </div>
    )
  } else if (state.kind === 'unsupported') {
    status = t('unsupported')
  } else if (state.kind === 'unavailable') {
    status = t('unavailable')
  } else {
    status = state.enabled ? t('statusOn') : t('statusOff')
    const locked = state.kind === 'locked'
    toggle = (
      <Switch
        className="dsh-web-search-switch-toggle"
        checked={state.enabled}
        label={t('title')}
        disabled={busy || locked}
        {...locked ? { title: state.reason === 'management-required' ? t('lockedManagement') : t('lockedUnaddressable') } : {}}
        onChange={onToggle}
      />
    )
  }

  const showRestartHint = phase === 'settled' && restartHintActive(pendingRestart, state)
  return (
    <div className="dsh-web-search-switch">
      <div className="dsh-web-search-switch-row">
        <div className="dsh-web-search-switch-main">
          <span className="dsh-web-search-switch-title">{t('title')}</span>
          <span className="dsh-web-search-switch-status">{status}</span>
        </div>
        {toggle}
      </div>
      {showRestartHint ? <p className="dsh-web-search-switch-hint" role="status">{t('hintRestart')}</p> : null}
      {notice !== undefined
        ? <p className={notice.kind === 'error' ? 'dsh-web-search-switch-error' : 'dsh-web-search-switch-hint'} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.text}</p>
        : null}
    </div>
  )
}
