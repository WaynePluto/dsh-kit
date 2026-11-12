// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installNavigatorAutoOpen } from './navigatorAutoOpen.js'

let dispose: (() => void) | undefined

/** 造一个预览页签头部的树开关按钮，放进指定的分栏容器。 */
function toggleIn(container: HTMLElement, expanded: 'true' | 'false'): HTMLButtonElement {
  const button = document.createElement('button')
  button.setAttribute('data-files-navigator-toggle', '')
  button.setAttribute('aria-expanded', expanded)
  container.append(button)
  return button
}

function dockPane(id: string): HTMLElement {
  const pane = document.createElement('div')
  pane.dataset.dockkitPane = id
  document.body.append(pane)
  return pane
}

beforeEach(() => {
  document.body.innerHTML = ''
})

afterEach(() => {
  dispose?.()
  dispose = undefined
})

/** 等待 MutationObserver 回调与合成 click 的同步链落定。 */
async function settle(): Promise<void> {
  await new Promise(resolve => { setTimeout(resolve, 0) })
}

describe('installNavigatorAutoOpen（目录树默认展开）', () => {
  it('收起态开关挂载时代点一次展开', async () => {
    const pane = dockPane('pane1')
    const button = toggleIn(pane, 'false')
    const click = vi.fn()
    button.addEventListener('click', click)
    dispose = installNavigatorAutoOpen()
    await settle()
    expect(click).toHaveBeenCalledOnce()
  })

  it('已展开的开关、缺少 pane 的开关都不代点', async () => {
    const pane = dockPane('pane1')
    const expanded = toggleIn(pane, 'true')
    const orphan = toggleIn(document.body, 'false')
    const expandedClick = vi.fn()
    const orphanClick = vi.fn()
    expanded.addEventListener('click', expandedClick)
    orphan.addEventListener('click', orphanClick)
    dispose = installNavigatorAutoOpen()
    await settle()
    expect(expandedClick).not.toHaveBeenCalled()
    expect(orphanClick).not.toHaveBeenCalled()
  })

  it('同一分栏只代点一次：用户收起后再挂载的开关不再代点', async () => {
    const pane = dockPane('pane1')
    const first = toggleIn(pane, 'false')
    const firstClick = vi.fn()
    first.addEventListener('click', firstClick)
    dispose = installNavigatorAutoOpen()
    await settle()
    expect(firstClick).toHaveBeenCalledOnce()

    // 用户收起（aria-expanded 回到 false），又切出一个新的预览页签（开关重新挂载）。
    first.setAttribute('aria-expanded', 'false')
    const second = toggleIn(pane, 'false')
    const click = vi.fn()
    second.addEventListener('click', click)
    await settle()
    expect(click).not.toHaveBeenCalled()
  })

  it('用户手动点击开关后，该分栏视为已有决定', async () => {
    const pane = dockPane('pane1')
    // 用户先点了一个已展开的开关（收起），不算默认展开的代点，但算决定。
    const manual = toggleIn(pane, 'true')
    dispose = installNavigatorAutoOpen()
    await settle()
    manual.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    manual.setAttribute('aria-expanded', 'false')
    const later = toggleIn(pane, 'false')
    const click = vi.fn()
    later.addEventListener('click', click)
    await settle()
    expect(click).not.toHaveBeenCalled()
  })

  it('浮动面板里的开关同样代点一次', async () => {
    const float = document.createElement('div')
    float.dataset.dockkitFloat = 'float1'
    document.body.append(float)
    const button = toggleIn(float, 'false')
    const click = vi.fn()
    button.addEventListener('click', click)
    dispose = installNavigatorAutoOpen()
    await settle()
    expect(click).toHaveBeenCalledOnce()
  })

  it('卸载后新增的开关不再代点', async () => {
    const pane = dockPane('pane1')
    dispose = installNavigatorAutoOpen()
    dispose()
    dispose = undefined
    const button = toggleIn(pane, 'false')
    const click = vi.fn()
    button.addEventListener('click', click)
    await settle()
    expect(click).not.toHaveBeenCalled()
  })
})
