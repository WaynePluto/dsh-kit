// @vitest-environment jsdom
/** 活动面板行 toggle 的判定测试：活动行拦截回会话、菜单碰撞排除、守卫与卸载。 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { ACTIVE_PANEL_ROW_SELECTOR, installPanelToggle, PANEL_LIST_SELECTOR } from '../src/client/toggle.js'

/** 造上游 PanelRow 形态的面板行按钮（类名按构建产物 `<hash>_<原名>` 模拟）。 */
function panelRow(label: string, active: boolean): HTMLElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = `hX1_panelRow${active ? ' hX1_panelActive' : ''}`
  button.setAttribute('aria-label', label)
  if (active) button.setAttribute('aria-current', 'page')
  const glyph = document.createElement('span')
  button.appendChild(glyph)
  return button
}

/** 造上游 SidebarRoot 的面板列表容器（侧栏唯一的 nav）。 */
function panelList(rows: HTMLElement[]): { nav: HTMLElement } {
  const nav = document.createElement('nav')
  nav.className = 'hX1_panelList'
  nav.setAttribute('aria-label', '面板')
  for (const row of rows) nav.appendChild(row)
  document.body.appendChild(nav)
  return { nav }
}

/** 气泡菜单里的选中项（上游 Menu 也输出 aria-current="page"，但 portal 在 body）。 */
function menuItemSelected(): HTMLElement {
  const menu = document.createElement('div')
  const item = document.createElement('button')
  item.type = 'button'
  item.setAttribute('aria-current', 'page')
  menu.appendChild(item)
  document.body.appendChild(menu)
  return item
}

function harness(hasActivePanel = true) {
  const returnToConversation = vi.fn()
  const dispose = installPanelToggle({
    document,
    hasActivePanel: () => hasActivePanel,
    returnToConversation,
  })
  return { dispose, returnToConversation }
}

/** 点击元素并记录事件是否被拦截（冒泡到 document 即未拦截）。 */
function click(target: Element): { stopped: boolean; prevented: boolean } {
  let stopped = true
  const bubbleSpy = (): void => { stopped = false }
  document.addEventListener('click', bubbleSpy)
  const event = new MouseEvent('click', { bubbles: true, cancelable: true })
  target.dispatchEvent(event)
  document.removeEventListener('click', bubbleSpy)
  return { stopped, prevented: event.defaultPrevented }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('选择器契约', () => {
  it('活动行必须同时带 aria-current 与 panelRow 类名后缀', () => {
    expect(ACTIVE_PANEL_ROW_SELECTOR).toContain('aria-current="page"')
    expect(ACTIVE_PANEL_ROW_SELECTOR).toContain('[class*="panelRow"]')
    expect(PANEL_LIST_SELECTOR).toContain('nav[class*="panelList"]')
  })
})

describe('installPanelToggle', () => {
  it('点击活动面板行：拦截原生处理并回到会话', () => {
    const active = panelRow('服务', true)
    panelList([panelRow('插件', false), active])
    const { dispose, returnToConversation } = harness()

    const result = click(active)
    expect(returnToConversation).toHaveBeenCalledTimes(1)
    expect(result.stopped).toBe(true)
    expect(result.prevented).toBe(true)
    dispose()
  })

  it('点击行内字形（span）同样命中所在按钮', () => {
    const active = panelRow('服务', true)
    panelList([active])
    const { dispose, returnToConversation } = harness()

    click(active.querySelector('span')!)
    expect(returnToConversation).toHaveBeenCalledTimes(1)
    dispose()
  })

  it('非活动行与无 aria-current 的点击不拦截', () => {
    const idle = panelRow('插件', false)
    panelList([idle])
    const { dispose, returnToConversation } = harness()

    click(idle)
    expect(returnToConversation).not.toHaveBeenCalled()
    dispose()
  })

  it('nav 之外的 aria-current="page"（气泡菜单选中项）不拦截', () => {
    const item = menuItemSelected()
    const { dispose, returnToConversation } = harness()

    click(item)
    expect(returnToConversation).not.toHaveBeenCalled()
    dispose()
  })

  it('nav 内但无 panelRow 类名的 aria-current 按钮不拦截（碰撞防御）', () => {
    const nav = document.createElement('nav')
    nav.className = 'hX1_panelList'
    const stranger = document.createElement('button')
    stranger.setAttribute('aria-current', 'page')
    nav.appendChild(stranger)
    document.body.appendChild(nav)
    const { dispose, returnToConversation } = harness()

    click(stranger)
    expect(returnToConversation).not.toHaveBeenCalled()
    dispose()
  })

  it('无选中面板（activePanelId 为 null）时不拦截', () => {
    const active = panelRow('服务', true)
    panelList([active])
    const { dispose, returnToConversation } = harness(false)

    click(active)
    expect(returnToConversation).not.toHaveBeenCalled()
    dispose()
  })

  it('卸载后监听移除，点击不再拦截', () => {
    const active = panelRow('服务', true)
    panelList([active])
    const { dispose, returnToConversation } = harness()
    dispose()

    click(active)
    expect(returnToConversation).not.toHaveBeenCalled()
  })
})
