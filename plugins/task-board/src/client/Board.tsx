/**
 * 看板正文：dnd-kit 双层可排序（列横向 + 列内卡片纵向、跨列实时移动）。
 * 拖拽体验的三条硬要求的落点：
 * - 周围卡片平滑滑开：SortableContext + dnd-kit 对未拖拽项下发的 transform/transition，
 *   让位动画由引擎连续插值，不做闪现式重排；
 * - 边缘自动滚动：DndContext 内建 autoScroll（拖拽指针逼近任一可滚动祖先边缘时均速
 *   滚动，横向看板滚动区与列内纵向滚动区都覆盖）；
 * - 就地编辑：点击卡片本体进入 CardEdit（textarea 原位替换），无弹窗。
 * 跨列移动发生在 onDragOver（卡片随悬停实时换列，其余卡片即时让位），最终落位在
 * onDragEnd；Escape 取消时恢复拖拽开始前的整份文档快照。
 *
 * @module @dsh-kit/dsh-plugin-task-board/client/Board
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext, DragOverlay, KeyboardSensor, MeasuringStrategy, PointerSensor,
  closestCorners, useSensor, useSensors,
} from '@dnd-kit/core'
import type { DragEndEvent, DragOverEvent, DragStartEvent } from '@dnd-kit/core'
import {
  SortableContext, horizontalListSortingStrategy, sortableKeyboardCoordinates, useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  IconCheckOutlineMedium, IconCopyOutlineMedium, IconFolderCloseMedium,
  IconPlusOutlineMedium, IconSendOutlineMedium, IconTrashOutlineMedium,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { BoardCard as BoardCardModel, BoardDocument } from '../shared.js'
import {
  addCard, addList, deleteCard, deleteList, moveCard, moveList, renameList, updateCard,
} from './board-ops.js'
import { AddCardComposer, AddListForm, CardEdit, ListTitleEdit } from './editors.js'
import { fill, type TaskBoardKey } from './locales.js'

/** 工作区选择器的一个选项。 */
export interface WorkspaceOption {
  readonly id: string
  readonly title: string
  readonly path: string
}

/** 看板正文依赖的外部动作（页面注入）。 */
export interface BoardDeps {
  readonly translate: (key: TaskBoardKey) => string
  /** 现取工作区清单（打开选择菜单与渲染 chip 时读，不缓存）。 */
  readonly workspaces: () => readonly WorkspaceOption[]
  /** 复制文本到剪贴板；返回是否成功。 */
  readonly copyText: (text: string) => Promise<boolean>
  /** 把卡片任务发送到目标工作区的新对话（失败以异常抛出）。 */
  readonly sendCard: (card: BoardCardModel) => Promise<void>
}

/** drag data 判别：卡片 or 列。 */
interface CardDragData { type: 'card' }
interface ListDragData { type: 'list' }

/** 拖入空列时的虚线落点占位。 */
function DropHint({ visible }: { visible: boolean }) {
  if (!visible) return null
  return (
    <div
      aria-hidden
      style={{
        flex: 'none',
        height: 36,
        borderRadius: 8,
        border: '1px dashed var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-interactive-bg-hover)',
      }}
    />
  )
}

/**
 * 看板正文。
 * @param props - 文档、变更入口与外部动作。
 */
export function Board({ board, onChange, deps }: {
  board: BoardDocument
  onChange: (next: BoardDocument) => void
  deps: BoardDeps
}) {
  const [activeCardId, setActiveCardId] = useState<string | null>(null)
  const boardAtDragStart = useRef<BoardDocument | null>(null)
  // 悬停中的空列：跨列 onDragOver 落在列容器上时给一个虚线占位。
  const [hoveredListId, setHoveredListId] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const listIds = useMemo(() => board.lists.map(list => list.id), [board.lists])

  const activeCard = activeCardId === null
    ? undefined
    : board.lists.flatMap(list => list.cards).find(card => card.id === activeCardId)

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const data = event.active.data.current as CardDragData | ListDragData | undefined
    boardAtDragStart.current = board
    if (data?.type === 'card') setActiveCardId(String(event.active.id))
  }, [board])

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { active, over } = event
    if (over === null) return
    const data = active.data.current as CardDragData | undefined
    if (data?.type !== 'card') return
    const activeId = String(active.id)
    const overId = String(over.id)
    if (activeId === overId) return
    const overData = over.data.current as CardDragData | ListDragData | undefined
    const fromListId = containingListId(board, activeId)
    if (fromListId === undefined) return
    if (overData?.type === 'card') {
      setHoveredListId(null)
      const toListId = containingListId(board, overId)
      if (toListId === undefined || toListId === fromListId) return
      const toList = board.lists.find(list => list.id === toListId)
      const overIndex = toList?.cards.findIndex(card => card.id === overId) ?? -1
      if (toList === undefined || overIndex < 0) return
      onChange(moveCard(board, activeId, toListId, overIndex))
    } else if (overData?.type === 'list' && overId !== fromListId) {
      setHoveredListId(overId)
      onChange(moveCard(board, activeId, overId))
    }
  }, [board, onChange])

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    boardAtDragStart.current = null
    setActiveCardId(null)
    setHoveredListId(null)
    if (over === null) return
    const data = active.data.current as CardDragData | ListDragData | undefined
    const activeId = String(active.id)
    const overId = String(over.id)
    if (data?.type === 'card') {
      const overData = over.data.current as CardDragData | ListDragData | undefined
      if (overData?.type === 'card') {
        const listId = containingListId(board, overId)
        if (listId === undefined) return
        const list = board.lists.find(item => item.id === listId)
        const oldIndex = list?.cards.findIndex(card => card.id === activeId) ?? -1
        const newIndex = list?.cards.findIndex(card => card.id === overId) ?? -1
        if (list === undefined || oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return
        onChange(moveCard(board, activeId, listId, newIndex))
      } else if (overData?.type === 'list') {
        onChange(moveCard(board, activeId, overId))
      }
    } else if (data?.type === 'list' && overId !== activeId) {
      const oldIndex = board.lists.findIndex(list => list.id === activeId)
      const newIndex = board.lists.findIndex(list => list.id === overId)
      if (oldIndex >= 0 && newIndex >= 0 && oldIndex !== newIndex) {
        onChange(moveList(board, activeId, newIndex))
      }
    }
  }, [board, onChange])

  const handleDragCancel = useCallback(() => {
    const start = boardAtDragStart.current
    boardAtDragStart.current = null
    setActiveCardId(null)
    setHoveredListId(null)
    if (start !== null && start !== board) onChange(start)
  }, [board, onChange])

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <SortableContext items={listIds} strategy={horizontalListSortingStrategy}>
        {board.lists.map((list, index) => (
          <BoardColumn
            key={list.id}
            list={list}
            isFirst={index === 0}
            board={board}
            onChange={onChange}
            deps={deps}
            hoverHint={hoveredListId === list.id && list.cards.length === 0}
          />
        ))}
      </SortableContext>
      <AddListControl board={board} onChange={onChange} translate={deps.translate} />
      <DragOverlay>
        {activeCard === undefined
          ? null
          : (
            <div className="dsh-task-board-overlayCard">
              <CardFace card={activeCard} deps={deps} />
            </div>
            )}
      </DragOverlay>
    </DndContext>
  )
}

/** 卡片所在列 id；找不到时 undefined。 */
function containingListId(board: BoardDocument, cardId: string): string | undefined {
  return board.lists.find(list => list.cards.some(card => card.id === cardId))?.id
}

// ── 列 ──────────────────────────────────────────────────────────────────────

/** 一列：头部是横向拖拽手柄 + 标题就地编辑；卡片区纵向排序滚动；尾部新增卡片。 */
function BoardColumn({ list, isFirst, board, onChange, deps, hoverHint }: {
  list: { readonly id: string, readonly title: string, readonly cards: readonly BoardCardModel[] }
  isFirst: boolean
  board: BoardDocument
  onChange: (next: BoardDocument) => void
  deps: BoardDeps
  hoverHint: boolean
}) {
  const t = deps.translate
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: list.id, data: { type: 'list' } satisfies ListDragData })
  const [titleEditing, setTitleEditing] = useState(false)
  const [adding, setAdding] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const confirmTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => {
    if (confirmTimer.current !== undefined) window.clearTimeout(confirmTimer.current)
  }, [])

  const requestDelete = () => {
    if (!confirmDelete) {
      setConfirmDelete(true)
      if (confirmTimer.current !== undefined) window.clearTimeout(confirmTimer.current)
      confirmTimer.current = window.setTimeout(() => { setConfirmDelete(false) }, 2200)
      return
    }
    setConfirmDelete(false)
    onChange(deleteList(board, list.id))
  }

  return (
    <section
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`dsh-task-board-list${isDragging ? ' dsh-task-board-listDragging' : ''}`}
      data-dsh-task-board-list={list.id}
    >
      <header
        ref={setActivatorNodeRef}
        className="dsh-task-board-listHeader"
        {...attributes}
        {...listeners}
      >
        {titleEditing
          ? (
            <ListTitleEdit
              initial={list.title}
              placeholder={t('listTitlePlaceholder')}
              ariaLabel={t('newListPlaceholder')}
              onCommit={title => {
                setTitleEditing(false)
                onChange(renameList(board, list.id, title))
              }}
              onCancel={() => { setTitleEditing(false) }}
            />
            )
          : (
            <>
              <h3
                className="dsh-task-board-listTitle"
                title={list.title}
                onClick={() => { setTitleEditing(true) }}
              >
                {list.title}
              </h3>
              <span className="dsh-task-board-listCount">
                {String(list.cards.length)}
              </span>
              <button
                type="button"
                className={`dsh-task-board-iconBtn dsh-task-board-listDelete${confirmDelete ? ' dsh-task-board-iconBtnDanger' : ''}`}
                title={confirmDelete
                  ? fill(t('deleteListConfirm'), { title: list.title, count: list.cards.length })
                  : t('deleteList')}
                aria-label={t('deleteList')}
                onClick={requestDelete}
                onPointerDown={event => { event.stopPropagation() }}
              >
                <IconTrashOutlineMedium size={14} />
              </button>
            </>
            )}
      </header>
      <div className="dsh-task-board-cards">
        <SortableContext
          items={list.cards.map(card => card.id)}
          strategy={verticalListSortingStrategy}
        >
          {list.cards.map(card => (
            <BoardCardRow
              key={card.id}
              card={card}
              isFirstList={isFirst}
              board={board}
              onChange={onChange}
              deps={deps}
            />
          ))}
        </SortableContext>
        <DropHint visible={hoverHint} />
      </div>
      <div className="dsh-task-board-addCard">
        {adding
          ? (
            <AddCardComposer
              placeholder={t('cardPlaceholder')}
              addLabel={t('saveCard')}
              cancelLabel={t('cancel')}
              ariaLabel={t('addCard')}
              onAdd={text => { onChange(addCard(board, list.id, text)) }}
              onClose={() => { setAdding(false) }}
            />
            )
          : (
            <button
              type="button"
              className="dsh-task-board-textBtn"
              onClick={() => { setAdding(true) }}
              onPointerDown={event => { event.stopPropagation() }}
            >
              <IconPlusOutlineMedium size={14} />
              {t('addCard')}
            </button>
            )}
      </div>
    </section>
  )
}

// ── 卡片 ────────────────────────────────────────────────────────────────────

/** 一张卡片（可排序项）。 */
function BoardCardRow({ card, isFirstList, board, onChange, deps }: {
  card: BoardCardModel
  isFirstList: boolean
  board: BoardDocument
  onChange: (next: BoardDocument) => void
  deps: BoardDeps
}) {
  const t = deps.translate
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: card.id, data: { type: 'card' } satisfies CardDragData })
  const [editing, setEditing] = useState(false)
  const [copied, setCopied] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const copyTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => {
    if (copyTimer.current !== undefined) window.clearTimeout(copyTimer.current)
  }, [])

  const copy = useCallback(() => {
    void (async () => {
      const ok = await deps.copyText(card.text)
      if (!ok) return
      setCopied(true)
      if (copyTimer.current !== undefined) window.clearTimeout(copyTimer.current)
      copyTimer.current = window.setTimeout(() => { setCopied(false) }, 1400)
    })()
  }, [card.text, deps])

  const workspaceLabel = card.workspaceId === undefined
    ? t('workspaceDefault')
    : deps.workspaces().find(item => item.id === card.workspaceId)?.title ?? t('untitledWorkspace')
  const sendLabel = fill(t('sendCard'), { workspace: workspaceLabel })

  const menuEntries = (): MenuEntry[] => {
    const entries: MenuEntry[] = [{
      id: '__default',
      label: t('workspaceDefault'),
      icon: <IconFolderCloseMedium size={14} />,
    }]
    const workspaces = deps.workspaces()
    if (workspaces.length === 0) {
      entries.push({ type: 'label', id: 'none', text: t('workspaceNone') })
      return entries
    }
    for (const workspace of workspaces) {
      entries.push({
        id: workspace.id,
        label: workspace.title,
        icon: <IconFolderCloseMedium size={14} />,
      })
    }
    return entries
  }

  return (
    <article
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`dsh-task-board-card${isDragging ? ' dsh-task-board-cardSource' : ''}`}
      data-dsh-task-board-card={card.id}
      {...(editing ? {} : { ...attributes, ...listeners })}
    >
      <div className="dsh-task-board-cardMeta">
        <Menu
          open={menuOpen}
          portal
          dense
          align="start"
          anchor={(
            <button
              type="button"
              className="dsh-task-board-wsChip"
              title={`${t('workspacePicker')}：${workspaceLabel}`}
              aria-label={t('workspacePicker')}
              aria-haspopup="menu"
              onClick={() => { setMenuOpen(value => !value) }}
              onPointerDown={event => { event.stopPropagation() }}
            >
              <IconFolderCloseMedium size={13} />
              <span className="dsh-task-board-wsChipLabel">{workspaceLabel}</span>
            </button>
          )}
          items={menuEntries()}
          selectedId={card.workspaceId ?? '__default'}
          onSelect={id => {
            setMenuOpen(false)
            onChange(updateCard(board, card.id, { workspaceId: id === '__default' ? null : id }))
          }}
          onClose={() => { setMenuOpen(false) }}
        />
        <div className="dsh-task-board-cardActions">
          <button
            type="button"
            className="dsh-task-board-iconBtn"
            title={copied ? t('copied') : t('copyCard')}
            aria-label={t('copyCard')}
            onClick={copy}
            onPointerDown={event => { event.stopPropagation() }}
          >
            {copied ? <IconCheckOutlineMedium size={14} /> : <IconCopyOutlineMedium size={14} />}
          </button>
          <button
            type="button"
            className="dsh-task-board-iconBtn dsh-task-board-iconBtnDanger"
            title={t('deleteCard')}
            aria-label={t('deleteCard')}
            onClick={() => { onChange(deleteCard(board, card.id)) }}
            onPointerDown={event => { event.stopPropagation() }}
          >
            <IconTrashOutlineMedium size={14} />
          </button>
        </div>
      </div>
      {editing
        ? (
          <CardEdit
            initial={card.text}
            commitLabel={t('saveCard')}
            cancelLabel={t('cancel')}
            ariaLabel={t('cardPlaceholder')}
            onCommit={text => {
              setEditing(false)
              onChange(updateCard(board, card.id, { text }))
            }}
            onCancel={() => { setEditing(false) }}
          />
          )
        : (
          <p className="dsh-task-board-cardText" onClick={() => { setEditing(true) }}>
            {card.text}
          </p>
          )}
      {isFirstList && (
        <div className="dsh-task-board-cardFooter">
          <span className="dsh-task-board-sendWrap">
            <button
              type="button"
              className="dsh-task-board-iconBtn"
              title={sendLabel}
              aria-label={sendLabel}
              onClick={() => { void deps.sendCard(card) }}
              onPointerDown={event => { event.stopPropagation() }}
            >
              <IconSendOutlineMedium size={14} />
            </button>
          </span>
        </div>
      )}
    </article>
  )
}

/** 悬浮影卡里的卡片正面（无交互）。 */
function CardFace({ card, deps }: { card: BoardCardModel, deps: BoardDeps }) {
  const t = deps.translate
  const label = card.workspaceId === undefined
    ? t('workspaceDefault')
    : deps.workspaces().find(item => item.id === card.workspaceId)?.title ?? t('untitledWorkspace')
  return (
    <>
      <div className="dsh-task-board-cardMeta">
        <span className="dsh-task-board-wsChip">
          <IconFolderCloseMedium size={13} />
          <span className="dsh-task-board-wsChipLabel">{label}</span>
        </span>
      </div>
      <p className="dsh-task-board-cardText">{card.text}</p>
    </>
  )
}

// ── 添加列表 ────────────────────────────────────────────────────────────────

/** 看板尾部的「添加列表」控件（收起是虚线幽灵块，展开是标题输入行）。 */
function AddListControl({ board, onChange, translate }: {
  board: BoardDocument
  onChange: (next: BoardDocument) => void
  translate: (key: TaskBoardKey) => string
}) {
  const t = translate
  const [open, setOpen] = useState(false)
  return (
    <div className={`dsh-task-board-addColumn${open ? ' dsh-task-board-addColumnOpen' : ''}`}>
      {open
        ? (
            <AddListForm
              placeholder={t('newListPlaceholder')}
              addLabel={t('addListAction')}
              cancelLabel={t('cancel')}
              onCommit={title => {
                onChange(addList(board, title))
                setOpen(false)
              }}
              onCancel={() => { setOpen(false) }}
            />
          )
        : (
            <button type="button" className="dsh-task-board-textBtn" onClick={() => { setOpen(true) }}>
              <IconPlusOutlineMedium size={14} />
              {t('addList')}
            </button>
          )}
    </div>
  )
}
