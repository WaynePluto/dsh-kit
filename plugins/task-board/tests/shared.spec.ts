import { describe, expect, it } from 'vitest'
import {
  isBoardDocument, isGetPayload, normalizeBoard, seedBoard,
  MAX_CARDS_PER_LIST, MAX_CARD_TEXT_LENGTH, MAX_LISTS, MAX_LIST_TITLE_LENGTH,
} from '../src/shared.js'
import type { BoardCard, BoardDocument, BoardList } from '../src/shared.js'

function card(over: Partial<BoardCard> = {}): BoardCard {
  return {
    id: 'c1',
    text: 'hello',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

function list(over: Partial<BoardList> = {}): BoardList {
  return { id: 'l1', title: 'todo', cards: [card()], ...over }
}

describe('isBoardDocument', () => {
  it('接受最小良构文档', () => {
    expect(isBoardDocument({ version: 1, lists: [] })).toBe(true)
    expect(isBoardDocument({ version: 1, lists: [list()] })).toBe(true)
  })

  it('拒绝结构缺陷', () => {
    expect(isBoardDocument(null)).toBe(false)
    expect(isBoardDocument({})).toBe(false)
    expect(isBoardDocument({ version: 2, lists: [] })).toBe(false)
    expect(isBoardDocument({ version: 1, lists: {} })).toBe(false)
    expect(isBoardDocument({ version: 1, lists: [{ id: '', title: 'x', cards: [] }] })).toBe(false)
    expect(isBoardDocument({ version: 1, lists: [{ id: 'l', title: 'x', cards: [card({ id: '' })] }] })).toBe(false)
    expect(isBoardDocument({ version: 1, lists: [{ id: 'l', title: 'x', cards: [{ id: 'c' }] }] })).toBe(false)
  })

  it('workspaceId 只接受非空字符串或缺省', () => {
    expect(isBoardDocument({ version: 1, lists: [list({ cards: [card({ workspaceId: 'w1' })] })] })).toBe(true)
    expect(isBoardDocument({ version: 1, lists: [list({ cards: [card({ workspaceId: '' })] })] })).toBe(false)
  })

  it('拒绝越界（列数/单列卡片/文本/标题）', () => {
    const manyLists = Array.from({ length: MAX_LISTS + 1 }, (_unused, index) => list({ id: `l${String(index)}`, cards: [] }))
    expect(isBoardDocument({ version: 1, lists: manyLists })).toBe(false)

    const manyCards = Array.from({ length: MAX_CARDS_PER_LIST + 1 }, (_unused, index) => card({ id: `c${String(index)}` }))
    expect(isBoardDocument({ version: 1, lists: [list({ cards: manyCards })] })).toBe(false)

    expect(isBoardDocument({ version: 1, lists: [list({ cards: [card({ text: 'x'.repeat(MAX_CARD_TEXT_LENGTH + 1) })] })] })).toBe(false)
    expect(isBoardDocument({ version: 1, lists: [list({ title: 'x'.repeat(MAX_LIST_TITLE_LENGTH + 1) })] })).toBe(false)
  })
})

describe('normalizeBoard', () => {
  it('坏输入整体退化为空板', () => {
    expect(normalizeBoard(undefined)).toEqual({ version: 1, lists: [] })
    expect(normalizeBoard('nope')).toEqual({ version: 1, lists: [] })
    expect(normalizeBoard({ version: 1, lists: 'nope' })).toEqual({ version: 1, lists: [] })
  })

  it('逐条丢弃坏行并按上限裁剪', () => {
    const mixed = {
      version: 1,
      lists: [
        list(),
        null,
        { id: 'l1', title: 'dup id', cards: [] },
        { id: 'l2', title: 'ok', cards: [card(), { id: 'c1' }, 'junk', card({ id: 'c2', text: 'y'.repeat(9000) })] },
      ],
    }
    const normalized = normalizeBoard(mixed)
    expect(normalized.lists.map(item => item.id)).toEqual(['l1', 'l2'])
    expect(normalized.lists[1]?.cards.length).toBe(2)
    expect(normalized.lists[1]?.cards[1]?.text.length).toBe(MAX_CARD_TEXT_LENGTH)
  })
})

describe('seedBoard', () => {
  it('按语言给出三列空板', () => {
    const zh = seedBoard('zh')
    expect(zh.lists.map(item => item.title)).toEqual(['待办', '进行中', '已完成'])
    expect(zh.lists.every(item => item.cards.length === 0)).toBe(true)
    expect(seedBoard('en').lists.map(item => item.title)).toEqual(['To do', 'Doing', 'Done'])
  })
})

describe('isGetPayload', () => {
  it('接受缺省与 zh/en', () => {
    expect(isGetPayload({})).toBe(true)
    expect(isGetPayload({ seed: 'zh' })).toBe(true)
    expect(isGetPayload({ seed: 'en' })).toBe(true)
    expect(isGetPayload({ seed: 'fr' })).toBe(false)
    expect(isGetPayload(null)).toBe(false)
    expect(isGetPayload('zh')).toBe(false)
  })
})

describe('roundtrip', () => {
  it('seed 后的文档通过严格校验', () => {
    const board: BoardDocument = seedBoard('zh')
    expect(isBoardDocument(board)).toBe(true)
  })
})
