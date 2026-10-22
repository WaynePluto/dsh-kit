// @vitest-environment jsdom
/** 工作区头部一键收起/展开的 DOM 编排测试：折叠与展开选择、注入位置、模式跟随与卸载。 */

import { afterEach, describe, expect, it } from 'vitest'
import {
  BUTTON_ATTR, COLLAPSED_ROW_SELECTOR, COLLAPSE_STYLE, CONTAINER_CLASS,
  collapseExpandedRows, expandCollapsedRows, installWorkspaceCollapse, sectionHeaderOf,
} from '../src/client/collapse.js'
import type {
  CollapseButtonOptions, CollapseDeps,
} from '../src/client/collapse.js'

/** 等 MutationObserver 的微任务回调跑完。 */
async function flush(): Promise<void> {
  await new Promise<void>(resolve => { setTimeout(resolve, 0) })
}

/** 等多轮宏任务：覆盖展开动作的若干轮「点击 → 落 DOM → 再探」周期。 */
async function settle(rounds = 8): Promise<void> {
  for (let index = 0; index < rounds; index += 1) await flush()
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

/** 记录挂载/更新/卸载的假依赖。 */
function harness(labels = { collapse: '收起全部工作区', expand: '展开全部工作区' }) {
  const mounted: { container: HTMLElement; options: CollapseButtonOptions }[] = []
  const updates: CollapseButtonOptions[] = []
  const unmounted: number[] = []
  const deps: CollapseDeps = {
    document,
    mount: (container: HTMLElement, options: CollapseButtonOptions) => {
      mounted.push({ container, options })
      return {
        update: (next: CollapseButtonOptions) => {
          updates.push(next)
          mounted[mounted.length - 1]!.options = next
        },
        unmount: () => { unmounted.push(mounted.length) },
      }
    },
    labels,
  }
  return { deps, mounted, updates, unmounted }
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

describe('expandCollapsedRows', () => {
  it('点击全部收起中的分组行，父行展开后多轮补点新挂载的子行', async () => {
    const clicks: string[] = []
    const list = document.createElement('div')
    const parent = groupRow('ws-parent', false, clicks)
    // 点击父行翻转展开态并挂载一个保持收起的子分组（原生 renderGroup 行为）。
    parent.addEventListener('click', () => {
      parent.setAttribute('aria-expanded', 'true')
      const child = groupRow('ws-child', false, clicks)
      child.addEventListener('click', () => {
        child.setAttribute('aria-expanded', 'true')
      })
      list.appendChild(child)
    })
    list.append(parent, groupRow('ws-open', true, clicks), sessionRow('s1', clicks))
    document.body.appendChild(list)

    expect(await expandCollapsedRows(document)).toBe(2)
    // 第一轮父行（展开行不命中、会话行不命中），等一拍后第二轮补点新挂载的子行。
    expect(clicks).toEqual(['ws-parent', 'ws-child'])
    expect(list.querySelector(COLLAPSED_ROW_SELECTOR)).toBeNull()
  })

  it('原生开关不翻转时每行只点一次，有限轮后终止', async () => {
    const clicks: string[] = []
    const list = document.createElement('div')
    list.appendChild(groupRow('ws-stuck', false, clicks))
    document.body.appendChild(list)

    expect(await expandCollapsedRows(document)).toBe(1)
    expect(clicks).toEqual(['ws-stuck'])
  })

  it('没有收起中的行时返回 0', async () => {
    const clicks: string[] = []
    const list = document.createElement('div')
    list.appendChild(groupRow('ws-a', true, clicks))
    document.body.appendChild(list)
    expect(await expandCollapsedRows(document)).toBe(0)
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

  it('存在展开中的行时挂载为收起态，全部收起后更新为展开态', async () => {
    const { listArea } = nativeBrowser()
    const row = groupRow('ws-a', true, [])
    listArea.append(row, groupRow('ws-b', false, []))
    const { deps, mounted, updates } = harness()
    const dispose = installWorkspaceCollapse(deps)
    await flush()

    expect(mounted).toHaveLength(1)
    expect(mounted[0]!.options.mode).toBe('collapse')
    expect(mounted[0]!.options.label).toBe('收起全部工作区')

    row.setAttribute('aria-expanded', 'false')
    await flush()
    expect(updates).toHaveLength(1)
    expect(mounted[0]!.options.mode).toBe('expand')
    expect(mounted[0]!.options.label).toBe('展开全部工作区')
    dispose()
  })

  it('点击按钮按当前模式动作：收起态折叠并翻到展开态，再点击多轮展开翻回收起态', async () => {
    const clicks: string[] = []
    const { listArea } = nativeBrowser()
    // 点击后翻转展开态的行，模拟原生 onToggle。
    const flippingRow = (key: string, expanded: boolean): HTMLElement => {
      const row = groupRow(key, expanded, clicks)
      row.addEventListener('click', () => {
        row.setAttribute('aria-expanded', String(row.getAttribute('aria-expanded') !== 'true'))
      })
      return row
    }
    listArea.append(flippingRow('ws-a', true), flippingRow('ws-b', true))
    const { deps, mounted } = harness()
    const dispose = installWorkspaceCollapse(deps)
    await flush()
    expect(mounted[0]!.options.mode).toBe('collapse')

    mounted[0]!.options.onActivate()
    // 逆序收起，行点击翻转展开态后按钮切到展开方向。
    expect(clicks).toEqual(['ws-b', 'ws-a'])
    await flush()
    expect(mounted[0]!.options.mode).toBe('expand')
    expect(mounted[0]!.options.label).toBe('展开全部工作区')

    // 收起的父行点击后挂载保持收起的子行（原生 renderGroup 行为）。
    const parent = flippingRow('ws-parent', false)
    parent.addEventListener('click', () => {
      if (parent.getAttribute('aria-expanded') === 'true') {
        listArea.appendChild(flippingRow('ws-child', false))
      }
    })
    listArea.appendChild(parent)
    await flush()

    mounted[0]!.options.onActivate()
    await settle()
    // 多轮补点：第一轮按文档顺序点开全部收起行（含上一阶段收掉的 ws-a/ws-b 与
    // 父行），父行展开挂载子行后第二轮补点；全展开后按钮翻回收起方向。
    expect(clicks).toEqual(['ws-b', 'ws-a', 'ws-a', 'ws-b', 'ws-parent', 'ws-child'])
    expect(mounted[0]!.options.mode).toBe('collapse')
    expect(mounted[0]!.options.label).toBe('收起全部工作区')
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
