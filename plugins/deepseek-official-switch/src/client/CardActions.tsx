/** 模型页 provider-card 槽（key = llm-deepseek）：在 deepseek-official 卡片操作区补「删除」按钮。 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ProviderCardExtrasOwnerProps } from '@deepseek-ai/dsh-client-ui-settings-models/client'
import { createPortal } from 'react-dom'
import { PROVIDER_ROUTE, restartHintActive } from '../shared.js'
import type { OfficialRowState } from '../shared.js'
import type { OfficialSwitchController } from './controller.js'
import { fill } from './locales.js'
import type { LocaleKey } from './locales.js'

/** 槽位注入：绑定的文案函数与官方 pluginManager 控制器。 */
export interface CardActionsInjected {
  readonly t: (key: LocaleKey) => string
  readonly controller: OfficialSwitchController
}

/** 渲染器平铺注入面 + 原生卡片事实（provider/configured/keyConfigured）。 */
export type CardActionsProps = ProviderCardExtrasOwnerProps & CardActionsInjected

/** 原生行卡片操作区：li 的第一个 div（rowHead）的最后一个子元素（rowActions span）。 */
export function actionHostOf(card: HTMLElement): HTMLElement | null {
  const head = card.querySelector<HTMLElement>(':scope > div:first-of-type')
  const last = head?.lastElementChild
  return last instanceof HTMLElement && last.tagName === 'SPAN' ? last : null
}

/** 一次写入后需要保留到生效为止的提示。 */
interface Notice {
  readonly kind: 'error' | 'info' | 'status'
  readonly text: string
}

export function DeepSeekOfficialCardActions(props: CardActionsProps): ReactNode {
  const { provider, t, controller } = props
  const anchor = useRef<HTMLSpanElement>(null)
  const [host, setHost] = useState<HTMLElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogError, setDialogError] = useState<string | undefined>(undefined)
  // 行状态与待生效写入都与底部恢复入口共享（同一控制器实例）：任一处读取/写入，
  // 另一方立即跟上——热生效时卡片组件卸载前的重读就是 footer 的更新源。
  const read = useSyncExternalStore(
    controller.rowState.subscribe,
    () => controller.rowState.get(),
    () => controller.rowState.get(),
  )
  const pendingRestart = useSyncExternalStore(
    controller.pending.subscribe,
    () => controller.pending.get(),
    () => controller.pending.get(),
  )
  const [notice, setNotice] = useState<Notice | undefined>(undefined)

  const phase: 'loading' | 'settled' | 'error' = read === undefined
    ? 'loading'
    : read.kind === 'error' ? 'error' : 'settled'
  const state: OfficialRowState = read?.kind === 'state' ? read.state : { kind: 'unsupported' }
  const readError = read?.kind === 'error' ? read.detail : ''

  useEffect(() => { void controller.read() }, [controller])

  // 原生操作区定位：锚点在槽位自己的座位上，向最近的 li 观察重渲染并重扫。
  // 结构不匹配（如首次引导的 setup 卡没有 rowHead）时保持 null，不渲染任何控件。
  useEffect(() => {
    const card = anchor.current?.closest<HTMLElement>('li') ?? null
    if (card === null) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let disposed = false
    const scan = (): void => {
      timer = undefined
      if (disposed) return
      const next = actionHostOf(card)
      setHost(current => current === next ? current : next)
    }
    const schedule = (): void => {
      if (timer !== undefined) return
      timer = setTimeout(scan, 0)
    }
    const observer = new MutationObserver(schedule)
    observer.observe(card, { childList: true, subtree: true })
    scan()
    return () => {
      disposed = true
      if (timer !== undefined) clearTimeout(timer)
      observer.disconnect()
    }
  }, [])

  const onConfirm = useCallback(() => {
    if (state.kind !== 'ready' || busy) return
    setBusy(true)
    setDialogError(undefined)
    void (async () => {
      const outcome = await controller.setEnabled(state.entryId, false)
      setBusy(false)
      if (outcome.kind === 'restart-required') {
        setDialogOpen(false)
        controller.pending.set({ enabled: outcome.enabled })
      } else if (outcome.kind === 'applied') {
        setDialogOpen(false)
        controller.pending.set(undefined)
        setNotice({ kind: 'status', text: t('hintRemoved') })
      } else if (outcome.kind === 'unchanged') {
        setDialogOpen(false)
        controller.pending.set(undefined)
      } else if (outcome.kind === 'overridden') {
        setDialogOpen(false)
        controller.pending.set(undefined)
        setNotice({ kind: 'info', text: t('hintOverridden') })
      } else {
        setDialogError(outcome.detail !== undefined && outcome.detail !== ''
          ? fill(t('writeFailed'), { detail: outcome.detail })
          : fill(t('writeFailedCode'), { code: outcome.code ?? 'unknown' }))
      }
      // 写入后重读共享行状态：热加载生效时行会直接消失，footer 也随之拿到新状态。
      await controller.read()
    })()
  }, [state, busy, controller, t])

  // 契约守卫：只对内置 deepseek-official 卡生效，其他卡片（含同命名空间的未来路由）一概不渲染。
  if (provider.provider !== PROVIDER_ROUTE) return null

  const locked = state.kind === 'locked'
  const removed = phase === 'settled' && state.kind === 'ready' && !state.enabled
  const offerable = phase === 'loading' || (phase === 'settled' && (state.kind === 'ready' ? state.enabled : locked))
  const showRestartHint = phase === 'settled' && restartHintActive(pendingRestart, state)

  const removeButton = offerable && host !== null
    ? createPortal(
      <button
        type="button"
        className="dsh-deepseek-official-switch-remove"
        aria-label={t('removeTitle')}
        disabled={phase !== 'settled' || busy || locked}
        {...locked
          ? { title: state.reason === 'management-required' ? t('lockedManagement') : t('lockedUnaddressable') }
          : {}}
        onClick={() => {
          setDialogError(undefined)
          setDialogOpen(true)
        }}
      >
        {t('remove')}
      </button>,
      host,
      'dsh-deepseek-official-switch-remove',
    )
    : null

  return (
    <>
      <span ref={anchor} data-dsh-deepseek-official-switch-anchor="true" style={{ display: 'none' }} aria-hidden="true">
        {removeButton}
      </span>
      {removed
        ? <p className="dsh-deepseek-official-switch-hint" role="status">{t('disabledPending')}</p>
        : null}
      {showRestartHint
        ? <p className="dsh-deepseek-official-switch-hint" role="status">{t('hintRestart')}</p>
        : null}
      {notice !== undefined
        ? (
          <p
            className={notice.kind === 'error' ? 'dsh-deepseek-official-switch-error' : 'dsh-deepseek-official-switch-hint'}
            role={notice.kind === 'error' ? 'alert' : 'status'}
          >
            {notice.text}
          </p>
        )
        : null}
      {phase === 'error'
        ? <p className="dsh-deepseek-official-switch-error" role="alert">{fill(t('readFailed'), { detail: readError })}</p>
        : null}
      <Modal
        open={dialogOpen}
        onClose={() => { if (!busy) setDialogOpen(false) }}
        title={t('dialogTitle')}
        closeLabel={t('cancel')}
        description={t('dialogDescription')}
        footer={(
          <>
            <Button variant="outline" data-modal-autofocus disabled={busy} onClick={() => { setDialogOpen(false) }}>
              {t('cancel')}
            </Button>
            <Button
              variant="outline"
              className="dsh-deepseek-official-switch-confirm"
              disabled={busy}
              onClick={onConfirm}
            >
              {busy ? t('deleting') : t('confirm')}
            </Button>
          </>
        )}
      >
        {dialogError === undefined
          ? null
          : <p className="dsh-deepseek-official-switch-error" role="alert">{dialogError}</p>}
      </Modal>
    </>
  )
}
