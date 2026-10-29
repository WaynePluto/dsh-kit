import { describe, expect, it } from 'vitest'
import {
  addCard, addList, deleteCard, deleteList, listIndexOfCard, moveCard, moveList, renameList, updateCard,
} from '../src/client/board-ops.js'
import type { BoardDocument } from '../src/shared.js'

/** 单列工厂：listId + 卡片 id 前缀（`l1-c1` 形式的稳定 id）。 */
function makeList(listId: string, prefixes: string[]) {
  return {
    id: listId,
    title: `list ${listId}`,
    cards: prefixes.map(prefix => ({
      id: `${listId}-${prefix}`,
      text: `task ${listId}-${prefix}`,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })),
  }
}

/** 三列：l1/l2 各三张卡、l3 空列（id 稳定便于断言顺序）。 */
function board(): BoardDocument {
  return { version: 1, lists: [makeList('l1', ['c1', 'c2', 'c3']), makeList('l2', ['c1', 'c2', 'c3']), makeList('l3', [])] }
}

const ids = (document: BoardDocument, listId: string): string[] =>
  document.lists.find(list => list.id === listId)?.cards.map(card => card.id) ?? []

describe('list ops', () => {
  it('addList 追加新列并保留原列引用', () => {
    const before = board()
    const after = addList(before, 'new')
    expect(after.lists.length).toBe(4)
    expect(after.lists[3]?.title).toBe('new')
    expect(after.lists[0]).toBe(before.lists[0])
  })

  it('renameList 修剪空白且拒绝空标题', () => {
    const after = renameList(board(), 'l1', '  待办  ')
    expect(after.lists[0]?.title).toBe('待办')
    expect(renameList(after, 'l1', '   ')).toBe(after)
  })

  it('deleteList / moveList', () => {
    const afterDelete = deleteList(board(), 'l2')
    expect(afterDelete.lists.map(list => list.id)).toEqual(['l1', 'l3'])
    const moved = moveList(board(), 'l3', 0)
    expect(moved.lists.map(list => list.id)).toEqual(['l3', 'l1', 'l2'])
    // 原位与越界都是无操作（同一引用）。
    const base = board()
    expect(moveList(base, 'l1', 0)).toBe(base)
    const clamped = moveList(board(), 'l1', 99)
    expect(clamped.lists.map(list => list.id)).toEqual(['l2', 'l3', 'l1'])
  })
})

describe('card ops', () => {
  it('addCard 追加到列尾并修剪空白', () => {
    const base = board()
    const after = addCard(base, 'l3', '  new task  ')
    expect(ids(after, 'l3').length).toBe(1)
    expect(after.lists[2]?.cards[0]?.text).toBe('new task')
    expect(addCard(base, 'l3', '   ')).toBe(base)
  })

  it('updateCard 修改文本/工作区；无实际变化时同一引用', () => {
    const base = board()
    const withWorkspace = addCard(base, 'l3', 't')
    const cardId = ids(withWorkspace, 'l3')[0] ?? ''
    const set = updateCard(withWorkspace, cardId, { workspaceId: 'w9' })
    expect(set.lists[2]?.cards[0]?.workspaceId).toBe('w9')
    const cleared = updateCard(set, cardId, { workspaceId: null })
    expect(cleared.lists[2]?.cards[0]?.workspaceId).toBeUndefined()
    // 清除后再清除：无变化 → 同一引用。
    expect(updateCard(cleared, cardId, { workspaceId: null })).toBe(cleared)
    const edited = updateCard(cleared, cardId, { text: '  rewritten  ' })
    expect(edited.lists[2]?.cards[0]?.text).toBe('rewritten')
    // 空文本不修改。
    expect(updateCard(edited, cardId, { text: '   ' })).toBe(edited)
  })

  it('deleteCard / listIndexOfCard', () => {
    const after = deleteCard(board(), 'l2-c2')
    expect(ids(after, 'l2')).toEqual(['l2-c1', 'l2-c3'])
    expect(listIndexOfCard(after, 'l2-c2')).toBe(-1)
    expect(listIndexOfCard(after, 'l1-c1')).toBe(0)
  })
})

describe('moveCard', () => {
  it('同列重排（dnd arrayMove 语义：下标按移除后的数组）', () => {
    const after = moveCard(board(), 'l1-c1', 'l1', 2)
    expect(ids(after, 'l1')).toEqual(['l1-c2', 'l1-c3', 'l1-c1'])
    // 原位无操作。
    const base = board()
    expect(moveCard(base, 'l1-c2', 'l1', 1)).toBe(base)
  })

  it('跨列插入指定下标', () => {
    const after = moveCard(board(), 'l1-c3', 'l2', 1)
    expect(ids(after, 'l1')).toEqual(['l1-c1', 'l1-c2'])
    expect(ids(after, 'l2')).toEqual(['l2-c1', 'l1-c3', 'l2-c2', 'l2-c3'])
  })

  it('跨列缺省下标追加到列尾（悬停整列容器）', () => {
    const after = moveCard(board(), 'l2-c1', 'l3')
    expect(ids(after, 'l3')).toEqual(['l2-c1'])
    expect(ids(after, 'l2')).toEqual(['l2-c2', 'l2-c3'])
  })

  it('未知卡片或目标列返回原文档', () => {
    const base = board()
    expect(moveCard(base, 'nope', 'l1')).toBe(base)
    expect(moveCard(base, 'l1-c1', 'nope')).toBe(base)
  })

  it('移动不改 createdAt', () => {
    const after = moveCard(board(), 'l1-c1', 'l2', 0)
    const moved = after.lists[1]?.cards[0]
    expect(moved?.createdAt).toBe('2026-01-01T00:00:00.000Z')
  })
})
