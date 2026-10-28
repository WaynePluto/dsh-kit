/** 套件详情页配置区：当前版本、检查更新按钮与升级地址复制提示。 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Button, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { fill } from './locales.js'
import type { LocaleKey } from './locales.js'

/** 槽位注入：绑定的文案函数。 */
export interface SuiteUpdatesInjected {
  readonly t: (key: LocaleKey, values?: Readonly<Record<string, string | number>>) => string
}

/** 一次检查调用交给卡片的最小结果面（kit 信封的 value/error）。 */
export interface SuiteUpdatesApi {
  /** 发起一次检查；传输失败抛 Error。 */
  check: () => Promise<
    { ok: true; value: { readonly current: string; readonly latest: string; readonly hasUpdate: boolean; readonly url: string } }
    | { ok: false; error: { readonly code: string; readonly message: string } }
  >
}

type Phase = 'checking' | 'latest' | 'update' | 'error'

export function SuiteUpdatesCard({ t, api }: SuiteUpdatesInjected & { readonly api: SuiteUpdatesApi }): ReactNode {
  const [phase, setPhase] = useState<Phase>('checking')
  const [current, setCurrent] = useState('')
  const [latest, setLatest] = useState('')
  const [url, setUrl] = useState('')
  const [copied, setCopied] = useState(false)
  const [detail, setDetail] = useState('')
  const [busy, setBusy] = useState(false)
  // 自动检查只跑一次；组件随详情页重挂载时 useEffect 依赖 api 保持稳定（宿主 inject 工厂每次渲染重建时
  // 由 slots 层缓存注入对象，这里以 ref 兜底避免重复请求）。
  const requested = useRef(false)

  const runCheck = useCallback(async (automatic: boolean) => {
    if (automatic && requested.current) return
    requested.current = true
    setBusy(true)
    setDetail('')
    try {
      const result = await api.check()
      if (result.ok) {
        setCurrent(result.value.current)
        setLatest(result.value.latest)
        setUrl(result.value.url)
        if (result.value.hasUpdate) {
          // 发现新版本时直接把升级地址放上剪贴板；失败不阻塞，提示里给完整地址。
          setCopied(await writeClipboard(result.value.url))
          setPhase('update')
        } else {
          setPhase('latest')
        }
      } else {
        setDetail(result.error.message)
        setPhase('error')
      }
    } catch (error) {
      setDetail(error instanceof Error ? error.message : String(error))
      setPhase('error')
    } finally {
      setBusy(false)
    }
  }, [api])

  useEffect(() => {
    void runCheck(true)
  }, [runCheck])

  const onCheck = useCallback(() => {
    if (busy) return
    void runCheck(false)
  }, [busy, runCheck])

  let status: string
  let hint: { readonly kind: 'info' | 'error'; readonly text: ReactNode } | undefined
  if (phase === 'checking') {
    status = t('checking')
  } else {
    status = fill(t('currentVersion'), { version: current })
    if (phase === 'latest') {
      hint = { kind: 'info', text: t('upToDate') }
    } else if (phase === 'update') {
      hint = {
        kind: 'info',
        text: copied
          ? `${fill(t('foundUpdate'), { version: latest })} ${t('copiedHint')}`
          : `${fill(t('foundUpdate'), { version: latest })} ${fill(t('copyFailed'), { url })}`,
      }
    } else {
      hint = { kind: 'error', text: fill(t('checkFailed'), { detail }) }
    }
  }

  return (
    <div className="dsh-suite-updates">
      <div className="dsh-suite-updates-row">
        <div className="dsh-suite-updates-main">
          <span className="dsh-suite-updates-title">{t('title')}</span>
          <span className="dsh-suite-updates-status">{status}</span>
        </div>
        <span className="dsh-suite-updates-action">
          <Button size="sm" disabled={busy} onClick={onCheck}>{t('check')}</Button>
        </span>
      </div>
      {hint !== undefined
        ? <p className={hint.kind === 'error' ? 'dsh-suite-updates-error' : 'dsh-suite-updates-hint'} role={hint.kind === 'error' ? 'alert' : 'status'}>{hint.text}</p>
        : null}
    </div>
  )
}
