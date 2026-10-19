/** 重命名弹窗：`shell.overlay` 条目，结构与交互逐条对齐 dsh 原生侧栏的
 * `ui-workspace` `RenameSession.tsx`（0.2.0-rc.2）。原生弹窗状态是 ui-workspace
 * 的插件私有 store，第三方无法触发，这里以同一契约自建：请求 store + Modal +
 * 回车/IME 守卫 + 错误行。 */

import { useRef, useState } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, PropsHooks, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionRenameRequest } from './rename.js'

/** 提供给弹窗条目的运行时接口（对齐原生 SessionRenameDialogInjected）。 */
export interface SessionRenameDialogInjected {
  hooks: {
    /** 待确认的重命名请求，直到弹窗确认或取消。 */
    renameRequest: HostObservable<SessionRenameRequest | null>
  }
  /** 消费或取消挂起请求（关闭弹窗）。 */
  settleSessionRename: () => void
  /** 执行重命名；宿主接受时 resolve，业务失败 reject。 */
  renameSession: (sessionId: SessionId, title: string) => Promise<void>
}

/** 弹窗条目 props：运行时份额 + 文案 + 注入面。 */
export type SessionRenameDialogProps =
  & PropsRuntime<'shell.overlay'>
  & PropsLocale<'dsh-plugin-session-rename'>
  & Omit<SessionRenameDialogInjected, 'hooks'>
  & PropsHooks<SessionRenameDialogInjected['hooks']>

/** `shell.overlay` 条目：无请求时不渲染；每个请求一个弹窗（按会话 key，
 * 新请求重新播种草稿）。 */
export function SessionRenameDialog({
  useRenameRequest, settleSessionRename, renameSession, t,
}: SessionRenameDialogProps) {
  const request = useRenameRequest(pending => pending)
  if (request === null) return null
  return (
    <RenameForm
      key={request.sessionId}
      request={request}
      renameSession={renameSession}
      onSettle={settleSessionRename}
      t={t}
    />
  )
}

type Translate = PropsLocale<'dsh-plugin-session-rename'>['t']

/** 单个请求的弹窗：草稿在挂载时播种；提交中与错误状态随本代弹窗消亡。 */
function RenameForm({ request, renameSession, onSettle, t }: {
  request: SessionRenameRequest
  renameSession: SessionRenameDialogInjected['renameSession']
  onSettle: () => void
  t: Translate
}) {
  const [draft, setDraft] = useState(request.currentTitle)
  const [renaming, setRenaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // IME 组合态：提交组合的 Enter 不能当提交。
  const composingRef = useRef(false)
  const trimmed = draft.trim()
  const blocked = renaming || trimmed === ''
  const close = () => {
    if (renaming) return
    onSettle()
  }
  const confirm = () => {
    if (blocked) return
    setRenaming(true)
    setError(null)
    void (async () => {
      try {
        await renameSession(request.sessionId, trimmed)
        setRenaming(false)
        onSettle()
      } catch (reason: unknown) {
        setRenaming(false)
        setError(reason instanceof Error ? reason.message : String(reason))
      }
    })()
  }
  return (
    <Modal
      open
      onClose={close}
      closeLabel={t('dialog.close')}
      title={t('dialog.title')}
      footer={(
        <>
          <Button variant="outline" disabled={renaming} onClick={close}>{t('dialog.cancel')}</Button>
          <Button variant="primary" disabled={blocked} onClick={confirm}>{t('dialog.rename')}</Button>
        </>
      )}
    >
      <input
        className="dsh-session-rename-input"
        value={draft}
        aria-label={t('dialog.field')}
        data-modal-autofocus
        disabled={renaming}
        onFocus={(e) => { e.target.select() }}
        onChange={(e) => { setDraft(e.target.value); setError(null) }}
        onCompositionStart={() => { composingRef.current = true }}
        onCompositionEnd={() => { composingRef.current = false }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !composingRef.current) {
            e.preventDefault()
            confirm()
          }
        }}
      />
      {error !== null && <div className="dsh-session-rename-error" role="alert">{error}</div>}
    </Modal>
  )
}
