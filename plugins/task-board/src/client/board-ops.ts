/**
 * 看板文档的纯函数操作集：列表/卡片的增删改与两种拖拽落位。
 * 全部返回新文档（不原地修改），供 React 状态与单元测试共用；
 * 上限沿用 shared 的常量，越界操作原样返回同一引用（视为无操作）。
 *
 * @module @dsh-kit/dsh-plugin-task-board/client/board-ops
 */

import {
  MAX_CARDS_PER_LIST, MAX_CARD_TEXT_LENGTH, MAX_LISTS, MAX_LIST_TITLE_LENGTH, MAX_TOTAL_CARDS,
  type BoardCard, type BoardDocument, type BoardList,
} from '../shared.js'

/** 生成一个足够唯一的 id（同页内不重复即可，持久唯一性由 normalizeBoard 收敛）。 */
export function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`
}

function totalCards(board: BoardDocument): number {
  return board.lists.reduce((sum, list) => sum + list.cards.length, 0)
}

/**
 * 新建空列（追加到最右）。
 * @param board - 当前文档。
 * @param title - 列标题（调用方已裁剪长度）。
 * @returns 新文档；列数已达上限时返回原文档。
 */
export function addList(board: BoardDocument, title: string): BoardDocument {
  if (board.lists.length >= MAX_LISTS) return board
  const list: BoardList = { id: newId('list'), title: title.slice(0, MAX_LIST_TITLE_LENGTH), cards: [] }
  return { ...board, lists: [...board.lists, list] }
}

/**
 * 重命名列。
 * @param board - 当前文档。
 * @param listId - 目标列。
 * @param title - 新标题；空串原样返回（列不允许无标题，调用方先回退占位文案）。
 */
export function renameList(board: BoardDocument, listId: string, title: string): BoardDocument {
  const trimmed = title.trim().slice(0, MAX_LIST_TITLE_LENGTH)
  if (trimmed === '') return board
  if (board.lists.find(list => list.id === listId)?.title === trimmed) return board
  return {
    ...board,
    lists: board.lists.map(list => list.id === listId ? { ...list, title: trimmed } : list),
  }
}

/**
 * 删除列。
 * @param board - 当前文档。
 * @param listId - 目标列。
 */
export function deleteList(board: BoardDocument, listId: string): BoardDocument {
  return { ...board, lists: board.lists.filter(list => list.id !== listId) }
}

/**
 * 调换列位置（横向拖拽的落位）。
 * @param board - 当前文档。
 * @param listId - 被拖拽的列。
 * @param toIndex - 目标下标（以拖拽前的列表坐标表达；越界时钳到首尾）。
 */
export function moveList(board: BoardDocument, listId: string, toIndex: number): BoardDocument {
  const from = board.lists.findIndex(list => list.id === listId)
  if (from < 0) return board
  const target = Math.max(0, Math.min(board.lists.length - 1, toIndex))
  if (from === target) return board
  const lists = [...board.lists]
  const [moved] = lists.splice(from, 1)
  if (moved === undefined) return board
  lists.splice(target, 0, moved)
  return { ...board, lists }
}

/**
 * 新建卡片（列尾追加）。
 * @param board - 当前文档。
 * @param listId - 目标列。
 * @param text - 卡片文本。
 * @param workspaceId - 目标工作区；缺省 = 默认落点。
 * @returns 新文档；文本为空或列/总数超上限时返回原文档。
 */
export function addCard(
  board: BoardDocument,
  listId: string,
  text: string,
  workspaceId?: string,
): BoardDocument {
  const value = text.trim().slice(0, MAX_CARD_TEXT_LENGTH)
  if (value === '') return board
  const list = board.lists.find(item => item.id === listId)
  if (list === undefined || list.cards.length >= MAX_CARDS_PER_LIST) return board
  if (totalCards(board) >= MAX_TOTAL_CARDS) return board
  const now = new Date().toISOString()
  const card: BoardCard = {
    id: newId('card'),
    text: value,
    ...workspaceId === undefined || workspaceId === '' ? {} : { workspaceId },
    createdAt: now,
    updatedAt: now,
  }
  return {
    ...board,
    lists: board.lists.map(item => item.id === listId ? { ...item, cards: [...item.cards, card] } : item),
  }
}

/**
 * 修改卡片文本与目标工作区（就地编辑的落位）。
 * @param board - 当前文档。
 * @param cardId - 目标卡片。
 * @param patch - 要改的字段；`workspaceId: null` 清除选择（回到默认落点）。
 */
export function updateCard(
  board: BoardDocument,
  cardId: string,
  patch: { text?: string, workspaceId?: string | null },
): BoardDocument {
  let changed = false
  const lists = board.lists.map(list => {
    const index = list.cards.findIndex(card => card.id === cardId)
    if (index < 0) return list
    const card = list.cards[index]
    if (card === undefined) return list
    let text = card.text
    let workspaceId = card.workspaceId
    if (patch.text !== undefined) {
      const value = patch.text.trim().slice(0, MAX_CARD_TEXT_LENGTH)
      if (value === '' || value === card.text) return list
      text = value
      changed = true
    }
    if (patch.workspaceId !== undefined) {
      const value = patch.workspaceId === null || patch.workspaceId === '' ? undefined : patch.workspaceId
      if (value !== card.workspaceId) {
        workspaceId = value
        changed = true
      }
    }
    if (!changed) return list
    const { workspaceId: _previous, ...rest } = card
    const next: BoardCard = workspaceId === undefined
      ? { ...rest, text, updatedAt: new Date().toISOString() }
      : { ...rest, text, workspaceId, updatedAt: new Date().toISOString() }
    const cards = [...list.cards]
    cards[index] = next
    return { ...list, cards }
  })
  return changed ? { ...board, lists } : board
}

/**
 * 删除卡片。
 * @param board - 当前文档。
 * @param cardId - 目标卡片。
 */
export function deleteCard(board: BoardDocument, cardId: string): BoardDocument {
  let removed = false
  const lists = board.lists.map(list => {
    if (!list.cards.some(card => card.id === cardId)) return list
    removed = true
    return { ...list, cards: list.cards.filter(card => card.id !== cardId) }
  })
  return removed ? { ...board, lists } : board
}

/** 定位卡片所在列与列内下标。 */
function locateCard(board: BoardDocument, cardId: string): { list: BoardList, index: number } | undefined {
  for (const list of board.lists) {
    const index = list.cards.findIndex(card => card.id === cardId)
    if (index >= 0) return { list, index }
  }
  return undefined
}

/**
 * 移动卡片（跨列拖拽的落位）。
 * @param board - 当前文档。
 * @param cardId - 被拖拽的卡片。
 * @param toListId - 目标列。
 * @param toIndex - 目标列内的下标；缺省追加到列尾（悬停整列时的落点）。
 * @returns 新文档；找不到卡片或目标列时返回原文档。
 */
export function moveCard(
  board: BoardDocument,
  cardId: string,
  toListId: string,
  toIndex?: number,
): BoardDocument {
  const found = locateCard(board, cardId)
  if (found === undefined) return board
  if (!board.lists.some(list => list.id === toListId)) return board
  const { list: fromList, index: currentIndex } = found
  const card = fromList.cards[currentIndex]
  if (card === undefined) return board
  const sameList = fromList.id === toListId
  // 目标下标按「移除后的数组」表达（dnd-kit 的 arrayMove 语义）；缺省追加列尾。
  const bound = toIndex ?? Number.MAX_SAFE_INTEGER
  const target = Math.max(0, Math.min(sameList ? fromList.cards.length - 1 : bound, bound))
  if (sameList && currentIndex === target) return board
  const lists = board.lists.map(list => {
    if (sameList && list.id === toListId) {
      const cards = [...list.cards]
      cards.splice(currentIndex, 1)
      cards.splice(Math.min(target, cards.length), 0, card)
      return { ...list, cards }
    }
    if (list.id === fromList.id) return { ...list, cards: list.cards.filter(item => item.id !== cardId) }
    if (list.id === toListId) {
      const cards = [...list.cards]
      cards.splice(Math.min(target, cards.length), 0, card)
      return { ...list, cards }
    }
    return list
  })
  return { ...board, lists }
}

/**
 * 定位卡片所在列的下标（第一列语义：只有 lists[0] 的卡片有发送按钮）。
 * @param board - 当前文档。
 * @param cardId - 目标卡片。
 * @returns 列下标；找不到时返回 -1。
 */
export function listIndexOfCard(board: BoardDocument, cardId: string): number {
  return board.lists.findIndex(list => list.cards.some(card => card.id === cardId))
}
