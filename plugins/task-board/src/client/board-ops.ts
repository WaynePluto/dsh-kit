/**
 * 看板文档的纯函数操作集：列表/卡片的增删改与两种拖拽落位。
 * 全部返回新文档（不原地修改），供 React 状态与单元测试共用；
 * 上限沿用 shared 的常量，越界操作原样返回同一引用（视为无操作）。
 *
 * @module @dsh-kit/dsh-plugin-task-board/client/board-ops
 */

import {
  MAX_CARDS_PER_LIST, MAX_CARD_TEXT_LENGTH, MAX_CARD_TITLE_LENGTH, MAX_IMAGES_PER_CARD,
  MAX_LISTS, MAX_LIST_TITLE_LENGTH, MAX_TOTAL_CARDS, MAX_TOTAL_IMAGE_CHARS,
  type BoardCard, type BoardCardImage, type BoardDocument, type BoardList,
} from '../shared.js'

/** 生成一个足够唯一的 id（同页内不重复即可，持久唯一性由 normalizeBoard 收敛）。 */
export function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`
}

function totalCards(board: BoardDocument): number {
  return board.lists.reduce((sum, list) => sum + list.cards.length, 0)
}

/** 整板已用图片 data URL 长度，用于新增图片前做总量门控。 */
export function totalImageChars(board: BoardDocument): number {
  return board.lists.reduce((sum, list) =>
    sum + list.cards.reduce((cardSum, card) =>
      cardSum + (card.images ?? []).reduce((imageSum, image) => imageSum + image.dataUrl.length, 0), 0), 0)
}

/**
 * 新增图片的公共门控：返回本次还能接收的图片；超上限的部分直接丢弃。
 * 页面据此给出提示，且写回的文档始终满足宿主半的严格校验。
 * @param current - 卡片现有图片。
 * @param incoming - 待加入的图片。
 * @param usedElsewhere - 板上其他图片已占用的 data URL 长度。
 * @returns 可写入的图片、被丢弃的张数与原因。
 */
export function admissibleImages(
  current: readonly BoardCardImage[],
  incoming: readonly BoardCardImage[],
  usedElsewhere: number,
): { images: BoardCardImage[], dropped: number, reason: 'imageLimit' | 'imageTotalTooLarge' | undefined } {
  const images = [...current]
  let used = usedElsewhere + images.reduce((sum, image) => sum + image.dataUrl.length, 0)
  let dropped = 0
  let reason: 'imageLimit' | 'imageTotalTooLarge' | undefined
  for (const image of incoming) {
    if (images.length >= MAX_IMAGES_PER_CARD) {
      dropped += 1
      reason = 'imageLimit'
      continue
    }
    if (used + image.dataUrl.length > MAX_TOTAL_IMAGE_CHARS) {
      dropped += 1
      reason = 'imageTotalTooLarge'
      continue
    }
    images.push(image)
    used += image.dataUrl.length
  }
  return { images, dropped, reason }
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
 * 新建卡片（插入列首）。
 * @param board - 当前文档。
 * @param listId - 目标列。
 * @param text - 卡片文本。
 * @param options - 可选标题、图片与目标工作区；缺省工作区 = 默认落点。
 * @returns 新文档；文本为空或列/总数超上限时返回原文档。
 */
export function addCard(
  board: BoardDocument,
  listId: string,
  text: string,
  options: { title?: string, images?: readonly BoardCardImage[], workspaceId?: string } = {},
): BoardDocument {
  const value = text.trim().slice(0, MAX_CARD_TEXT_LENGTH)
  if (value === '') return board
  const list = board.lists.find(item => item.id === listId)
  if (list === undefined || list.cards.length >= MAX_CARDS_PER_LIST) return board
  if (totalCards(board) >= MAX_TOTAL_CARDS) return board
  const title = options.title?.trim().slice(0, MAX_CARD_TITLE_LENGTH) ?? ''
  const now = new Date().toISOString()
  const card: BoardCard = {
    id: newId('card'),
    text: value,
    ...title === '' ? {} : { title },
    ...options.images === undefined || options.images.length === 0 ? {} : { images: options.images },
    ...options.workspaceId === undefined || options.workspaceId === '' ? {} : { workspaceId: options.workspaceId },
    createdAt: now,
    updatedAt: now,
  }
  return {
    ...board,
    lists: board.lists.map(item => item.id === listId ? { ...item, cards: [card, ...item.cards] } : item),
  }
}

/**
 * 修改卡片的标题、文本、图片与目标工作区（就地编辑的落位）。
 * @param board - 当前文档。
 * @param cardId - 目标卡片。
 * @param patch - 要改的字段；`title`/`workspaceId`/`images` 为 null 时清除，
 *   `images` 为数组时按上限裁剪后整体替换。
 */
export function updateCard(
  board: BoardDocument,
  cardId: string,
  patch: {
    text?: string,
    title?: string | null,
    images?: readonly BoardCardImage[] | null,
    workspaceId?: string | null,
  },
): BoardDocument {
  let changed = false
  const lists = board.lists.map(list => {
    const index = list.cards.findIndex(card => card.id === cardId)
    if (index < 0) return list
    const card = list.cards[index]
    if (card === undefined) return list
    let text = card.text
    let title = card.title
    let images = card.images
    let workspaceId = card.workspaceId
    if (patch.text !== undefined) {
      const value = patch.text.trim().slice(0, MAX_CARD_TEXT_LENGTH)
      // 空/未变化的文本只跳过这一字段，不能把同一 patch 的标题/图片改动一起丢掉。
      if (value !== '' && value !== card.text) {
        text = value
        changed = true
      }
    }
    if (patch.title !== undefined) {
      const value = patch.title === null ? undefined : patch.title.trim().slice(0, MAX_CARD_TITLE_LENGTH) || undefined
      if (value !== card.title) {
        title = value
        changed = true
      }
    }
    if (patch.images !== undefined) {
      const value = patch.images === null ? undefined : patch.images.slice(0, MAX_IMAGES_PER_CARD)
      const previous = card.images ?? []
      if (value === undefined ? previous.length > 0 : value.length !== previous.length || value.some((image, at) => image !== previous[at])) {
        images = value
        changed = true
      }
    }
    if (patch.workspaceId !== undefined) {
      const value = patch.workspaceId === null || patch.workspaceId === '' ? undefined : patch.workspaceId
      if (value !== card.workspaceId) {
        workspaceId = value
        changed = true
      }
    }
    if (!changed) return list
    const { title: _oldTitle, images: _oldImages, workspaceId: _previous, ...rest } = card
    const next: BoardCard = {
      ...rest,
      text,
      ...title === undefined ? {} : { title },
      ...images === undefined || images.length === 0 ? {} : { images },
      ...workspaceId === undefined ? {} : { workspaceId },
      updatedAt: new Date().toISOString(),
    }
    const cards = [...list.cards]
    cards[index] = next
    return { ...list, cards }
  })
  return changed ? { ...board, lists } : board
}

/**
 * 清空一列的全部卡片（最后一列「清空所有卡片」的落位）。
 * @param board - 当前文档。
 * @param listId - 目标列。
 * @returns 新文档；列不存在或本来就是空列时返回原文档。
 */
export function clearCards(board: BoardDocument, listId: string): BoardDocument {
  const list = board.lists.find(item => item.id === listId)
  if (list === undefined || list.cards.length === 0) return board
  return { ...board, lists: board.lists.map(item => item.id === listId ? { ...item, cards: [] } : item) }
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
