// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Switch: ({ checked, onChange, label, disabled, title }: {
    checked: boolean
    onChange: (next: boolean) => void
    label: string
    disabled?: boolean
    title?: string
  }) => (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} title={title} onClick={() => { onChange(!checked) }} />
  ),
}))

import type { RemoteAnswer, RemoteLike } from '../src/client/controller.js'
import { WebSearchController } from '../src/client/controller.js'
import type { ChangeResultLike, PluginRowLike } from '../src/shared.js'
import { OFFICIAL_WEB_SEARCH_MODULE } from '../src/shared.js'
import { WebSearchSwitchCard } from '../src/client/WebSearchSwitchCard.js'
import { en, fill } from '../src/client/locales.js'
import type { LocaleKey } from '../src/client/locales.js'

const t = (key: LocaleKey, values?: Readonly<Record<string, string | number>>): string => fill(en[key], values ?? {})

const officialRow = (overrides: Partial<PluginRowLike> = {}): PluginRowLike => ({
  entryId: 'web-search-deepseek',
  moduleName: OFFICIAL_WEB_SEARCH_MODULE,
  enabled: true,
  patchId: 'web-search-deepseek',
  ...overrides,
})

interface FakeOptions {
  rows?: PluginRowLike[]
  managementAvailable?: boolean
  change?: ChangeResultLike
  refused?: { code: string; message: string }
}

interface FakeRemote extends RemoteLike {
  rows: PluginRowLike[]
  managementAvailable: boolean
}

/** 行集可变的假远程：写入后由用例自行改 rows，模拟「重启前仍读到旧状态」或热加载生效。 */
function fakeRemote(options: FakeOptions = {}): FakeRemote {
  let rows: PluginRowLike[] = options.rows ?? [officialRow()]
  let managementAvailable = options.managementAvailable ?? true
  const setPluginEnabled = vi.fn(async (_entryId: string, enabled: boolean): Promise<RemoteAnswer<ChangeResultLike>> => {
    if (options.refused !== undefined) return { ok: false, error: options.refused }
    return { ok: true, value: options.change ?? { changed: true, application: 'restart-required', enabled } }
  })
  return {
    get rows() { return rows },
    set rows(next: PluginRowLike[]) { rows = next },
    get managementAvailable() { return managementAvailable },
    set managementAvailable(next: boolean) { managementAvailable = next },
    pluginManager: {
      listPlugins: async () => ({ ok: true as const, value: rows }),
      setPluginEnabled,
    },
    pluginInventory: {
      list: async () => ({ ok: true as const, value: { managementAvailable } }),
    },
  }
}

const renderCard = (fake: ReturnType<typeof fakeRemote>) =>
  render(<WebSearchSwitchCard t={t} controller={new WebSearchController(fake)} />)

afterEach(cleanup)

describe('WebSearchSwitchCard', () => {
  it('先显示读取中，随后呈现已启用状态与可用开关', async () => {
    const fake = fakeRemote()
    renderCard(fake)
    expect(screen.getByText(en.loading)).toBeTruthy()
    await waitFor(() => { expect(screen.getByRole('switch')).toBeTruthy() })
    expect((screen.getByRole('switch') as HTMLButtonElement).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText(en.statusOn)).toBeTruthy()
  })

  it('停用返回 restart-required 时显示重启提示，读到旧状态前保留', async () => {
    const fake = fakeRemote({ change: { changed: true, application: 'restart-required', enabled: false } })
    renderCard(fake)
    await waitFor(() => { expect(screen.getByRole('switch')).toBeTruthy() })
    fireEvent.click(screen.getByRole('switch'))
    await waitFor(() => { expect(screen.getByText(en.hintRestart)).toBeTruthy() })
    // 重启前 listPlugins 仍返回 enabled:true，提示保留；开关仍指向已启用。
    expect((screen.getByRole('switch') as HTMLButtonElement).getAttribute('aria-checked')).toBe('true')
    expect(fake.pluginManager.setPluginEnabled).toHaveBeenCalledWith('web-search-deepseek', false)
  })

  it('热加载生效后开关与状态行翻转，重启提示不出现', async () => {
    const fake = fakeRemote({ change: { changed: true, application: 'applied', enabled: false } })
    renderCard(fake)
    await waitFor(() => { expect(screen.getByRole('switch')).toBeTruthy() })
    // 模拟宿主热加载：下一次读取反映停用。
    fake.rows = [officialRow({ enabled: false })]
    fireEvent.click(screen.getByRole('switch'))
    await waitFor(() => { expect((screen.getByRole('switch') as HTMLButtonElement).getAttribute('aria-checked')).toBe('false') })
    expect(screen.getByText(en.statusOff)).toBeTruthy()
    expect(screen.queryByText(en.hintRestart)).toBeNull()
  })

  it('远程拒绝写入时就地报错并保留原状态', async () => {
    const fake = fakeRemote({ refused: { code: 'management-required', message: 'refused by host' } })
    renderCard(fake)
    await waitFor(() => { expect(screen.getByRole('switch')).toBeTruthy() })
    fireEvent.click(screen.getByRole('switch'))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe(fill(en.writeFailed, { detail: 'refused by host' })) })
    expect((screen.getByRole('switch') as HTMLButtonElement).getAttribute('aria-checked')).toBe('true')
  })

  it('受保护行渲染锁定开关并说明原因', async () => {
    renderCard(fakeRemote({ rows: [officialRow({ patchId: undefined, readOnlyReason: 'management-required' })] }))
    await waitFor(() => { expect(screen.getByRole('switch')).toBeTruthy() })
    expect((screen.getByRole('switch') as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByTitle(en.lockedManagement)).toBeTruthy()
  })

  it('宿主未管理 profile 或官方行不存在时只显示说明，不渲染开关', async () => {
    const { unmount } = renderCard(fakeRemote({ managementAvailable: false }))
    await waitFor(() => { expect(screen.getByText(en.unavailable)).toBeTruthy() })
    expect(screen.queryByRole('switch')).toBeNull()
    unmount()

    renderCard(fakeRemote({ rows: [{ entryId: 'web', moduleName: '@deepseek-ai/dsh-web', enabled: true, patchId: 'web' }] }))
    await waitFor(() => { expect(screen.getByText(en.unsupported)).toBeTruthy() })
    expect(screen.queryByRole('switch')).toBeNull()
  })
})
