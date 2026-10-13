/** 模型页 footer 槽：内置 DeepSeek（API 密钥）行移除后（含待重启的待生效期）提供恢复入口。
 *  行状态与待生效写入都从控制器的共享存储读取：热生效路径里卡片组件卸载前的重读就是本组件的更新源。 */

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { restartHintActive } from '../shared.js'
import type { OfficialRowState } from '../shared.js'
import type { OfficialSwitchController } from './controller.js'
import { fill } from './locales.js'
import type { LocaleKey } from './locales.js'

/** 槽位注入：绑定的文案函数与官方 pluginManager 控制器。 */
export interface RestoreInjected {
  readonly t: (key: LocaleKey) => string
  readonly controller: OfficialSwitchController
}

/** footer 槽没有 owner props，渲染器只平铺注入面。 */
export type RestoreProps = RestoreInjected

/** 一次写入后需要保留到生效为止的提示。 */
interface Notice {
  readonly kind: 'error' | 'info' | 'status'
  readonly text: string
}

export function DeepSeekOfficialRestore(props: RestoreProps): ReactNode {
  const { t, controller } = props
  const [busy, setBusy] = useState(false)
  const read = useSyncExternalStore(
    controller.rowState.subscribe,
    () => controller.rowState.get(),
    () => controller.rowState.get(),
  )
  const pending = useSyncExternalStore(
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

  const onRestore = useCallback(() => {
    if (state.kind !== 'ready' || busy) return
    setBusy(true)
    setNotice(undefined)
    void (async () => {
      const outcome = await controller.setEnabled(state.entryId, true)
      setBusy(false)
      if (outcome.kind === 'restart-required') controller.pending.set({ enabled: outcome.enabled })
      else if (outcome.kind === 'applied' || outcome.kind === 'unchanged') controller.pending.set(undefined)
      else if (outcome.kind === 'overridden') {
        controller.pending.set(undefined)
        setNotice({ kind: 'info', text: t('hintOverridden') })
      } else {
        setNotice({
          kind: 'error',
          text: outcome.detail !== undefined && outcome.detail !== ''
            ? fill(t('writeFailed'), { detail: outcome.detail })
            : fill(t('writeFailedCode'), { code: outcome.code ?? 'unknown' }),
        })
      }
      // 重读共享行状态：热加载生效时行重新注册，本入口随之消失。
      await controller.read()
    })()
  }, [state, busy, controller, t])

  if (phase === 'error') {
    return <p className="dsh-deepseek-official-switch-error" role="alert">{fill(t('readFailed'), { detail: readError })}</p>
  }
  const locked = state.kind === 'locked'
  // 行已停用（重启后常态）、删除已确认等待重启（待生效期）、恢复已确认等待重启，都显示本入口。
  const pendingRemoval = pending?.enabled === false
  const pendingRestore = pending?.enabled === true
  const visible = phase === 'settled' && (state.kind === 'ready' || locked)
    && (!state.enabled || pendingRemoval || pendingRestore)
  if (!visible) return null
  return (
    <>
      <div className="dsh-deepseek-official-switch-footer">
        {/* 行仍报告启用且无待生效移除，只可能是恢复写入等待生效的瞬态——文案交给下方重启提示。 */}
        {state.enabled && !pendingRemoval
          ? null
          : (
            <p className="dsh-deepseek-official-switch-footer-text">
              {state.enabled ? t('footerPending') : t('footerRemoved')}
            </p>
          )}
        <button
          type="button"
          className="dsh-deepseek-official-switch-restore"
          disabled={busy || locked}
          {...locked
            ? { title: state.reason === 'management-required' ? t('lockedManagement') : t('lockedUnaddressable') }
            : {}}
          onClick={onRestore}
        >
          {busy ? t('restoring') : t('restore')}
        </button>
      </div>
      {/* 恢复写入等待重启时提示；待生效的移除由 footerPending 文案本身表达，不再重复提示。 */}
      {pendingRestore && restartHintActive(pending, state)
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
    </>
  )
}
