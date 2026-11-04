import { describe, expect, it } from 'vitest'
import {
  isBoardDocument, normalizeBoard,
  MAX_IMAGES_PER_CARD, MAX_TOTAL_IMAGE_CHARS, MAX_CARD_TITLE_LENGTH,
} from '../src/shared.js'
import type { BoardCard, BoardCardImage, BoardDocument, BoardList } from '../src/shared.js'

const PNG = 'data:image/png;base64,iVBORw0KGgo='
const WEBP = 'data:image/webp;base64,AAAA'

function image(over: Partial<BoardCardImage> = {}): BoardCardImage {
  return { id: 'i1', name: 'a.png', mediaType: 'image/png', dataUrl: PNG, ...over }
}

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

function board(lists: BoardList[] = [list()]): BoardDocument {
  return { version: 1, lists }
}

describe('卡片标题与图片：严格校验', () => {
  it('旧版无 title/images 的文档仍然通过', () => {
    expect(isBoardDocument(board())).toBe(true)
  })

  it('带标题与图片的文档通过', () => {
    expect(isBoardDocument(board([list({ cards: [card({ title: '摘要', images: [image()] })] })]))).toBe(true)
  })

  it('标题超长或类型不对时拒绝', () => {
    expect(isBoardDocument(board([list({ cards: [card({ title: 'x'.repeat(MAX_CARD_TITLE_LENGTH + 1) })] })]))).toBe(false)
    expect(isBoardDocument(board([list({ cards: [card({ title: 3 as unknown as string })] })]))).toBe(false)
  })

  it('图片 MIME、前缀、base64 字符、数量都严格校验', () => {
    const bad = (value: BoardCardImage) => isBoardDocument(board([list({ cards: [card({ images: [value] })] })]))
    expect(bad(image({ mediaType: 'image/heic' as BoardCardImage['mediaType'] }))).toBe(false)
    expect(bad(image({ dataUrl: 'data:text/html;base64,PHNjcmlwdD4=' }))).toBe(false)
    expect(bad(image({ dataUrl: `${PNG}<script>` }))).toBe(false)
    expect(bad(image({ id: '' }))).toBe(false)
    expect(bad(image({ name: 'x'.repeat(201) }))).toBe(false)
    expect(isBoardDocument(board([list({ cards: [card({
      images: Array.from({ length: MAX_IMAGES_PER_CARD + 1 }, (_unused, index) => image({ id: `i${String(index)}` })),
    })] })]))).toBe(false)
  })

  it('整板图片总长度越界拒绝', () => {
    const huge = image({ dataUrl: `data:image/png;base64,${'A'.repeat(MAX_TOTAL_IMAGE_CHARS)}` })
    expect(isBoardDocument(board([list({ cards: [card({ images: [huge] })] })]))).toBe(false)
  })
})

describe('normalizeBoard：兼容与逐条裁剪', () => {
  it('保留标题与合法图片', () => {
    const raw = { version: 1, lists: [list({ cards: [card({ title: '摘要', images: [image()] })] })] }
    expect(normalizeBoard(raw).lists[0]?.cards[0]).toEqual(card({ title: '摘要', images: [image()] }))
  })

  it('坏图片逐张丢弃但卡片本身保留', () => {
    const raw = { version: 1, lists: [list({ cards: [card({ images: [image(), image({ id: 'bad', dataUrl: 'nope' }), image({ id: 'i2', mediaType: 'image/webp', dataUrl: WEBP })] })] })] }
    const normalized = normalizeBoard(raw)
    expect(normalized.lists[0]?.cards[0]?.images?.map(item => item.id)).toEqual(['i1', 'i2'])
  })

  it('images 字段整个坏掉时按无图片处理，不丢卡片', () => {
    const raw = { version: 1, lists: [list({ cards: [card({ images: 'oops' as unknown as BoardCardImage[] })] })] }
    expect(normalizeBoard(raw).lists[0]?.cards[0]?.text).toBe('hello')
    expect(normalizeBoard(raw).lists[0]?.cards[0]?.images).toBeUndefined()
  })

  it('标题按上限裁剪、重复图片 id 保留首个', () => {
    const raw = { version: 1, lists: [list({ cards: [card({
      title: 'x'.repeat(MAX_CARD_TITLE_LENGTH + 50),
      images: [image(), image({ id: 'i1', name: 'dup.png' })],
    })] })] }
    const result = normalizeBoard(raw).lists[0]?.cards[0]
    expect(result?.title?.length).toBe(MAX_CARD_TITLE_LENGTH)
    expect(result?.images).toHaveLength(1)
  })
})
