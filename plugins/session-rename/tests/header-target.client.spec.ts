// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { isConversationTitleTarget } from '../src/client/header-target.js'

/**
 * 仿 ui-conversation `ConversationSessionHeader` 的顶栏结构（构建后 CSS module
 * 类形如 `wSkVaW_crumbCurrent`，哈希前缀随构建变化）：nav 内每节 crumb 外包
 * 一层 crumbSeg，祖先 crumb 是 button（无 Current 类），当前会话 crumb 是带
 * crumbCurrent 的纯文本 span。
 */
function buildHeader(): { header: HTMLElement; current: HTMLElement; ancestor: HTMLElement } {
  const header = document.createElement('header')
  header.setAttribute('data-window-drag', '')
  const titleRow = document.createElement('div')
  const nav = document.createElement('nav')
  const ancestorSeg = document.createElement('span')
  const ancestor = document.createElement('button')
  ancestor.className = 'wSkVaW_crumb'
  ancestorSeg.className = 'wSkVaW_crumbSeg'
  ancestorSeg.append(ancestor)
  const currentSeg = document.createElement('span')
  currentSeg.className = 'wSkVaW_crumbSeg'
  const sep = document.createElement('span')
  sep.className = 'wSkVaW_crumbSep'
  const current = document.createElement('span')
  current.className = 'wSkVaW_crumb wSkVaW_crumbCurrent'
  currentSeg.append(sep, current)
  nav.append(ancestorSeg, currentSeg)
  titleRow.append(nav)
  header.append(titleRow)
  document.body.append(header)
  return { header, current, ancestor }
}

describe('isConversationTitleTarget', () => {
  it('双击当前会话标题命中', () => {
    const { current } = buildHeader()
    expect(isConversationTitleTarget(current)).toBe(true)
  })

  it('命中元素内层（文本节点事件冒泡到 span）也命中', () => {
    const { current } = buildHeader()
    expect(isConversationTitleTarget(current)).toBe(true)
  })

  it('祖先 crumb（可点击 button，无 Current 类）不命中', () => {
    const { ancestor } = buildHeader()
    expect(isConversationTitleTarget(ancestor)).toBe(false)
  })

  it('crumbSeg / 分隔符等祖先包装层不命中', () => {
    const { header } = buildHeader()
    const seg = header.querySelector('nav > span:last-child')
    expect(seg).not.toBeNull()
    expect(isConversationTitleTarget(seg as Element)).toBe(false)
  })

  it('不在 header[data-window-drag] 内的同名类元素不命中（防其他表面巧合）', () => {
    const outsider = document.createElement('span')
    outsider.className = 'otherHash_crumbCurrent'
    document.body.append(outsider)
    expect(isConversationTitleTarget(outsider)).toBe(false)
  })

  it('非 Element target 不命中', () => {
    expect(isConversationTitleTarget(null)).toBe(false)
    expect(isConversationTitleTarget(document)).toBe(false)
  })
})
