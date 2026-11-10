// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { InputHTMLAttributes } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// jsdom 没有 scrollIntoView（打开定位只在真实浏览器有布局意义）；缺失会让
// layout effect 抛错并卸载整棵组件树。
Element.prototype.scrollIntoView = () => {}

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const { forwardRef } = await import('react')
  return {
    IconCheckOutlineRegular: () => null,
    IconChevronDownOutlineRegular: () => null,
    IconChevronRightOutlineRegular: () => null,
    IconCloseFillRegular: () => null,
    IconDataOutlineRegular: () => null,
    IconWarningOutlineRegular: () => null,
    Input: forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>((props, ref) => <input {...props} ref={ref} />),
    StateDot: () => null,
    isMobileDevice: () => false,
    rankByName: (items: ReadonlyArray<{ name: string }>, rawQuery: string) => {
      const query = rawQuery.trim().toLowerCase()
      if (query === '') return items
      return items.filter(item => item.name.toLowerCase().includes(query))
    },
    Toast: () => null,
    // forwardRef：blur 守卫靠 menuRef.contains(relatedTarget) 判定「焦点移进菜单」。
    MenuSurface: forwardRef<HTMLDivElement, { children?: unknown }>(({ children }, ref) => (
      <div ref={ref}>{children}</div>
    )),
    MenuGroup: ({ children }: { children?: unknown }) => children ?? null,
    observeStickyMenuGroups: () => () => {},
  }
})

import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import { FavoriteModelSelect } from '../src/client/FavoriteModelSelect.js'
import { SELECTOR_STYLE_MARKER, selectorClasses, selectorStyles } from '../src/client/selector-styles.js'
import { en } from '../src/client/locales.js'

const t = (key: keyof typeof en): string => en[key]

/** dsh 0.1.7 起收藏快照来自 configForms 绑定的 ConfigForm；mutate/set/unset 都以 boolean 回答。 */
function favoritesForm(favorites: Array<{ provider: string; model: string }>) {
  const snapshot = {
    status: 'ready' as const,
    value: { favorites },
    base: undefined,
    user: undefined,
    revision: 1,
    writable: true,
    mode: 'host' as const,
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    mutate: vi.fn(async () => true),
    set: vi.fn(async () => true),
    unset: vi.fn(async () => true),
  }
}

function modelState(overrides: Partial<ModelDirectoryState> = {}): ModelDirectoryState {
  return {
    current: { provider: 'provider-a', model: 'a-only' },
    routable: true,
    pending: null,
    groups: [
      {
        id: 'provider-a',
        name: 'Provider A',
        models: [{
          id: 'a-only',
          name: 'A only',
          reasoning: {
            efforts: [{ id: 'low', name: 'Low' }, { id: 'max', name: 'Max' }],
            defaultEffort: 'low',
          },
        }],
      },
      {
        id: 'provider-b',
        name: 'Provider B',
        models: [{ id: 'b-only', name: 'B only' }],
      },
    ],
    failures: [],
    status: 'ready',
    error: null,
    ...overrides,
  }
}

afterEach(cleanup)

describe('FavoriteModelSelect', () => {
  it('uses a namespaced stylesheet with the native menu tokens instead of selector inline styles', () => {
    render(<FavoriteModelSelect
      locked={false}
      available
      directory={createSnapshotStore<ModelDirectoryState>(modelState())}
      load={vi.fn()}
      select={vi.fn().mockResolvedValue(true)}
      favorites={favoritesForm([])}
      t={t}
    />)

    const trigger = screen.getByRole('button', { name: /Select model, current A only/ })
    const root = trigger.parentElement
    const style = document.querySelector(`style[${SELECTOR_STYLE_MARKER}]`)
    expect(root?.classList.contains(selectorClasses.root)).toBe(true)
    expect(trigger.classList.contains(selectorClasses.trigger)).toBe(true)
    expect(trigger.getAttribute('style')).toBeNull()
    // 0.2.0 菜单面由 MenuSurface 提供（半透明填充 + backdrop-filter）；自绘 specific-menu
    // 背景会退化为无模糊纯透明，样式表不得再画菜单面。
    expect(style?.textContent).not.toContain('--dsw-specific-menu')
    expect(style?.textContent).toContain('--dsw-elevation-prominent')
    // 与原生 ModelSelect（0.2.2-rc.1）同节奏：radius token、business-primary 焦点圈、
    // composer 紧凑模式变量（注意变量前缀是 --dsh-，属 composer 命名空间，非 alias token）。
    expect(style?.textContent).toContain('--dsh-composer-model-text-display')
    expect(style?.textContent).toContain('--dsh-composer-model-icon-display')
    expect(style?.textContent).toContain('var(--dsw-radius-sm)')
    expect(style?.textContent).toContain('var(--dsw-radius-md)')
    expect(style?.textContent).toContain(':not([data-selection-focus])')
    expect(style?.textContent).toContain('max-width: 360px')
    expect(style?.textContent).toBe(selectorStyles)
  })

  it('filters the menu but keeps an un-favorited current model visible in the trigger', () => {
    const directory = createSnapshotStore<ModelDirectoryState>(modelState())
    render(<FavoriteModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={vi.fn().mockResolvedValue(true)}
      favorites={favoritesForm([{ provider: 'provider-b', model: 'b-only' }])}
      t={t}
    />)

    expect(screen.getByRole('button', { name: /Select model, current A only/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Select model, current A only/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Model/ }))
    expect(screen.queryByRole('menuitemradio', { name: 'A only' })).toBeNull()
    expect(screen.getByRole('menuitemradio', { name: 'B only' })).toBeTruthy()
  })

  it('keeps native reasoning levels and submits the complete selection', async () => {
    const directory = createSnapshotStore<ModelDirectoryState>(modelState())
    const select = vi.fn(async (selection) => {
      directory.set(modelState({ current: selection }))
      return true
    })
    render(<FavoriteModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={select}
      favorites={favoritesForm([{ provider: 'provider-a', model: 'a-only' }])}
      t={t}
    />)

    const trigger = screen.getByRole('button', { name: /Select model, current A only/ })
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: /Effort/ }))
    expect(screen.getAllByRole('menuitemradio').map(item => item.textContent)).toEqual(['Low', 'Max'])
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Max' }))
    await waitFor(() => {
      expect(select).toHaveBeenCalledWith({ provider: 'provider-a', model: 'a-only', reasoningEffort: 'max' })
    })
  })

  it('submits the preferred level when switching to a model without a configured default', async () => {
    const directory = createSnapshotStore<ModelDirectoryState>(modelState({
      groups: [
        { id: 'provider-a', name: 'Provider A', models: [{ id: 'a-only', name: 'A only' }] },
        {
          id: 'provider-b',
          name: 'Provider B',
          models: [{
            id: 'b-reasoner',
            name: 'B reasoner',
            reasoning: {
              efforts: [
                { id: 'minimal', name: 'Minimal' },
                { id: 'low', name: 'Low' },
                { id: 'medium', name: 'Medium' },
                { id: 'xhigh', name: 'Xhigh' },
              ],
            },
          }],
        },
      ],
      current: { provider: 'provider-a', model: 'a-only' },
    }))
    const select = vi.fn(async (selection) => {
      directory.set(modelState({
        ...directory.getSnapshot(),
        current: selection,
      }))
      return true
    })
    render(<FavoriteModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={select}
      favorites={favoritesForm([
        { provider: 'provider-a', model: 'a-only' },
        { provider: 'provider-b', model: 'b-reasoner' },
      ])}
      t={t}
    />)

    fireEvent.click(screen.getByRole('button', { name: /Select model, current A only/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Model/ }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'B reasoner' }))
    // 没有 high 时取 high 以下最高档，而不是把会话留在「端点默认」。
    await waitFor(() => {
      expect(select).toHaveBeenCalledWith({ provider: 'provider-b', model: 'b-reasoner', reasoningEffort: 'medium' })
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /B reasoner, reasoning effort Medium/ })).toBeTruthy()
    })
  })

  it('keeps the model default level instead of the preference when one exists', async () => {
    const directory = createSnapshotStore<ModelDirectoryState>(modelState({
      groups: [
        { id: 'provider-a', name: 'Provider A', models: [{ id: 'a-only', name: 'A only' }] },
        {
          id: 'provider-b',
          name: 'Provider B',
          models: [{
            id: 'b-low',
            name: 'B low',
            reasoning: {
              efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }],
              defaultEffort: 'low',
            },
          }],
        },
      ],
      current: { provider: 'provider-a', model: 'a-only' },
    }))
    const select = vi.fn(async () => true)
    render(<FavoriteModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={select}
      favorites={favoritesForm([
        { provider: 'provider-a', model: 'a-only' },
        { provider: 'provider-b', model: 'b-low' },
      ])}
      t={t}
    />)

    fireEvent.click(screen.getByRole('button', { name: /Select model, current A only/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Model/ }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'B low' }))
    await waitFor(() => {
      expect(select).toHaveBeenCalledWith({ provider: 'provider-b', model: 'b-low', reasoningEffort: 'low' })
    })
  })

  it('shows the search box above four entries and accepts Enter on the ranked row', async () => {
    const models = ['one', 'two', 'three', 'four', 'five'].map((word, at) => ({
      id: `b-${at}`, name: `Bravo ${word}`,
    }))
    const directory = createSnapshotStore<ModelDirectoryState>(modelState({
      groups: [{ id: 'provider-b', name: 'Provider B', models }],
      current: { provider: 'provider-b', model: 'b-0' },
    }))
    const select = vi.fn(async () => true)
    render(<FavoriteModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={select}
      favorites={favoritesForm(models.map(model => ({ provider: 'provider-b', model: model.id })))}
      t={t}
    />)

    fireEvent.click(screen.getByRole('button', { name: /Select model, current/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Model/ }))
    // 5 个条目 > 4：搜索框出现，聚焦在搜索框（drill 首选）。
    const search = screen.getByRole('searchbox')
    expect(search).toBeTruthy()
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(5)
    fireEvent.change(search, { target: { value: 'three' } })
    const rows = screen.getAllByRole('menuitemradio')
    expect(rows).toHaveLength(1)
    expect(rows[0]?.textContent).toBe('Bravo three')
    fireEvent.keyDown(search, { key: 'Enter' })
    await waitFor(() => {
      expect(select).toHaveBeenCalledWith({ provider: 'provider-b', model: 'b-2' })
    })
  })

  it('does not render for an addressed subagent session and does not load it', () => {
    const load = vi.fn()
    render(<FavoriteModelSelect
      locked={false}
      available={false}
      directory={createSnapshotStore<ModelDirectoryState>(modelState())}
      load={load}
      select={vi.fn().mockResolvedValue(false)}
      favorites={favoritesForm([])}
      t={t}
    />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(load).not.toHaveBeenCalled()
  })
})
