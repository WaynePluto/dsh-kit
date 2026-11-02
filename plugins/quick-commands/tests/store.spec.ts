import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { commandsPath, loadOrEmpty, readCommands, writeCommands } from '../src/store.js'
import { emptyDocument } from '../src/shared.js'
import type { QuickCommandDocument } from '../src/shared.js'
import { dispatch } from '../src/index.js'

const homes: string[] = []

function home(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-quick-commands-'))
  homes.push(dir)
  return dir
}

function documentWith(commands: Array<{ id: string, text: string }>): QuickCommandDocument {
  const now = '2026-11-02T00:00:00.000Z'
  return {
    version: 1,
    commands: commands.map(item => ({
      id: item.id,
      text: item.text,
      createdAt: now,
      updatedAt: now,
    })),
  }
}

afterEach(() => {
  while (homes.length > 0) {
    const dir = homes.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

describe('store', () => {
  it('文件缺失时 readCommands 返回 undefined、loadOrEmpty 回空文档', () => {
    const dir = home()
    expect(readCommands(dir)).toBeUndefined()
    expect(loadOrEmpty(dir)).toEqual(emptyDocument())
  })

  it('writeCommands 原子落盘且可读回', () => {
    const dir = home()
    const doc = documentWith([{ id: 'a', text: '总结一下' }])
    writeCommands(dir, doc)
    expect(readCommands(dir)).toEqual(doc)
    expect(existsSync(join(dir, 'dsh-kit', 'quick-commands.json'))).toBe(true)
  })

  it('损坏文件按空文档处理，下一次 put 可恢复', () => {
    const dir = home()
    mkdirSync(join(dir, 'dsh-kit'), { recursive: true })
    writeFileSync(commandsPath(dir), '{oops', 'utf8')
    expect(readCommands(dir)).toBeUndefined()
    expect(loadOrEmpty(dir)).toEqual(emptyDocument())
    const doc = documentWith([{ id: 'a', text: '继续' }])
    writeCommands(dir, doc)
    expect(readCommands(dir)).toEqual(doc)
  })

  it('半写坏字段被宽容裁剪而不是判死', () => {
    const dir = home()
    writeCommands(dir, documentWith([{ id: 'a', text: 'ok' }]))
    const raw = JSON.parse(readFileSync(commandsPath(dir), 'utf8')) as { commands: unknown[] }
    raw.commands.push('junk')
    writeFileSync(commandsPath(dir), JSON.stringify(raw), 'utf8')
    expect(readCommands(dir)?.commands.length).toBe(1)
  })
})

describe('dispatch', () => {
  it('未知 endpoint 拒绝', () => {
    const result = dispatch('nope', {}, home())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('quick-commands/unknown-endpoint')
  })

  it('get 缺文件返回空文档（零播种）', () => {
    const dir = home()
    const first = dispatch('get', {}, dir)
    expect(first.ok).toBe(true)
    if (first.ok) expect(first.value).toEqual(emptyDocument())
    const second = dispatch('get', {}, dir)
    expect(second.ok).toBe(true)
    if (second.ok) expect(second.value).toEqual(emptyDocument())
  })

  it('put 校验并落盘，坏文档拒绝且不写', () => {
    const dir = home()
    const doc = documentWith([{ id: 'a', text: '跑一下测试' }])
    const ok = dispatch('put', { document: doc }, dir)
    expect(ok.ok).toBe(true)
    if (ok.ok) expect((ok.value as { commands: number }).commands).toBe(1)
    expect(readCommands(dir)).toEqual(doc)

    const bad = dispatch('put', { document: { version: 1, commands: 'x' } }, dir)
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error.code).toBe('quick-commands/bad-payload')
    // 拒绝写入不影响已存文档。
    expect(readCommands(dir)).toEqual(doc)
  })
})
