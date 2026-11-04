import { describe, expect, it } from 'vitest'
import {
  addCard, addList, admissibleImages, clearCards, deleteCard, deleteList,
  listIndexOfCard, moveCard, moveList, renameList, totalImageChars, updateCard,
} from '../src/client/board-ops.js'
import type { BoardCardImage, BoardDocument } from '../src/shared.js'
import { MAX_IMAGES_PER_CARD, MAX_TOTAL_IMAGE_CHARS } from '../src/shared.js'

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

  it('clearCards 只清空目标列；空列或未知列无操作', () => {
    const base = board()
    const cleared = clearCards(base, 'l1')
    expect(ids(cleared, 'l1')).toEqual([])
    expect(ids(cleared, 'l2')).toEqual(['l2-c1', 'l2-c2', 'l2-c3'])
    expect(cleared.lists[0]).not.toBe(base.lists[0])
    expect(cleared.lists[1]).toBe(base.lists[1])
    expect(clearCards(base, 'l3')).toBe(base)
    expect(clearCards(base, 'nope')).toBe(base)
  })

  it('addCard 支持标题与图片；updateCard 可改标题/图片/清空', () => {
    const base = board()
    const created = addCard(base, 'l3', '  new task  ', {
      title: '  卡片标题  ',
      images: [image('i1')],
      workspaceId: 'w1',
    })
    const added = created.lists[2]?.cards[0]
    expect(added?.text).toBe('new task')
    expect(added?.title).toBe('卡片标题')
    expect(added?.images).toEqual([image('i1')])
    expect(added?.workspaceId).toBe('w1')

    const retitled = updateCard(created, added?.id ?? '', { title: '改过的标题' })
    expect(retitled.lists[2]?.cards[0]?.title).toBe('改过的标题')
    const clearedTitle = updateCard(retitled, added?.id ?? '', { title: null })
    expect(clearedTitle.lists[2]?.cards[0]?.title).toBeUndefined()
    const replaced = updateCard(clearedTitle, added?.id ?? '', { images: [image('i2', 'b.webp', 'image/webp')] })
    expect(replaced.lists[2]?.cards[0]?.images?.map(item => item.id)).toEqual(['i2'])
    const removed = updateCard(replaced, added?.id ?? '', { images: null })
    expect(removed.lists[2]?.cards[0]?.images).toBeUndefined()
    // 重复写入相同值不产生新文档。
    expect(updateCard(removed, added?.id ?? '', { images: null })).toBe(removed)
  })

  it('同一 patch 里文本未变化时仍可改标题/图片', () => {
    const base = board()
    const id = 'l1-c1'
    const next = updateCard(base, id, { text: base.lists[0]?.cards[0]?.text ?? '', title: '新标题' })
    expect(next.lists[0]?.cards[0]?.title).toBe('新标题')
    expect(next.lists[0]?.cards[0]?.text).toBe(base.lists[0]?.cards[0]?.text)
  })

  it('admissibleImages 按单卡张数与整板总量双重裁剪', () => {
    const current = [image('i1')]
    const incoming = Array.from({ length: MAX_IMAGES_PER_CARD }, (_unused, index) => image(`n${String(index)}`))
    const limited = admissibleImages(current, incoming, 0)
    expect(limited.images).toHaveLength(MAX_IMAGES_PER_CARD)
    expect(limited.dropped).toBe(1)
    expect(limited.reason).toBe('imageLimit')

    const oversized = admissibleImages([], [image('big', 'big.png', 'image/png', 'A'.repeat(MAX_TOTAL_IMAGE_CHARS))], 0)
    expect(oversized.images).toHaveLength(0)
    expect(oversized.reason).toBe('imageTotalTooLarge')
  })

  it('totalImageChars 累计全板图片长度', () => {
    const withImage = addCard(board(), 'l3', 't', { images: [image('i1'), image('i2')] })
    expect(totalImageChars(withImage)).toBe(image('i1').dataUrl.length + image('i2').dataUrl.length)
  })
})

/** 测试用图片工厂。 */
function image(id: string, name = 'a.png', mediaType: BoardCardImage['mediaType'] = 'image/png', payload = 'iVBORw0KGgo='): BoardCardImage {
  return { id, name, mediaType, dataUrl: `data:${mediaType};base64,${payload}` }
}

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

  it('置顶（同列移到下标 0）：后置顶的排最前，已是第一张则无操作', () => {
    // 置第三张 → 第一，其余顺序后移。
    const first = moveCard(board(), 'l1-c3', 'l1', 0)
    expect(ids(first, 'l1')).toEqual(['l1-c3', 'l1-c1', 'l1-c2'])
    // 再置原第一张 → 它回到最前，之前置顶的变成第二。
    const second = moveCard(first, 'l1-c1', 'l1', 0)
    expect(ids(second, 'l1')).toEqual(['l1-c1', 'l1-c3', 'l1-c2'])
    // 已在列首再点置顶：返回原文档引用。
    expect(moveCard(second, 'l1-c1', 'l1', 0)).toBe(second)
  })
})
