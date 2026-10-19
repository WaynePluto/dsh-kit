import { describe, expect, it } from 'vitest'
import { renameRequestFromSummary } from '../src/client/rename.js'

const SESSION = 'sess-1' as Parameters<typeof renameRequestFromSummary>[0]

describe('renameRequestFromSummary', () => {
  it('会话不在目录时不产生请求', () => {
    expect(renameRequestFromSummary(SESSION, undefined)).toBeUndefined()
  })

  it('空白新会话不产生请求（与原生侧栏口径一致）', () => {
    expect(renameRequestFromSummary(SESSION, { blank: true })).toBeUndefined()
  })

  it('种子草稿取持久标题并 trim', () => {
    expect(renameRequestFromSummary(SESSION, { blank: false, title: '  会话标题  ' }))
      .toEqual({ sessionId: SESSION, currentTitle: '会话标题' })
  })

  it('未命名会话种子为空串，不用 displayTitle 的目录名兜底', () => {
    expect(renameRequestFromSummary(SESSION, { blank: false }))
      .toEqual({ sessionId: SESSION, currentTitle: '' })
    expect(renameRequestFromSummary(SESSION, { blank: false, title: '   ' }))
      .toEqual({ sessionId: SESSION, currentTitle: '' })
  })
})
