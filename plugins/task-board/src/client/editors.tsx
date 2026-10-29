/**
 * 看板的就地编辑小件：自适应高度 textarea、卡片编辑/新增 composer、列标题编辑。
 * 键盘契约：Escape 取消；新增 composer 的 Enter 直接提交（Shift+Enter 换行），
 * 编辑态 Enter 换行、Ctrl/Cmd+Enter 提交；输入法组词期间的 Enter 一律不提交。
 * 按钮统一 onMouseDown preventDefault——不抢 textarea 焦点，blur 提交不会被按钮点击打断。
 *
 * @module @dsh-kit/dsh-plugin-task-board/client/editors
 */

import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'

/** composer 操作行的通用包装。 */
export function ComposerActions({ children }: { children: ReactNode }) {
  return <div className="dsh-task-board-composerActions">{children}</div>
}

/** 自适应内容高度的 textarea；必须保留类名 `dsh-task-board-editor` 的字段契约样式。 */
export function AutoTextarea({
  value, onChange, onKeyDown, onBlur, placeholder, ariaLabel, autoFocus,
}: {
  value: string
  onChange: (text: string) => void
  onKeyDown?: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void
  onBlur?: () => void
  placeholder?: string | undefined
  ariaLabel?: string | undefined
  autoFocus?: boolean
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const element = ref.current
    if (element === null) return
    element.style.height = 'auto'
    element.style.height = `${String(element.scrollHeight)}px`
  }, [value])
  return (
    <textarea
      ref={ref}
      className="dsh-task-board-editor"
      value={value}
      rows={2}
      placeholder={placeholder}
      aria-label={ariaLabel}
      spellCheck={false}
      autoFocus={autoFocus}
      onChange={event => { onChange(event.target.value) }}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
    />
  )
}

/** Enter 是否处于输入法组词（提交键的 IME 守卫）。 */
function isComposing(event: ReactKeyboardEvent<HTMLElement>): boolean {
  return event.nativeEvent.isComposing
}

/**
 * 卡片就地编辑：Enter 换行、Ctrl/Cmd+Enter 或失焦提交、Escape 还原。
 */
export function CardEdit({
  initial, commitLabel, cancelLabel, placeholder, ariaLabel, onCommit, onCancel,
}: {
  initial: string
  commitLabel: string
  cancelLabel: string
  placeholder?: string
  ariaLabel?: string
  onCommit: (text: string) => void
  onCancel: () => void
}) {
  const [text, setText] = useState(initial)
  const commit = useCallback(() => { onCommit(text) }, [onCommit, text])
  return (
    <>
      <AutoTextarea
        value={text}
        ariaLabel={ariaLabel}
        placeholder={placeholder}
        autoFocus
        onChange={setText}
        onBlur={commit}
        onKeyDown={event => {
          if (isComposing(event)) return
          if (event.key === 'Escape') {
            event.stopPropagation()
            onCancel()
            return
          }
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault()
            commit()
          }
        }}
      />
      <ComposerActions>
        <Button size="sm" onMouseDown={preventDefault} onClick={commit} disabled={text.trim() === ''}>{commitLabel}</Button>
        <Button variant="outline" size="sm" onMouseDown={preventDefault} onClick={onCancel}>{cancelLabel}</Button>
      </ComposerActions>
    </>
  )
}

/**
 * 列尾新增卡片：Enter 提交并保持打开（连续录入），Shift+Enter 换行，Escape 关闭。
 */
export function AddCardComposer({
  placeholder, addLabel, cancelLabel, ariaLabel, onAdd, onClose,
}: {
  placeholder: string
  addLabel: string
  cancelLabel: string
  ariaLabel?: string
  onAdd: (text: string) => void
  onClose: () => void
}) {
  const [text, setText] = useState('')
  const add = useCallback(() => {
    if (text.trim() === '') return
    onAdd(text)
    setText('')
  }, [onAdd, text])
  return (
    <>
      <AutoTextarea
        value={text}
        ariaLabel={ariaLabel}
        placeholder={placeholder}
        autoFocus
        onChange={setText}
        onKeyDown={event => {
          if (isComposing(event)) return
          if (event.key === 'Escape') {
            event.stopPropagation()
            onClose()
            return
          }
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            add()
          }
        }}
      />
      <ComposerActions>
        <Button size="sm" onMouseDown={preventDefault} onClick={add} disabled={text.trim() === ''}>{addLabel}</Button>
        <Button variant="outline" size="sm" onMouseDown={preventDefault} onClick={onClose}>{cancelLabel}</Button>
      </ComposerActions>
    </>
  )
}

/** 列标题就地编辑（单行 input）：Enter/失焦提交，Escape 取消。 */
export function ListTitleEdit({
  initial, placeholder, ariaLabel, onCommit, onCancel,
}: {
  initial: string
  placeholder: string
  ariaLabel?: string
  onCommit: (title: string) => void
  onCancel: () => void
}) {
  const [title, setTitle] = useState(initial)
  const commit = useCallback(() => { onCommit(title) }, [onCommit, title])
  return (
    <input
      className="dsh-task-board-listTitleInput"
      value={title}
      placeholder={placeholder}
      autoFocus
      onFocus={event => { event.target.select() }}
      spellCheck={false}
      aria-label={ariaLabel}
      // 列标题 input 落在整列拖拽手柄（header）内部：不拦指针会把框选文本变成拖列。
      onPointerDown={event => { event.stopPropagation() }}
      onChange={event => { setTitle(event.target.value) }}
      onBlur={commit}
      onKeyDown={event => {
        if (isComposing(event)) return
        if (event.key === 'Escape') {
          event.stopPropagation()
          onCancel()
          return
        }
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault()
          commit()
        }
      }}
    />
  )
}

/** 「添加列表」的输入行：Enter/按钮提交，Escape/失焦取消。 */
export function AddListForm({
  placeholder, addLabel, cancelLabel, onCommit, onCancel,
}: {
  placeholder: string
  addLabel: string
  cancelLabel: string
  onCommit: (title: string) => void
  onCancel: () => void
}) {
  const [title, setTitle] = useState('')
  const commit = useCallback(() => {
    if (title.trim() === '') return
    onCommit(title)
  }, [onCommit, title])
  return (
    <>
      <input
        className="dsh-task-board-addColumnInput"
        value={title}
        placeholder={placeholder}
        autoFocus
        spellCheck={false}
        aria-label={placeholder}
        onChange={event => { setTitle(event.target.value) }}
        onBlur={() => { if (title.trim() === '') onCancel() }}
        onKeyDown={event => {
          if (isComposing(event)) return
          if (event.key === 'Escape') {
            event.stopPropagation()
            onCancel()
            return
          }
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            commit()
          }
        }}
      />
      <ComposerActions>
        <Button size="sm" onMouseDown={preventDefault} onClick={commit} disabled={title.trim() === ''}>{addLabel}</Button>
        <Button variant="outline" size="sm" onMouseDown={preventDefault} onClick={onCancel}>{cancelLabel}</Button>
      </ComposerActions>
    </>
  )
}

/** 阻止按钮抢走编辑器的焦点（blur 提交语义依赖这一点）。 */
function preventDefault(event: { preventDefault(): void }): void {
  event.preventDefault()
}
