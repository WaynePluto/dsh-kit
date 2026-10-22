// @vitest-environment jsdom
/** 工作区头部一键收起的 DOM 编排测试：折叠选择与逆序、注入位置、跟随显隐与卸载。 */

import { afterEach, describe, expect, it } from 'vitest'
import {
  BUTTON_ATTR, COLLAPSE_STYLE, CONTAINER_CLASS, collapseExpandedRows,
  installWorkspaceCollapse, sectionHeaderOf,
} from '../src/client/collapse.js'
import type { CollapseButtonOptions } from '../src/client/collapse.js'

/** 等 MutationObserver 的微任务回调跑完。 */
async function flush(): Promise<void> {
  await new Promise<void>(resolve => { setTimeout(resolve, 0) })
}

/** 造一个工作区分组行；点击行为记录到传入的日志。 */
function groupRow(key: string, expanded: boolean, clicks: string[]): HTMLElement {
  const row = document.createElement('div')
  row.setAttribute('data-row-key', `workspace:${key}`)
  row.setAttribute('aria-expanded', String(expanded))
  row.addEventListener('click', () => { clicks.push(key) })
  return row
}

/** 造一个会话行（不应被收起动作命中）。 */
function sessionRow(id: string, clicks: string[]): HTMLElement {
  const row = document.createElement('div')
  row.setAttribute('data-row-key', `session:${id}`)
  row.addEventListener('click', () => { clicks.push(id) })
  return row
}

/** 造原生浏览器形态：sectionHeader（label + searchSlot + headerActions）+ listArea。 */
function nativeBrowser(): {
  root: HTMLElement
  header: HTMLElement
  searchSlot: HTMLElement
  actions: HTMLElement
  listArea: HTMLElement
} {
  const root = document.createElement('div')
  const header = document.createElement('div')
  header.className = 'hX1_sectionHeader'
  const label = document.createElement('span')
  label.className = 'hX1_sectionLabel'
  const searchSlot = document.createElement('div')
  searchSlot.className = 'hX1_searchSlot'
  const actions = document.createElement('div')
  actions.className = 'hX1_headerActions'
  header.append(label, searchSlot, actions)
  const listArea = document.createElement('div')
  listArea.className = 'hX1_listArea'
  root.append(header, listArea)
  document.body.appendChild(root)
  return { root, header, searchSlot, actions, listArea }
}

/** 记录挂载/卸载的假依赖。 */
function harness(label = '收起全部工作区') {
  const mounted: { container: HTMLElement; options: CollapseButtonOptions }[] = []
  const unmounted: number[] = []
  const deps = {
    document,
    mount: (container: HTMLElement, options: CollapseButtonOptions) => {
      mounted.push({ container, options })
      return () => { unmounted.push(mounted.length) }
    },
    label,
  }
  return { deps, mounted, unmounted }
}

afterEach(() => {
  document.body.innerHTML = ''
  document.head.innerHTML = ''
})

describe('collapseExpandedRows', () => {
  it('只点击展开中的工作区分组行，且按文档逆序（先子后父）', () => {
    const clicks: string[] = []
    const list = document.createElement('div')
    // 父分组在前、子分组在后，模拟原生 renderGroup 的文档顺序。
    list.append(
      groupRow('ws-parent', true, clicks),
      groupRow('ws-child', true, clicks),
      groupRow('ws-folded', false, clicks),
      sessionRow('s1', clicks),
      groupRow('', true, clicks),
    )
    const overflow = document.createElement('button')
    overflow.setAttribute('data-row-key', 'overflow:ws-parent')
    overflow.setAttribute('aria-expanded', 'true')
    overflow.addEventListener('click', () => { clicks.push('overflow') })
    list.appendChild(overflow)
    document.body.appendChild(list)

    expect(collapseExpandedRows(document)).toBe(3)
    // 收起范围：ws-parent、ws-child 与未分组桶（key 为空串）；折叠的 ws-folded、
    // 会话行与溢出行不命中。逆序派发使空 key（文档最末）最先被点击。
    expect(clicks).toEqual(['', 'ws-child', 'ws-parent'])
  })

  it('全部已收起时返回 0 且不派发点击', () => {
    const clicks: string[] = []
    const list = document.createElement('div')
    list.appendChild(groupRow('ws-a', false, clicks))
    document.body.appendChild(list)
    expect(collapseExpandedRows(document)).toBe(0)
    expect(clicks).toEqual([])
  })
})

describe('sectionHeaderOf', () => {
  it('从行向上找到浏览器根的 sectionHeader', () => {
    const { header, listArea } = nativeBrowser()
    const row = groupRow('ws-a', true, [])
    listArea.appendChild(row)
    expect(sectionHeaderOf(row)).toBe(header)
  })

  it('没有 sectionHeader 时返回 null', () => {
    const row = groupRow('ws-a', true, [])
    document.body.appendChild(row)
    expect(sectionHeaderOf(row)).toBeNull()
  })
})

describe('installWorkspaceCollapse', () => {
  it('把按钮容器插在 searchSlot 之前并挂载按钮', async () => {
    const { header, searchSlot, listArea } = nativeBrowser()
    listArea.appendChild(groupRow('ws-a', true, []))
    const { deps, mounted } = harness()
    const dispose = installWorkspaceCollapse(deps)
    await flush()

    expect(mounted).toHaveLength(1)
    const container = mounted[0]!.container
    expect(container.getAttribute(BUTTON_ATTR)).toBe('')
    expect(container.className).toBe(CONTAINER_CLASS)
    expect(searchSlot.previousElementSibling).toBe(container)
    expect(header.contains(container)).toBe(true)
    expect(mounted[0]!.options.label).toBe('收起全部工作区')
    dispose()
  })

  it('点击按钮折叠全部分组', async () => {
    const clicks: string[] = []
    const { listArea } = nativeBrowser()
    listArea.append(groupRow('ws-a', true, clicks), groupRow('ws-b', true, clicks))
    const { deps, mounted } = harness()
    const dispose = installWorkspaceCollapse(deps)
    await flush()

    mounted[0]!.options.onCollapse()
    expect(clicks.sort()).toEqual(['ws-a', 'ws-b'])
    dispose()
  })

  it('没有工作区行（flat/搜索/空态）时不注入；行消失时按钮退场', async () => {
    const { header } = nativeBrowser()
    const { deps, mounted } = harness()
    const dispose = installWorkspaceCollapse(deps)
    await flush()
    expect(mounted).toHaveLength(0)
    expect(header.querySelector(`[${BUTTON_ATTR}]`)).toBeNull()

    const row = groupRow('ws-a', true, [])
    header.parentElement!.querySelector('.hX1_listArea')!.appendChild(row)
    await flush()
    expect(mounted).toHaveLength(1)
    const container = mounted[0]!.container

    row.remove()
    await flush()
    expect(container.isConnected).toBe(false)
    expect(mounted).toHaveLength(1)
    dispose()
  })

  it('后续 mutation 不会重复注入第二个按钮', async () => {
    const { listArea } = nativeBrowser()
    listArea.appendChild(groupRow('ws-a', true, []))
    const { deps, mounted } = harness()
    const dispose = installWorkspaceCollapse(deps)
    await flush()

    listArea.appendChild(groupRow('ws-b', true, []))
    await flush()
    expect(mounted).toHaveLength(1)
    dispose()
  })

  it('注入样式与契约：样式元素带标记、包含退场 :has 规则与原生 token', async () => {
    const { listArea } = nativeBrowser()
    listArea.appendChild(groupRow('ws-a', true, []))
    const { deps } = harness()
    const dispose = installWorkspaceCollapse(deps)

    const style = document.head.querySelector('style')
    expect(style?.getAttribute(BUTTON_ATTR)).toBe('')
    expect(style?.textContent).toBe(COLLAPSE_STYLE)
    expect(COLLAPSE_STYLE).toContain(':has(~ [class*="headerActionsHidden"])')
    expect(COLLAPSE_STYLE).toContain('--dsw-alias-label-secondary')
    expect(COLLAPSE_STYLE).toContain('--ds-ease-in-out')
    // 水平定位契约：容器接住剩余空间，并归零 searchSlot 的 auto margin，
    // 使按钮紧贴搜索图标左侧而不是被顶到标题旁。
    expect(COLLAPSE_STYLE).toContain('margin-left: auto')
    expect(COLLAPSE_STYLE).toContain('~ [class*="searchSlot"]')
    expect(COLLAPSE_STYLE).toContain('> svg + svg')
    dispose()
  })

  it('卸载：移除容器与样式，观察器断开', async () => {
    const { header, listArea } = nativeBrowser()
    const row = groupRow('ws-a', true, [])
    listArea.appendChild(row)
    const { deps, mounted, unmounted } = harness()
    const dispose = installWorkspaceCollapse(deps)
    await flush()
    expect(mounted).toHaveLength(1)
    const container = mounted[0]!.container

    dispose()
    expect(container.isConnected).toBe(false)
    expect(unmounted).toHaveLength(1)
    expect(document.head.querySelector('style')).toBeNull()

    row.remove()
    await flush()
    expect(header.querySelectorAll(`[${BUTTON_ATTR}]`)).toHaveLength(0)
  })
})
