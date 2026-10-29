// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { installTabChipConfirm } from '../src/client/previewTabTitle.js'
import { PreviewTabs } from '../src/client/previewTabs.js'

function info(tabId: string, paneId: string, address: string): never {
  return {
    panel: { id: paneId },
    tab: { id: tabId, contentId: address, title: 'a.md', actions: { openResource: vi.fn() }, signal: new AbortController().signal },
  } as never
}

const address = (session: string, path: string) => `dsh-resource://file/session/${session}/${path}`

/** 原生 dockkit chip：标题 span（含插件的 preview-tab-title 标记）+ 可选关闭钮。 */
function chipIn(parent: HTMLElement, tabId: string, withClose = true): HTMLDivElement {
  const chip = document.createElement('div')
  chip.setAttribute('role', 'tab')
  chip.dataset.dockkitTab = tabId
  const title = document.createElement('span')
  title.dataset.dockkitTabTitle = ''
  const marked = document.createElement('span')
  marked.setAttribute('data-files-preview-tab-title', tabId)
  marked.textContent = 'a.md'
  title.append(marked)
  chip.append(title)
  if (withClose) {
    const close = document.createElement('button')
    close.dataset.dockkitTabClose = tabId
    chip.append(close)
  }
  parent.append(chip)
  return chip
}

/** 浮动面板头：grip 头部 + 标题区，没有 data-dockkit-tab。 */
function floatHeaderIn(parent: HTMLElement, tabId: string): HTMLElement {
  const header = document.createElement('header')
  header.dataset.dockkitFloatGrip = 'pane1'
  const titleArea = document.createElement('div')
  titleArea.dataset.dockkitFloatTitle = ''
  const marked = document.createElement('span')
  marked.setAttribute('data-files-preview-tab-title', tabId)
  marked.textContent = 'a.md'
  titleArea.append(marked)
  header.append(titleArea)
  parent.append(header)
  return header
}

function dblClick(element: Element): MouseEvent {
  const event = new MouseEvent('dblclick', { bubbles: true, cancelable: true })
  element.dispatchEvent(event)
  return event
}

let strip: HTMLElement

beforeEach(() => {
  document.body.innerHTML = ''
  strip = document.createElement('div')
  document.body.append(strip)
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('installTabChipConfirm（chip 级双击保留）', () => {
  it('双击 chip 空白处（目标不是标题文字）也把临时页签转为保留', () => {
    const manager = new PreviewTabs()
    const file = address('s', 'a.md')
    manager.open('s', 'pane1', file, () => {})
    manager.observe(info('tab1', 'pane1', file))
    expect(manager.isTemporary('tab1' as never)).toBe(true)
    const dispose = installTabChipConfirm(manager)

    const chip = chipIn(strip, 'tab1')
    const event = dblClick(chip)

    expect(manager.isTemporary('tab1' as never)).toBe(false)
    expect(event.defaultPrevented).toBe(true)
    dispose()
  })

  it('双击标题 span 与浮动页头空白同样保留', () => {
    const manager = new PreviewTabs()
    const file = address('s', 'a.md')
    manager.open('s', 'pane1', file, () => {})
    manager.observe(info('tab1', 'pane1', file))
    const dispose = installTabChipConfirm(manager)

    const chip = chipIn(strip, 'tab1')
    dblClick(chip.querySelector('[data-files-preview-tab-title]') as Element)
    expect(manager.isTemporary('tab1' as never)).toBe(false)

    const header = floatHeaderIn(strip, 'tab1')
    dblClick(header)
    expect(manager.isTemporary('tab1' as never)).toBe(false)
    dispose()
  })

  it('非文件页签（无观测记录）不拦截原生行为，关闭钮上的双击忽略', () => {
    const manager = new PreviewTabs()
    const file = address('s', 'a.md')
    manager.open('s', 'pane1', file, () => {})
    manager.observe(info('tab1', 'pane1', file))
    const dispose = installTabChipConfirm(manager)
    chipIn(strip, 'tab1')

    const foreign = chipIn(strip, 'guide-tab', false)
    const foreignEvent = dblClick(foreign)
    expect(foreignEvent.defaultPrevented).toBe(false)

    const close = strip.querySelector<HTMLButtonElement>('[data-dockkit-tab-close="tab1"]') as HTMLButtonElement
    const closeEvent = dblClick(close)
    expect(closeEvent.defaultPrevented).toBe(false)
    dispose()
  })

  it('条带空白与 dispose 之后的 dblclick 不再确认', () => {
    const manager = new PreviewTabs()
    const file = address('s', 'a.md')
    manager.open('s', 'pane1', file, () => {})
    manager.observe(info('tab1', 'pane1', file))
    const dispose = installTabChipConfirm(manager)

    const bare = dblClick(strip)
    expect(bare.defaultPrevented).toBe(false)
    expect(manager.isTemporary('tab1' as never)).toBe(true)

    dispose()
    dblClick(chipIn(strip, 'tab1'))
    expect(manager.isTemporary('tab1' as never)).toBe(true)
  })
})
