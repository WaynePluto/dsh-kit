import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { boardPath, loadOrSeedBoard, readBoard, writeBoard } from '../src/store.js'
import { seedBoard } from '../src/shared.js'
import { dispatch } from '../src/index.js'

const homes: string[] = []

function home(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-task-board-'))
  homes.push(dir)
  return dir
}

afterEach(() => {
  while (homes.length > 0) {
    const dir = homes.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

describe('store', () => {
  it('文件缺失时 readBoard 返回 undefined', () => {
    expect(readBoard(home())).toBeUndefined()
  })

  it('loadOrSeedBoard 播种一次后不再播种', () => {
    const dir = home()
    const first = loadOrSeedBoard(dir, 'zh')
    expect(first.seeded).toBe(true)
    expect(first.board.lists.map(item => item.title)).toEqual(['待办', '进行中', '已完成'])
    const second = loadOrSeedBoard(dir, 'en')
    expect(second.seeded).toBe(false)
    // 已有文件不被第二次调用的语言覆盖。
    expect(second.board.lists.map(item => item.title)).toEqual(['待办', '进行中', '已完成'])
  })

  it('writeBoard 原子落盘且可读回', () => {
    const dir = home()
    const board = seedBoard('en')
    writeBoard(dir, board)
    expect(readBoard(dir)).toEqual(board)
    expect(existsSync(join(dir, 'dsh-kit', 'task-board.json'))).toBe(true)
  })

  it('损坏文件按空板处理，下一次 put 可恢复', () => {
    const dir = home()
    mkdirSync(join(dir, 'dsh-kit'), { recursive: true })
    writeFileSync(boardPath(dir), '{oops', 'utf8')
    expect(readBoard(dir)).toBeUndefined()
    writeBoard(dir, seedBoard('zh'))
    expect(readBoard(dir)?.lists.length).toBe(3)
  })

  it('半写坏字段被宽容裁剪而不是判死', () => {
    const dir = home()
    writeBoard(dir, seedBoard('zh'))
    const raw = JSON.parse(readFileSync(boardPath(dir), 'utf8')) as {
      lists: Array<{ id: string, title: string, cards: unknown[] }>
    }
    raw.lists[0]?.cards.push('junk')
    writeFileSync(boardPath(dir), JSON.stringify(raw), 'utf8')
    expect(readBoard(dir)?.lists[0]?.cards.length).toBe(0)
  })
})

describe('dispatch', () => {
  it('未知 endpoint 拒绝', () => {
    const result = dispatch('nope', {}, home())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('task-board/unknown-endpoint')
  })

  it('get 播种与二次读取', () => {
    const dir = home()
    const first = dispatch('get', { seed: 'en' }, dir)
    expect(first.ok).toBe(true)
    if (first.ok) {
      expect((first.value as { seeded: boolean }).seeded).toBe(true)
    }
    const second = dispatch('get', {}, dir)
    expect(second.ok).toBe(true)
    if (second.ok) {
      expect((second.value as { seeded: boolean }).seeded).toBe(false)
    }
  })

  it('put 校验并落盘，坏文档拒绝且不写', () => {
    const dir = home()
    const board = seedBoard('zh')
    const ok = dispatch('put', { board }, dir)
    expect(ok.ok).toBe(true)
    if (ok.ok) {
      expect((ok.value as { lists: number, cards: number }).lists).toBe(3)
    }
    expect(readBoard(dir)).toEqual(board)

    const bad = dispatch('put', { board: { version: 1, lists: 'x' } }, dir)
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error.code).toBe('task-board/bad-payload')
    // 拒绝写入不影响已存文档。
    expect(readBoard(dir)).toEqual(board)
  })
})
