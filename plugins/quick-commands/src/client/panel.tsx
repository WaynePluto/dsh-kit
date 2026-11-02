/**
 * 快捷指令悬浮面板：MenuSurface（官方磨砂菜单面）+ portal + 视口钳制定位
 * （favorite-models 同款 place()）。列表行点击插入、行尾编辑/删除、底部新增；
 * 点击输入框本体（放置光标）不关闭面板——「先把光标点到正文中间，再点指令」
 * 是本插件的核心流程，只有点击面板与 composer 卡片之外的区域才关闭。
 *
 * @module @dsh-kit/dsh-plugin-quick-commands/client/panel
 */

import {
  useEffect, useId, useLayoutEffect, useRef, useState,
} from 'react'
import type { CSSProperties, KeyboardEvent, RefObject } from 'react'
import { createPortal } from 'react-dom'
import {
  IconEditOutlineMedium, IconTrashOutlineMedium, MenuSurface,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { MAX_COMMAND_TEXT_LENGTH, MAX_COMMANDS } from '../shared.js'
import type { QuickCommandDocument } from '../shared.js'
import { useCommands } from './use-commands.js'
import { classes } from './styles.js'
import { fill } from './locales.js'
import type { QuickCommandsKey } from './locales.js'

/** 面板的渲染 props。 */
export interface QuickCommandsPanelProps {
  /** 读取整份文档（宿主 `get`）。 */
  load: () => Promise<QuickCommandDocument>
  /** 整份写回（宿主 `put`）。 */
  save: (document: QuickCommandDocument) => Promise<void>
  /** 在输入框光标位置插入；返回 false 表示失败（面板不关闭，调用方提示）。 */
  insert: (text: string) => boolean
  /** 本插件文案。 */
  t: (key: QuickCommandsKey) => string
  /** 触发按钮 ref；面板锚其上方。 */
  anchorRef: RefObject<HTMLElement | null>
  /** 关闭面板。 */
  onClose: () => void
}

/** 首帧隐藏测量样式（定位提交前不闪现在左上角）。 */
const MEASURE_STYLE: CSSProperties = { visibility: 'hidden', left: 0, top: 0 }

/** 视口钳制边距。 */
const MARGIN = 12

/**
 * 悬浮面板内容（不含 portal）。
 * @param props - 渲染 props。
 * @returns 面板内容。
 */
export function QuickCommandsPanel({ load, save, insert, t, anchorRef, onClose }: QuickCommandsPanelProps) {
  const id = useId()
  const menuRef = useRef<HTMLDivElement | null>(null)
  const addInputRef = useRef<HTMLInputElement | null>(null)
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([])
  const [menuPos, setMenuPos] = useState<CSSProperties | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [addText, setAddText] = useState('')
  const {
    document: doc, status, errorKind, errorMessage, limitReached, reload, add, update, remove,
  } = useCommands(load, save)

  // 定位：锚 trigger 上方（composer 在窗口底部），12px 钳制；滚动/resize 跟随，
  // 装载完成与编辑态切换后重跑（列表高度变化）。
  useLayoutEffect(() => {
    const place = (): void => {
      const rect = anchorRef.current?.getBoundingClientRect()
      if (rect === undefined) return
      const lw = menuRef.current?.offsetWidth ?? 0
      const lh = menuRef.current?.offsetHeight ?? 0
      let x = rect.left
      let y = rect.top - 8 - lh
      if (lw > 0) {
        const maxX = Math.max(MARGIN, window.innerWidth - lw - MARGIN)
        x = Math.min(Math.max(x, MARGIN), maxX)
      }
      if (lh > 0) {
        const maxY = Math.max(MARGIN, window.innerHeight - lh - MARGIN)
        y = Math.min(Math.max(y, MARGIN), maxY)
      }
      setMenuPos({ left: x, top: y })
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [anchorRef, status, editingId])

  // 外点关闭；composer 卡片内的点击例外（放置光标是核心流程的一部分）。
  useEffect(() => {
    const closeOutside = (event: Event): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (menuRef.current?.contains(target) === true) return
      if (anchorRef.current?.closest('[data-composer-card]')?.contains(target) === true) return
      onClose()
    }
    document.addEventListener('mousedown', closeOutside)
    return () => { document.removeEventListener('mousedown', closeOutside) }
  }, [anchorRef, onClose])

  // 装载完成后给初始焦点（只做一次）：有指令聚焦第一行（方向键/Enter 立即可用），
  // 空列表聚焦新增框。之后的增删改不抢焦点，连续添加不被打断；编辑框的焦点由
  // autoFocus 负责，不在此列。
  const focusedOnce = useRef(false)
  useEffect(() => {
    if (status !== 'ready' || focusedOnce.current) return
    focusedOnce.current = true
    if (doc.commands.length > 0) rowRefs.current[0]?.focus()
    else addInputRef.current?.focus()
  }, [status, doc.commands.length])

  const commands = doc.commands
  rowRefs.current = []
  let rowIndex = 0
  const rowRef = () => {
    const at = rowIndex++
    return (node: HTMLButtonElement | null) => { rowRefs.current[at] = node }
  }

  /** 方向键在指令行之间移动焦点；输入框内不接管（留给光标移动）。 */
  const moveRowFocus = (offset: number): void => {
    const items = rowRefs.current.filter(item => item !== null)
    if (items.length === 0) return
    const active = document.activeElement
    if (active !== null && active.tagName === 'INPUT') return
    const current = items.findIndex(item => item === active)
    const next = current < 0
      ? offset > 0 ? 0 : items.length - 1
      : (current + offset + items.length) % items.length
    items[next]?.focus()
  }

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Escape') {
      // 阻止冒泡：面板内 Escape 只关面板，不把 Escape 送给 composer（上游会清草稿/停提交）。
      event.preventDefault()
      event.stopPropagation()
      onClose()
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const active = document.activeElement
      if (active !== null && active.tagName === 'INPUT') return
      event.preventDefault()
      moveRowFocus(event.key === 'ArrowDown' ? 1 : -1)
    }
  }

  const commitAdd = (): void => {
    if (add(addText)) setAddText('')
  }

  const onAddKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Enter') {
      event.preventDefault()
      commitAdd()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      if (addText === '') onClose()
      else setAddText('')
    }
  }

  const beginEdit = (command: { id: string, text: string }): void => {
    setEditingId(command.id)
    setDraft(command.text)
  }

  const commitEdit = (): void => {
    if (editingId === null) return
    if (draft !== '') update(editingId, draft)
    setEditingId(null)
    setDraft('')
  }

  const cancelEdit = (): void => {
    setEditingId(null)
    setDraft('')
  }

  const onEditorKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Enter') {
      event.preventDefault()
      commitEdit()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      cancelEdit()
    }
  }

  const choose = (text: string): void => {
    if (insert(text)) onClose()
  }

  const addPlaceholder = limitReached ? fill(t('limitReached'), { count: MAX_COMMANDS }) : t('addPlaceholder')

  return (
    <MenuSurface
      ref={menuRef}
      id={id}
      className={classes.menu}
      style={menuPos ?? MEASURE_STYLE}
      role="menu"
      aria-label={t('menuAria')}
      onKeyDown={onMenuKeyDown}
    >
      {errorKind === 'load'
        ? (
          <div className={classes.error} role="alert">
            <span>{fill(t('loadFailed'), { message: errorMessage ?? '' })}</span>
            <button type="button" className={classes.retry} onClick={reload}>{t('retry')}</button>
          </div>
        )
        : null}
      {errorKind === 'save'
        ? (
          <div className={classes.error} role="alert">
            <span>{fill(t('saveFailed'), { message: errorMessage ?? '' })}</span>
          </div>
        )
        : null}
      <div className={classes.list}>
        {status === 'loading' && commands.length === 0
          ? <div className={classes.status}>{t('loading')}</div>
          : null}
        {status === 'ready' && commands.length === 0
          ? <div className={classes.empty}>{t('empty')}</div>
          : null}
        {commands.map(command => (
          editingId === command.id
            ? (
              <div className={classes.row} key={command.id}>
                <input
                  type="text"
                  className={classes.editor}
                  value={draft}
                  placeholder={t('editPlaceholder')}
                  aria-label={t('edit')}
                  autoFocus
                  maxLength={MAX_COMMAND_TEXT_LENGTH}
                  onChange={event => { setDraft(event.target.value) }}
                  onKeyDown={onEditorKeyDown}
                  onBlur={commitEdit}
                />
              </div>
            )
            : (
              <div className={classes.row} key={command.id}>
                <button
                  ref={rowRef()}
                  type="button"
                  role="menuitem"
                  className={classes.rowText}
                  title={command.text}
                  onClick={() => { choose(command.text) }}
                >
                  <span className={classes.rowLabel}>{command.text}</span>
                </button>
                <span className={classes.rowActions}>
                  <button
                    type="button"
                    className={classes.rowAction}
                    aria-label={t('edit')}
                    title={t('edit')}
                    onClick={() => { beginEdit(command) }}
                  >
                    <IconEditOutlineMedium size={14} />
                  </button>
                  <button
                    type="button"
                    className={`${classes.rowAction} ${classes.delete}`}
                    aria-label={t('delete')}
                    title={t('delete')}
                    onClick={() => { remove(command.id) }}
                  >
                    <IconTrashOutlineMedium size={14} />
                  </button>
                </span>
              </div>
            )
        ))}
      </div>
      <div className={classes.addRow}>
        <input
          ref={addInputRef}
          type="text"
          className={classes.editor}
          value={addText}
          placeholder={addPlaceholder}
          aria-label={t('addPlaceholder')}
          maxLength={MAX_COMMAND_TEXT_LENGTH}
          onChange={event => { setAddText(event.target.value) }}
          onKeyDown={onAddKeyDown}
        />
      </div>
    </MenuSurface>
  )
}

/**
 * portal 到 body 的完整浮层（面板只在 open 期间挂载，关闭即整体卸载，
 * 本地状态随之复位——下次打开重新 `get`）。
 * @param props - 渲染 props。
 * @returns 浮层。
 */
export function QuickCommandsPortal(props: QuickCommandsPanelProps) {
  return createPortal(<QuickCommandsPanel {...props} />, document.body)
}
