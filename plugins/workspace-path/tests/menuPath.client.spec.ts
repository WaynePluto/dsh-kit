// @vitest-environment jsdom
/** 原生工作区菜单「复制路径」注入的 DOM 编排测试：归因、注入位置、点击行为与卸载。 */

import { afterEach, describe, expect, it } from 'vitest'
import {
  ATTRIBUTION_MS, installWorkspaceMenuCopy, workspaceRowKeyOf,
} from '../src/client/menuPath.js'
import type { MenuButtonOptions } from '../src/client/menuPath.js'/** 等 MutationObserver 的微任务回调跑完。 */
async function flush(): Promise<void> {
  await new Promise<void>(resolve => { setTimeout(resolve, 0) })
}

/** 造一个带 `···` 触发按钮的工作区行。 */
function workspaceRow(key: string): HTMLElement {
  const row = document.createElement('div')
  row.setAttribute('data-row-key', `workspace:${key}`)
  row.innerHTML = '<span class="title">proj</span><button type="button" aria-label="more">···</button>'
  document.body.appendChild(row)
  return row
}

/** 造一个 Menu portal 形态的原生菜单面：surface > viewport > 两行 menuitem。 */
function nativeMenu(): { menu: HTMLElement; viewport: HTMLElement; rows: HTMLButtonElement[] } {
  const menu = document.createElement('div')
  menu.setAttribute('role', 'menu')
  const viewport = document.createElement('div')
  viewport.setAttribute('role', 'presentation')
  const rename = document.createElement('button')
  rename.setAttribute('role', 'menuitem')
  rename.textContent = 'rename'
  const del = document.createElement('button')
  del.setAttribute('role', 'menuitem')
  del.textContent = 'delete'
  viewport.append(rename, del)
  menu.appendChild(viewport)
  document.body.appendChild(menu)
  return { menu, viewport, rows: [rename, del] }
}

/** 记录挂载/复制/关闭的假依赖。 */
function harness(over: Partial<Parameters<typeof installWorkspaceMenuCopy>[0]> = {}) {
  const mounted: { options: MenuButtonOptions; container: HTMLElement }[] = []
  const unmounted: number[] = []
  const copies: string[] = []
  const closes: number[] = []
  let clock = 1000
  const deps = {
    document,
    resolvePath: (key: string) => (key === 'ws-1' ? 'D:\\work\\proj-a' : undefined),
    mount: (container: HTMLElement, options: MenuButtonOptions) => {
      mounted.push({ options, container })
      return () => { unmounted.push(mounted.length) }
    },
    copyLabel: '复制路径',
    copy: (path: string) => { copies.push(path) },
    closeMenu: () => { closes.push(closes.length + 1) },
    now: () => clock,
    ...over,
  }
  return {
    deps,
    mounted,
    unmounted,
    copies,
    closes,
    advance: (ms: number) => { clock += ms },
  }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('workspaceRowKeyOf', () => {
  it('reads the key off a workspace row and ignores every other row kind', () => {
    const row = workspaceRow('ws-1')
    expect(workspaceRowKeyOf(row.querySelector('button'))).toBe('ws-1')
    const session = document.createElement('div')
    session.setAttribute('data-row-key', 'session:s1')
    expect(workspaceRowKeyOf(session)).toBeUndefined()
    const plain = document.createElement('div')
    expect(workspaceRowKeyOf(plain)).toBeUndefined()
    expect(workspaceRowKeyOf(null)).toBeUndefined()
  })
})

describe('installWorkspaceMenuCopy', () => {
  it('adopts the menu that follows a workspace-row click, before the danger row', async () => {
    const h = harness()
    const dispose = installWorkspaceMenuCopy(h.deps)
    try {
      workspaceRow('ws-1').querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      const { menu, viewport, rows } = nativeMenu()
      await flush()
      expect(h.mounted).toHaveLength(1)
      expect(h.mounted[0]?.options.path).toBe('D:\\work\\proj-a')
      expect(h.mounted[0]?.options.label).toBe('复制路径')
      // 挂载点在 viewport 内、插在最后一行（删除）之前。
      const container = h.mounted[0]?.container as HTMLElement
      expect(container.parentElement).toBe(viewport)
      expect(container.previousElementSibling).toBe(rows[0])
      expect(container.nextElementSibling).toBe(rows[1])
      // 悬停可见完整路径；菜单面有注入标记。
      expect(container.title).toBe('D:\\work\\proj-a')
      expect(menu.hasAttribute('data-dsh-workspace-path')).toBe(true)
    } finally {
      dispose()
    }
  })

  it('copies the path and closes the menu when the injected row acts', async () => {
    const h = harness()
    const dispose = installWorkspaceMenuCopy(h.deps)
    try {
      workspaceRow('ws-1').querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      nativeMenu()
      await flush()
      h.mounted[0]?.options.onCopy()
      expect(h.copies).toEqual(['D:\\work\\proj-a'])
      expect(h.closes).toHaveLength(1)
    } finally {
      dispose()
    }
  })

  it('ignores a menu that no workspace-row click attributed', async () => {
    const h = harness()
    const dispose = installWorkspaceMenuCopy(h.deps)
    try {
      nativeMenu()
      await flush()
      expect(h.mounted).toHaveLength(0)
    } finally {
      dispose()
    }
  })

  it('ignores a menu that arrives after the attribution window', async () => {
    const h = harness()
    const dispose = installWorkspaceMenuCopy(h.deps)
    try {
      workspaceRow('ws-1').querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      h.advance(ATTRIBUTION_MS + 1)
      nativeMenu()
      await flush()
      expect(h.mounted).toHaveLength(0)
    } finally {
      dispose()
    }
  })

  it('does not inject for the ungrouped bucket, whose key resolves to no workspace', async () => {
    const h = harness()
    const dispose = installWorkspaceMenuCopy(h.deps)
    try {
      workspaceRow('ungrouped').querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      nativeMenu()
      await flush()
      expect(h.mounted).toHaveLength(0)
    } finally {
      dispose()
    }
  })

  it('never adopts two menus for one click, but serves a later click again', async () => {
    const h = harness()
    const dispose = installWorkspaceMenuCopy(h.deps)
    try {
      workspaceRow('ws-1').querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      nativeMenu()
      await flush()
      expect(h.mounted).toHaveLength(1)
      // 同一窗口内出现的第二个菜单不被认领：归因是一次性的。
      nativeMenu()
      await flush()
      expect(h.mounted).toHaveLength(1)
      // 下一次点击 + 新菜单恢复注入。
      workspaceRow('ws-1').querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      nativeMenu()
      await flush()
      expect(h.mounted).toHaveLength(2)
    } finally {
      dispose()
    }
  })

  it('re-enters the host menu on pointer enter and again after the crossing pointerover settles', async () => {
    const h = harness()
    const dispose = installWorkspaceMenuCopy(h.deps)
    try {
      workspaceRow('ws-1').querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      const { viewport } = nativeMenu()
      await flush()
      const container = h.mounted[0]?.container as HTMLElement
      // 宿主 Menu 的取消路径是 wrapper 的 onPointerEnter（由 viewport 上的 pointerover 推导）；
      // 注入行在独立 React 根里，React 会把进入注入行的 pointerover 也当作「离开 wrapper」
      // 再 arm 一次，因此补偿要覆盖两拍：pointerenter 的立即补 + pointerover 后的延迟补。
      // 只计 target 为 viewport 的事件（合成补偿）；container 冒泡来的原生事件不计。
      const events: Event[] = []
      const record = (event: Event): void => {
        if (event.target === viewport) events.push(event)
      }
      viewport.addEventListener('pointerover', record)
      viewport.addEventListener('pointerout', record)
      container.dispatchEvent(new MouseEvent('pointerenter'))
      expect(events).toHaveLength(1)
      container.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))
      // 推迟补偿在本轮事件处理完（含 React 的同步 arm）之后运行。
      expect(events).toHaveLength(1)
      await new Promise<void>(resolve => { setTimeout(resolve, 10) })
      expect(events).toHaveLength(2)
      // 移回原生行（relatedTarget 仍在 viewport 内）不补 leave，交给宿主自己的 enter 处理。
      const over = new MouseEvent('pointerout', { bubbles: true, relatedTarget: viewport.querySelector('button') as Node })
      container.dispatchEvent(over)
      expect(events).toHaveLength(2)
      // 直接移出菜单（relatedTarget 在 viewport 外）补一次 leave，让宿主正常延迟关闭。
      const out = new MouseEvent('pointerout', { bubbles: true })
      container.dispatchEvent(out)
      const leaves = events.filter(event => event.type === 'pointerout')
      expect(leaves).toHaveLength(1)
      expect((leaves[0] as MouseEvent).target).toBe(viewport)
    } finally {
      dispose()
    }
  })

  it('stops re-entering after the injected row is torn down', async () => {
    const h = harness()
    const dispose = installWorkspaceMenuCopy(h.deps)
    try {
      workspaceRow('ws-1').querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      const { menu, viewport } = nativeMenu()
      await flush()
      const container = h.mounted[0]?.container as HTMLElement
      const events: Event[] = []
      viewport.addEventListener('pointerover', (event) => {
        if (event.target === viewport) events.push(event)
      })
      menu.remove()
      await flush()
      expect(h.unmounted).toHaveLength(1)
      container.dispatchEvent(new MouseEvent('pointerenter'))
      container.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))
      await new Promise<void>(resolve => { setTimeout(resolve, 10) })
      expect(events).toHaveLength(0)
    } finally {
      dispose()
    }
  })

  it('unmounts the injected row when the menu leaves the document', async () => {
    const h = harness()
    const dispose = installWorkspaceMenuCopy(h.deps)
    try {
      workspaceRow('ws-1').querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      const { menu } = nativeMenu()
      await flush()
      expect(h.unmounted).toHaveLength(0)
      menu.remove()
      await flush()
      expect(h.unmounted).toHaveLength(1)
    } finally {
      dispose()
    }
  })

  it('stops listening after dispose', async () => {
    const h = harness()
    const dispose = installWorkspaceMenuCopy(h.deps)
    workspaceRow('ws-1').querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    nativeMenu()
    await flush()
    expect(h.mounted).toHaveLength(1)
    dispose()
    expect(h.unmounted).toHaveLength(1)
    workspaceRow('ws-1').querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    nativeMenu()
    await flush()
    expect(h.mounted).toHaveLength(1)
  })

  it('treats a menu without any native row as not a row menu', async () => {
    const h = harness()
    const dispose = installWorkspaceMenuCopy(h.deps)
    try {
      workspaceRow('ws-1').querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      const menu = document.createElement('div')
      menu.setAttribute('role', 'menu')
      document.body.appendChild(menu)
      await flush()
      expect(h.mounted).toHaveLength(0)
      // 没有原生行时不消费归因：随后同一窗口内到达的真正行菜单仍可注入。
      nativeMenu()
      await flush()
      expect(h.mounted).toHaveLength(1)
    } finally {
      dispose()
    }
  })
})
