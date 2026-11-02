import { describe, expect, it } from 'vitest'
import {
  MAX_COMMAND_TEXT_LENGTH, MAX_COMMANDS,
  cleanCommandText, emptyDocument, isPutPayload, isQuickCommandDocument, normalizeDocument,
} from '../src/shared.js'
import type { QuickCommand } from '../src/shared.js'

function command(overrides: Partial<QuickCommand> = {}): QuickCommand {
  return {
    id: 'a',
    text: '帮我总结这段代码',
    createdAt: '2026-11-02T00:00:00.000Z',
    updatedAt: '2026-11-02T00:00:00.000Z',
    ...overrides,
  }
}

describe('isQuickCommandDocument', () => {
  it('良构文档通过', () => {
    expect(isQuickCommandDocument({ version: 1, commands: [command()] })).toBe(true)
  })

  it('非对象、坏版本、坏 commands 拒绝', () => {
    expect(isQuickCommandDocument(null)).toBe(false)
    expect(isQuickCommandDocument('x')).toBe(false)
    expect(isQuickCommandDocument({ version: 2, commands: [] })).toBe(false)
    expect(isQuickCommandDocument({ version: 1, commands: 'x' })).toBe(false)
  })

  it('越界拒绝：条数与单条长度', () => {
    const many = Array.from({ length: MAX_COMMANDS + 1 }, (_, index) => command({ id: `c${String(index)}` }))
    expect(isQuickCommandDocument({ version: 1, commands: many })).toBe(false)
    const long = command({ text: 'x'.repeat(MAX_COMMAND_TEXT_LENGTH + 1) })
    expect(isQuickCommandDocument({ version: 1, commands: [long] })).toBe(false)
    expect(isQuickCommandDocument({ version: 1, commands: [command()] })).toBe(true)
  })

  it('坏字段拒绝', () => {
    expect(isQuickCommandDocument({ version: 1, commands: [{ ...command(), id: '' }] })).toBe(false)
    expect(isQuickCommandDocument({ version: 1, commands: [{ ...command(), text: 1 }] })).toBe(false)
    expect(isQuickCommandDocument({ version: 1, commands: [{ ...command(), createdAt: null }] })).toBe(false)
    expect(isQuickCommandDocument({ version: 1, commands: [{ ...command(), updatedAt: null }] })).toBe(false)
  })

  it('isPutPayload 校验 { document } 信封', () => {
    expect(isPutPayload({ document: { version: 1, commands: [] } })).toBe(true)
    expect(isPutPayload({})).toBe(false)
    expect(isPutPayload(null)).toBe(false)
    expect(isPutPayload({ document: { version: 1, commands: [{ ...command(), id: '' }] } })).toBe(false)
  })
})

describe('normalizeDocument', () => {
  it('非对象与坏结构回空文档', () => {
    expect(normalizeDocument(null)).toEqual(emptyDocument())
    expect(normalizeDocument({ version: 1, commands: 'x' })).toEqual(emptyDocument())
  })

  it('丢弃坏行、按上限裁剪、去重 id', () => {
    const longText = 'y'.repeat(MAX_COMMAND_TEXT_LENGTH + 5)
    const normalized = normalizeDocument({
      version: 1,
      commands: [
        command({ id: 'keep' }),
        'junk',
        command({ id: 'keep', text: 'dup' }),
        command({ id: 'trim', text: longText }),
      ],
    })
    expect(normalized.commands.map(item => item.id)).toEqual(['keep', 'trim'])
    expect(normalized.commands[1]?.text.length).toBe(MAX_COMMAND_TEXT_LENGTH)
  })

  it('条数上限裁剪', () => {
    const many = Array.from({ length: MAX_COMMANDS + 3 }, (_, index) => command({ id: `c${String(index)}` }))
    expect(normalizeDocument({ version: 1, commands: many }).commands.length).toBe(MAX_COMMANDS)
  })
})

describe('cleanCommandText', () => {
  it('去首尾空白并截断', () => {
    expect(cleanCommandText('  hello  ')).toBe('hello')
    expect(cleanCommandText('x'.repeat(MAX_COMMAND_TEXT_LENGTH + 1)).length).toBe(MAX_COMMAND_TEXT_LENGTH)
  })
})
