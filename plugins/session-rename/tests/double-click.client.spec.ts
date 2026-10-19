// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { createHeaderTitleDoubleClickListener } from '../src/client/double-click.js'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionSummaryLike } from '../src/client/rename.js'

const SESSION = 'sess-1' as SessionId

function buildHeader(): HTMLElement {
  const header = document.createElement('header')
  header.setAttribute('data-window-drag', '')
  const nav = document.createElement('nav')
  const current = document.createElement('span')
  current.className = 'wSkVaW_crumb wSkVaW_crumbCurrent'
  current.textContent = '当前标题'
  const seg = document.createElement('span')
  seg.className = 'wSkVaW_crumbSeg'
  seg.append(current)
  nav.append(seg)
  header.append(nav)
  document.body.append(header)
  return header
}

function doubleClick(element: Element): MouseEvent {
  const event = new MouseEvent('dblclick', { bubbles: true })
  element.dispatchEvent(event)
  return event
}

describe('createHeaderTitleDoubleClickListener', () => {
  it('命中标题时按目录行事实弹出请求，并清除双击选词高亮', () => {
    buildHeader()
    document.body.appendChild(document.createTextNode('选区'))
    const selection = document.getSelection()
    selection?.selectAllChildren(document.body)
    const requestRename = vi.fn()
    const listener = createHeaderTitleDoubleClickListener({
      currentSessionId: () => SESSION,
      summaryOf: () => ({ title: '  旧标题  ', blank: false }),
      requestRename,
    })
    listener(doubleClick(document.querySelector('[class*="crumbCurrent"]') as Element))
    expect(requestRename).toHaveBeenCalledWith({ sessionId: SESSION, currentTitle: '旧标题' })
    expect(selection?.rangeCount).toBe(0)
  })

  it('空白会话不弹窗', () => {
    buildHeader()
    const requestRename = vi.fn()
    const listener = createHeaderTitleDoubleClickListener({
      currentSessionId: () => SESSION,
      summaryOf: () => ({ blank: true }),
      requestRename,
    })
    listener(doubleClick(document.querySelector('[class*="crumbCurrent"]') as Element))
    expect(requestRename).not.toHaveBeenCalled()
  })

  it('无当前会话或目录缺行不弹窗', () => {
    buildHeader()
    const target = document.querySelector('[class*="crumbCurrent"]') as Element
    const requestRename = vi.fn()
    createHeaderTitleDoubleClickListener({
      currentSessionId: () => undefined,
      summaryOf: () => ({ blank: false }),
      requestRename,
    })(doubleClick(target))
    createHeaderTitleDoubleClickListener({
      currentSessionId: () => SESSION,
      summaryOf: () => undefined,
      requestRename,
    })(doubleClick(target))
    expect(requestRename).not.toHaveBeenCalled()
  })

  it('非标题目标不弹窗', () => {
    buildHeader()
    const requestRename = vi.fn()
    const listener = createHeaderTitleDoubleClickListener({
      currentSessionId: () => SESSION,
      summaryOf: () => ({ blank: false } satisfies SessionSummaryLike),
      requestRename,
    })
    const outside = document.createElement('div')
    document.body.append(outside)
    listener(doubleClick(outside))
    expect(requestRename).not.toHaveBeenCalled()
  })
})
