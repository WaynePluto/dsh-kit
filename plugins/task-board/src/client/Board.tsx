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

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  DndContext, DragOverlay, KeyboardSensor, MeasuringStrategy, PointerSensor,
  closestCorners, pointerWithin, useDraggable, useDroppable, useSensor, useSensors,
} from '@dnd-kit/core'
import type { CollisionDetection, DragEndEvent, DragMoveEvent, DragOverEvent, DragStartEvent } from '@dnd-kit/core'
import {
  SortableContext, sortableKeyboardCoordinates, useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Button, Menu, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
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

/** 列槽距：列宽 284px + 列间 12px。 */
const COLUMN_SLOT_PX = 296

/**
 * 看板碰撞检测：指针落在哪个矩形内（pointerWithin），而不是 closestCorners 的
 * 「角点到角点最小距离」——后者对「高列包含小卡」的几何完全失效：列矩形的四个角
 * 永远离被拖卡片很远，空列（唯一可命中的是列容器）按角点距离几乎永远排不进第一，
 * 卡片永远拖不进空列（实机碰撞日志实证：指针深入空列内部时，33px 外的卡仍排第一，
 * 包含指针的列排第四）。悬停卡片时卡中心比列中心更近，pointerWithin 第一名是卡
 * （列内定位）；悬停空白区/空列时只剩列容器（整列落点）。键盘拖拽没有指针坐标，
 * 回退 closestCorners（卡片与列同级参与，sortableKeyboardCoordinates 的落点可解析）。
 * 列拖拽不走碰撞检测：落点由 onDragMove 的槽位换算直接给出（列的让位由自己的
 * transform 驱动，滑动的列矩形会移到指针下方，over 身份随之抖动，不可靠）。
 */
const boardCollisionDetection: CollisionDetection = args => {
  const activeType = (args.active.data.current as CardDragData | ListDragData | undefined)?.type
  if (activeType === 'list') return []
  const candidates = args.droppableContainers.filter(container => {
    if (container.id === args.active.id) return false
    const type = (container.data.current as CardDragData | ListDragData | undefined)?.type
    return type === 'card' || type === 'list'
  })
  const within = pointerWithin({ ...args, droppableContainers: candidates })
  if (within.length > 0) return within
  // 指针在一切候选之外（列间空隙/看板留白）：over 置空，让位预览归位；不回退
  // closestCorners——角点最近会把 over 抖到几何上邻近但指针并未进入的列，让位预览
  // 随之闪烁。键盘拖拽没有指针坐标，保留角点回退（sortableKeyboardCoordinates 的
  // 落点可解析）。
  if (args.pointerCoordinates !== undefined && args.pointerCoordinates !== null) return []
  return closestCorners({ ...args, droppableContainers: candidates })
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
  const [activeListId, setActiveListId] = useState<string | null>(null)
  const boardAtDragStart = useRef<BoardDocument | null>(null)
  // 列拖拽的目标槽位：onDragMove 按被拖列中心的视口坐标换算（槽距固定，槽位即落点），
  // 与 over 身份解耦——滑动的列矩形会移到指针下方，基于 over 的落点会抖动。
  const [overListId, setOverListId] = useState<string | null>(null)
  const dropIndexRef = useRef(-1)
  // 卡片拖拽悬停中的空列：虚线落点占位。
  const [hoveredListId, setHoveredListId] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const activeCard = activeCardId === null
    ? undefined
    : board.lists.flatMap(list => list.cards).find(card => card.id === activeCardId)
  const activeList = activeListId === null
    ? undefined
    : board.lists.find(list => list.id === activeListId)

  // 让位预览：拖 fromIndex 列到 toIndex 槽时，两者之间的列整体平移一个槽距。
  const fromIndex = activeListId === null ? -1 : board.lists.findIndex(list => list.id === activeListId)
  const toIndex = overListId === null ? -1 : board.lists.findIndex(list => list.id === overListId)
  const columnShift = useCallback((index: number): number => {
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return 0
    if (fromIndex < toIndex && index > fromIndex && index <= toIndex) return -COLUMN_SLOT_PX
    if (toIndex < fromIndex && index >= toIndex && index < fromIndex) return COLUMN_SLOT_PX
    return 0
  }, [fromIndex, toIndex])

  const clearListDragState = useCallback(() => {
    setActiveListId(null)
    setOverListId(null)
    dropIndexRef.current = -1
  }, [])

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const data = event.active.data.current as CardDragData | ListDragData | undefined
    boardAtDragStart.current = board
    if (data?.type === 'card') setActiveCardId(String(event.active.id))
    if (data?.type === 'list') {
      setActiveListId(String(event.active.id))
      // 起始槽位就是源列所在位置：先登记，后续 onDragMove 持续换算。
      dropIndexRef.current = board.lists.findIndex(list => list.id === String(event.active.id))
      setOverListId(dropIndexRef.current >= 0 ? board.lists[dropIndexRef.current]?.id ?? null : null)
    }
  }, [board])

  const handleDragMove = useCallback((event: DragMoveEvent) => {
    const data = event.active.data.current as CardDragData | ListDragData | undefined
    if (data?.type !== 'list') return
    // 槽 0 的左缘 = 源列初始左缘 - 源列下标 × 槽距（列只做平移让位，槽网格不动）。
    // 中心 = 初始中心 + 传感器位移 delta（不依赖 active.rect.translated 的测量时机）。
    const initial = event.active.rect.current.initial
    if (initial === null || initial === undefined) return
    const slotZeroLeft = initial.left - fromIndex * COLUMN_SLOT_PX
    const centerX = initial.left + initial.width / 2 + event.delta.x
    const slot = Math.max(0, Math.min(board.lists.length - 1, Math.floor((centerX - slotZeroLeft) / COLUMN_SLOT_PX)))
    dropIndexRef.current = slot
    setOverListId(board.lists[slot]?.id ?? null)
  }, [board.lists, fromIndex])

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
      setOverListId(null)
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
    const activeId = String(active.id)
    const overId = over === null ? null : String(over.id)
    const data = active.data.current as CardDragData | ListDragData | undefined
    if (data?.type === 'list') {
      const targetSlot = dropIndexRef.current
      clearListDragState()
      if (targetSlot >= 0 && targetSlot < board.lists.length) onChange(moveList(board, activeId, targetSlot))
      return
    }
    setActiveCardId(null)
    setHoveredListId(null)
    setOverListId(null)
    if (over === null || overId === null) return
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
    }
  }, [board, onChange, clearListDragState])

  const handleDragCancel = useCallback(() => {
    const start = boardAtDragStart.current
    boardAtDragStart.current = null
    clearListDragState()
    setActiveCardId(null)
    setHoveredListId(null)
    if (start !== null && start !== board) onChange(start)
  }, [board, onChange, clearListDragState])

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={boardCollisionDetection}
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      {board.lists.map((list, index) => (
        <BoardColumn
          key={list.id}
          list={list}
          isFirst={index === 0}
          shift={columnShift(index)}
          board={board}
          onChange={onChange}
          deps={deps}
          hoverHint={hoveredListId === list.id && list.cards.length === 0}
        />
      ))}
      <AddListControl board={board} onChange={onChange} translate={deps.translate} />
      <DragOverlay>
        {activeCard !== undefined
          ? (
            <div className="dsh-task-board-overlayCard">
              <CardFace card={activeCard} deps={deps} />
            </div>
            )
          : activeList !== undefined
            ? (
                <ListOverlay list={activeList} deps={deps} />
              )
            : null}
      </DragOverlay>
    </DndContext>
  )
}

/** 卡片所在列 id；找不到时 undefined。 */
function containingListId(board: BoardDocument, cardId: string): string | undefined {
  return board.lists.find(list => list.cards.some(card => card.id === cardId))?.id
}

// ── 列 ──────────────────────────────────────────────────────────────────────

/** 一列：头部是拖拽手柄 + 标题就地编辑；卡片区纵向排序滚动；尾部新增卡片。 */
function BoardColumn({ list, isFirst, shift, board, onChange, deps, hoverHint }: {
  list: { readonly id: string, readonly title: string, readonly cards: readonly BoardCardModel[] }
  isFirst: boolean
  /** 让位位移（px）：源列之外的列在拖拽跨过时平移一个槽距。 */
  shift: number
  board: BoardDocument
  onChange: (next: BoardDocument) => void
  deps: BoardDeps
  hoverHint: boolean
}) {
  const t = deps.translate
  const { setNodeRef: setDroppableRef } = useDroppable({ id: list.id, data: { type: 'list' } satisfies ListDragData })
  const { attributes, listeners, setNodeRef: setHandleRef, isDragging } =
    useDraggable({ id: list.id, data: { type: 'list' } satisfies ListDragData })
  const [titleEditing, setTitleEditing] = useState(false)
  const [adding, setAdding] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  return (
    <section
      ref={setDroppableRef}
      style={{
        transform: shift === 0 ? undefined : `translateX(${String(shift)}px)`,
        // 源列（isDragging）由悬浮影列代表，本体不动也让位动画不打在它身上。
        transition: isDragging ? undefined : 'transform 200ms ease',
      }}
      className={`dsh-task-board-list${isDragging ? ' dsh-task-board-listSource' : ''}`}
      data-dsh-task-board-list={list.id}
    >
      <header
        ref={setHandleRef}
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
                className="dsh-task-board-iconBtn dsh-task-board-listDelete"
                title={t('deleteList')}
                aria-label={t('deleteList')}
                onClick={() => { setDeleteOpen(true) }}
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
      <Modal
        open={deleteOpen}
        onClose={() => { setDeleteOpen(false) }}
        title={t('deleteList')}
        closeLabel={t('cancel')}
        description={fill(t('deleteListConfirm'), { title: list.title, count: list.cards.length })}
        footer={(
          <>
            <Button variant="outline" onClick={() => { setDeleteOpen(false) }}>{t('cancel')}</Button>
            <Button
              variant="outline"
              className="dsh-task-board-confirmDanger"
              onClick={() => {
                setDeleteOpen(false)
                onChange(deleteList(board, list.id))
              }}
            >
              {t('delete')}
            </Button>
          </>
        )}
      />
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

/** 悬浮影列：列拖拽时跟随指针的列形快照（卡片同款体验），源列原地变暗作落点占位。 */
function ListOverlay({ list, deps }: { list: { readonly id: string, readonly title: string, readonly cards: readonly BoardCardModel[] }, deps: BoardDeps }) {
  return (
    <div className="dsh-task-board-overlayList">
      <div className="dsh-task-board-overlayListHead">
        <h3 className="dsh-task-board-listTitle">{list.title}</h3>
        <span className="dsh-task-board-listCount">{String(list.cards.length)}</span>
      </div>
      <div className="dsh-task-board-cards">
        {list.cards.map(card => (
          <div key={card.id} className="dsh-task-board-card">
            <CardFace card={card} deps={deps} />
          </div>
        ))}
      </div>
    </div>
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
