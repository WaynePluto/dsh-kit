/**
 * composer 工具排左侧组的触发按钮：复刻原生 `.add` 圆形图标按钮
 * （`InputBar.module.css` 的 `.add`，28×28、14px Medium 字形），点击开/关悬浮面板；
 * 点选指令插入成功后经 `focusInput` 把键盘交回输入框（光标停在插入文本之后），
 * 插入失败（草稿并发变化且重试仍失败）时经官方 Toast 就地提示。
 *
 * 面板必须走 QuickCommandsPortal（portal 到 body）：dsh 0.2.2-rc.1 起 composer
 * seat 挂 `will-change: transform`（`ConversationRoot.module.css`），成为 fixed
 * 后代的包含块，上游契约要求 composer 内 fixed 浮层一律 portal 到 body。
 *
 * @module @dsh-kit/dsh-plugin-quick-commands/client/button
 */

import { useId, useRef, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  IconListPenOutlineMedium, IconWarningOutlineMedium, Toast,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { QuickCommandDocument } from '../shared.js'
import { insertAtCaret } from './insert.js'
import { classes } from './styles.js'
import { QuickCommandsPortal } from './panel.js'

/** 槽位 `inject` 面板注入的 RPC 面（`apply` 里经 callKitChannel 实现）。 */
export interface QuickCommandsInjected {
  /** 读取整份指令文档（宿主 `get`）。 */
  load: () => Promise<QuickCommandDocument>
  /** 整份写回（宿主 `put`）。 */
  save: (document: QuickCommandDocument) => Promise<void>
  /** 插入成功后把键盘与光标交回输入框（光标停在插入文本之后）。 */
  focusInput: () => void
}

/** dock entry 的完整 props：会话标准 kit（含 inputActions 插入面）+ RPC 面 + 文案。 */
export type QuickCommandsEntryProps =
  PropsRuntime<'conversation.input.left'>
  & QuickCommandsInjected
  & PropsLocale<'dsh-plugin-quick-commands'>

/**
 * Slot entry：快捷指令按钮 + 悬浮面板。
 * @param props - 会话作用域标准 props、RPC 面与文案。
 * @returns 按钮与（打开时的）面板。
 */
export function QuickCommandsEntry({ inputActions, load, save, focusInput, t }: QuickCommandsEntryProps) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [toast, setToast] = useState<{ seq: number, text: string } | null>(null)
  const toastSeq = useRef(0)
  const buttonRef = useRef<HTMLButtonElement | null>(null)

  // 插入成功后立刻回焦：面板行按钮还持着焦点，编辑器失焦时上游不会把插入后的
  // 选区写回 DOM，不交还键盘就会出现「文本进来了、光标不在里面」。
  const insert = (text: string): boolean => {
    const ok = insertAtCaret(inputActions, text)
    if (ok) {
      focusInput()
      return true
    }
    toastSeq.current += 1
    setToast({ seq: toastSeq.current, text: t('insertFailed') })
    return false
  }

  return (
    <div className={classes.root}>
      <button
        ref={buttonRef}
        type="button"
        id={`dsh-qc-trigger-${id}`}
        className={classes.button}
        aria-label={t('button')}
        title={t('button')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => { setOpen(value => !value) }}
      >
        <IconListPenOutlineMedium size={14} />
      </button>
      {open
        ? (
          <QuickCommandsPortal
            load={load}
            save={save}
            insert={insert}
            t={t}
            anchorRef={buttonRef}
            onClose={() => { setOpen(false) }}
          />
        )
        : null}
      {toast !== null
        ? (
          <Toast
            key={toast.seq}
            text={toast.text}
            icon={<IconWarningOutlineMedium />}
            anchor={buttonRef.current?.closest<HTMLElement>('[data-composer-card]') ?? null}
            onDone={() => { setToast(null) }}
          />
        )
        : null}
    </div>
  )
}
