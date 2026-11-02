import { describe, expect, it, vi } from 'vitest'
import { insertAtCaret } from '../src/client/insert.js'
import type { InsertActions } from '../src/client/insert.js'

function fakeActions(result: boolean[]): InsertActions & { spans: unknown[] } {
  const spans: unknown[] = []
  let call = 0
  return {
    spans,
    captureInsertion: vi.fn(() => {
      const span = { start: call, end: call, draftRev: call }
      call += 1
      spans.push(span)
      return span
    }),
    insertText: vi.fn(() => result[Math.min(call - 1, result.length - 1)] ?? false),
  }
}

describe('insertAtCaret', () => {
  it('首次插入成功：捕获一次、插入一次', () => {
    const actions = fakeActions([true])
    expect(insertAtCaret(actions, '帮我总结')).toBe(true)
    expect(actions.captureInsertion).toHaveBeenCalledTimes(1)
    expect(actions.insertText).toHaveBeenCalledTimes(1)
    expect(actions.insertText).toHaveBeenCalledWith('帮我总结', actions.spans[0])
  })

  it('草稿并发变化时重取光标重试一次', () => {
    const actions = fakeActions([false, true])
    expect(insertAtCaret(actions, '继续')).toBe(true)
    expect(actions.captureInsertion).toHaveBeenCalledTimes(2)
    expect(actions.insertText).toHaveBeenCalledTimes(2)
    expect(actions.insertText).toHaveBeenLastCalledWith('继续', actions.spans[1])
  })

  it('重试仍失败返回 false（提交锁定），不第三次尝试', () => {
    const actions = fakeActions([false, false])
    expect(insertAtCaret(actions, '再试')).toBe(false)
    expect(actions.captureInsertion).toHaveBeenCalledTimes(2)
    expect(actions.insertText).toHaveBeenCalledTimes(2)
  })

  it('空文本直接成功（无操作）', () => {
    const actions = fakeActions([])
    expect(insertAtCaret(actions, '')).toBe(true)
    expect(actions.captureInsertion).not.toHaveBeenCalled()
    expect(actions.insertText).not.toHaveBeenCalled()
  })
})
