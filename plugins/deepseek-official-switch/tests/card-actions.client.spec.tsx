// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: ({ children, disabled, className, onClick }: {
    children: ReactNode
    disabled?: boolean
    className?: string
    onClick?: () => void
  }) => (
    <button type="button" disabled={disabled} className={className} onClick={onClick}>{children}</button>
  ),
  Modal: ({ open, title, description, children, footer }: {
    open: boolean
    title: string
    description: string
    children?: ReactNode
    footer?: ReactNode
  }) => open
    ? (
      <div role="dialog" aria-label={title}>
        <p>{description}</p>
        {children}
        {footer}
      </div>
    )
    : null,
}))

import type { RemoteAnswer } from '../src/client/controller.js'
import { OfficialSwitchController } from '../src/client/controller.js'
import { DeepSeekOfficialCardActions, actionHostOf } from '../src/client/CardActions.js'
import { DeepSeekOfficialRestore } from '../src/client/RestoreFooter.js'
import { en, fill } from '../src/client/locales.js'
import type { LocaleKey } from '../src/client/locales.js'
import type { ChangeResultLike, PluginRowLike } from '../src/shared.js'
import { OFFICIAL_ROW_ENTRY_ID, OFFICIAL_ROW_MODULE, PROVIDER_ROUTE } from '../src/shared.js'

const t = (key: LocaleKey): string => en[key]

const officialRow = (overrides: Partial<PluginRowLike> = {}): PluginRowLike => ({
  entryId: OFFICIAL_ROW_ENTRY_ID,
  moduleName: OFFICIAL_ROW_MODULE,
  enabled: true,
  patchId: OFFICIAL_ROW_ENTRY_ID,
  ...overrides,
})

interface FakeOptions {
  rows?: PluginRowLike[]
  managementAvailable?: boolean
  change?: ChangeResultLike
  refused?: { code: string; message: string }
  listError?: { code: string; message: string }
}

type SetPluginEnabledMock = ReturnType<typeof vi.fn<(
  entryId: string,
  enabled: boolean,
) => Promise<RemoteAnswer<ChangeResultLike>>>>

interface Fake {
  readonly setPluginEnabled: SetPluginEnabledMock
  readonly pluginManager: {
    readonly listPlugins: () => Promise<RemoteAnswer<readonly PluginRowLike[]>>
    readonly setPluginEnabled: SetPluginEnabledMock
  }
  readonly pluginInventory: {
    readonly list: () => Promise<RemoteAnswer<{ readonly managementAvailable?: boolean | undefined }>>
  }
  /** 行集可变：写入后由用例改写，模拟「重启前仍读旧状态」或热加载生效。 */
  rows: PluginRowLike[]
}

function fakeRemote(options: FakeOptions = {}): Fake {
  let rows: PluginRowLike[] = options.rows ?? [officialRow()]
  const managementAvailable = options.managementAvailable ?? true
  const setPluginEnabled = vi.fn(async (_entryId: string, enabled: boolean): Promise<RemoteAnswer<ChangeResultLike>> => {
    if (options.refused !== undefined) return { ok: false, error: options.refused }
    return { ok: true, value: options.change ?? { changed: true, application: 'restart-required', enabled } }
  })
  return {
    setPluginEnabled,
    pluginManager: {
      listPlugins: async () => (options.listError !== undefined
        ? { ok: false as const, error: options.listError }
        : { ok: true as const, value: rows }),
      setPluginEnabled,
    },
    pluginInventory: {
      list: async () => ({ ok: true as const, value: { managementAvailable } }),
    },
    get rows() { return rows },
    set rows(next: PluginRowLike[]) { rows = next },
  }
}

/** 原生行卡片的最小 DOM：li > div.rowHead > (span.rowIdentity, span.rowActions > button)。 */
function NativeCard({ children, structurallyValid = true }: { children: ReactNode; structurallyValid?: boolean }): ReactNode {
  return (
    <ul>
      <li>
        {structurallyValid
          ? (
            <div>
              <span>DeepSeek</span>
              <span><button type="button">Edit</button></span>
            </div>
          )
          : <div><p>setup posture has no action row</p></div>}
        {children}
      </li>
    </ul>
  )
}

const cardActionsNode = (controller: OfficialSwitchController, provider = PROVIDER_ROUTE, structurallyValid = true) => (
  <NativeCard structurallyValid={structurallyValid}>
    <DeepSeekOfficialCardActions
      provider={{
        provider,
        displayName: 'DeepSeek',
        settingsNs: 'llm-deepseek',
        settingsPath: [],
        active: true,
      }}
      configured
      keyConfigured={false}
      t={t}
      controller={controller}
    />
  </NativeCard>
)

const renderActions = (fake: Fake, provider = PROVIDER_ROUTE, structurallyValid = true) =>
  render(cardActionsNode(new OfficialSwitchController(fake), provider, structurallyValid))

const renderRestore = (fake: Fake) =>
  render(<DeepSeekOfficialRestore t={t} controller={new OfficialSwitchController(fake)} />)

/** 删除卡片与底部恢复入口用同一个控制器实例：共享行状态与待生效写入。 */
const renderPair = (fake: Fake) => {
  const controller = new OfficialSwitchController(fake)
  const view = render(
    <>
      {cardActionsNode(controller)}
      <DeepSeekOfficialRestore t={t} controller={controller} />
    </>,
  )
  return { controller, view }
}

const removeButton = (): HTMLButtonElement => screen.getByRole('button', { name: en.removeTitle }) as HTMLButtonElement

afterEach(cleanup)

describe('DeepSeekOfficialCardActions', () => {
  it('删除按钮 portal 进原生操作区，确认后写入停用并提示重启', async () => {
    const fake = fakeRemote()
    renderActions(fake)
    await waitFor(() => { expect(removeButton().disabled).toBe(false) })
    // 按钮落在原生 rowActions span 内（与原生编辑按钮同行）。
    expect(removeButton().textContent).toBe(en.remove)
    fireEvent.click(removeButton())
    const dialog = within(screen.getByRole('dialog', { name: en.dialogTitle }))
    expect(screen.getByRole('dialog', { name: en.dialogTitle }).textContent).toContain(en.dialogDescription)
    fireEvent.click(dialog.getByText(en.confirm))
    await waitFor(() => { expect(fake.setPluginEnabled).toHaveBeenCalledWith(OFFICIAL_ROW_ENTRY_ID, false) })
    await waitFor(() => { expect(screen.getByText(en.hintRestart)).toBeTruthy() })
  })

  it('行已停用（等重启）时不再提供按钮，改为显示消失提示', async () => {
    renderActions(fakeRemote({ rows: [officialRow({ enabled: false })] }))
    await waitFor(() => { expect(screen.getByText(en.disabledPending)).toBeTruthy() })
    expect(screen.queryByRole('button', { name: en.removeTitle })).toBeNull()
  })

  it('受保护行渲染禁用按钮并说明原因', async () => {
    renderActions(fakeRemote({ rows: [officialRow({ patchId: undefined, readOnlyReason: 'management-required' })] }))
    await waitFor(() => { expect(removeButton().disabled).toBe(true) })
    expect(removeButton().getAttribute('title')).toBe(en.lockedManagement)
  })

  it('宿主未管理 profile、官方行不存在或读取失败时不渲染按钮', async () => {
    const unavailable = renderActions(fakeRemote({ managementAvailable: false }))
    await waitFor(() => { expect(screen.queryByRole('button', { name: en.removeTitle })).toBeNull() })
    unavailable.unmount()
    const unsupported = renderActions(fakeRemote({
      rows: [{ entryId: 'llm', moduleName: '@deepseek-ai/dsh-llm', enabled: true, patchId: 'llm' }],
    }))
    await waitFor(() => { expect(screen.queryByRole('button', { name: en.removeTitle })).toBeNull() })
    unsupported.unmount()
    renderActions(fakeRemote({ listError: { code: 'x', message: 'boom' } }))
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe(fill(en.readFailed, { detail: 'boom' }))
    })
    expect(screen.queryByRole('button', { name: en.removeTitle })).toBeNull()
  })

  it('原生 DOM 结构不匹配（setup 卡没有操作区）时不渲染按钮', async () => {
    renderActions(fakeRemote(), PROVIDER_ROUTE, false)
    await waitFor(() => { expect(screen.queryByRole('button', { name: en.removeTitle })).toBeNull() })
  })

  it('其他供应商的卡片一概不渲染', () => {
    const { container } = renderActions(fakeRemote(), 'zai-coding-cn')
    expect(container.querySelector('[data-dsh-deepseek-official-switch-anchor]')).toBeNull()
  })

  it('远程拒绝写入时在弹窗内就地报错且不关闭', async () => {
    const fake = fakeRemote({ refused: { code: 'management-required', message: 'refused by host' } })
    renderActions(fake)
    await waitFor(() => { expect(removeButton().disabled).toBe(false) })
    fireEvent.click(removeButton())
    fireEvent.click(within(screen.getByRole('dialog', { name: en.dialogTitle })).getByText(en.confirm))
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe(fill(en.writeFailed, { detail: 'refused by host' }))
    })
    expect(screen.getByRole('dialog', { name: en.dialogTitle })).toBeTruthy()
    expect(fake.setPluginEnabled).toHaveBeenCalledWith(OFFICIAL_ROW_ENTRY_ID, false)
  })
})

describe('actionHostOf', () => {
  it('取 li 第一个 div 的最后一个 span；无 rowHead 结构时返回 null', () => {
    const host = document.createElement('li')
    const head = document.createElement('div')
    const identity = document.createElement('span')
    const actions = document.createElement('span')
    head.append(identity, actions)
    host.append(head)
    expect(actionHostOf(host)).toBe(actions)
    const bare = document.createElement('li')
    const editor = document.createElement('div')
    editor.append(document.createElement('p'))
    bare.append(editor)
    expect(actionHostOf(bare)).toBeNull()
  })
})

describe('DeepSeekOfficialRestore', () => {
  it('行启用且无待生效写入时不渲染任何内容', async () => {
    const { container } = renderRestore(fakeRemote())
    await waitFor(() => { expect(container.textContent).toBe('') })
  })

  it('删除确认待重启期间（共享 pending）立即显示恢复入口，可撤回', async () => {
    const controller = new OfficialSwitchController(fakeRemote())
    const view = render(<DeepSeekOfficialRestore t={t} controller={controller} />)
    await waitFor(() => { expect(view.container.textContent).toBe('') })
    act(() => { controller.pending.set({ enabled: false }) })
    expect(screen.getByText(en.footerPending)).toBeTruthy()
    expect(screen.getByRole('button', { name: en.restore })).toBeTruthy()
    act(() => { controller.pending.set(undefined) })
    expect(screen.queryByText(en.footerPending)).toBeNull()
    view.unmount()
  })

  it('行已移除时显示说明与恢复按钮，点击写入启用', async () => {
    const fake = fakeRemote({ rows: [officialRow({ enabled: false })] })
    renderRestore(fake)
    const restore = await waitFor(() => screen.getByRole('button', { name: en.restore }) as HTMLButtonElement)
    expect(screen.getByText(en.footerRemoved)).toBeTruthy()
    fireEvent.click(restore)
    await waitFor(() => { expect(fake.setPluginEnabled).toHaveBeenCalledWith(OFFICIAL_ROW_ENTRY_ID, true) })
    // 恢复是重启生效：重启提示保留，入口不消失。
    await waitFor(() => { expect(screen.getByText(en.hintRestart)).toBeTruthy() })
    expect(screen.getByRole('button', { name: en.restore })).toBeTruthy()
  })

  it('恢复写入拒绝时就地报错', async () => {
    const fake = fakeRemote({ rows: [officialRow({ enabled: false })], refused: { code: 'x', message: 'no' } })
    renderRestore(fake)
    fireEvent.click(await waitFor(() => screen.getByRole('button', { name: en.restore })))
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe(fill(en.writeFailed, { detail: 'no' }))
    })
  })
})

describe('删除卡片与恢复入口共享状态', () => {
  it('确认删除（restart-required）后 footer 立即出现；撤回后自愈消失', async () => {
    const fake = fakeRemote()
    const { view } = renderPair(fake)
    await waitFor(() => { expect(removeButton().disabled).toBe(false) })
    // listPlugins 仍报告启用（重启前），footer 尚未出现。
    expect(screen.queryByText(en.footerPending)).toBeNull()
    fireEvent.click(removeButton())
    fireEvent.click(within(screen.getByRole('dialog', { name: en.dialogTitle })).getByText(en.confirm))
    // 写入 restart-required 后 footer 立即出现，无需等重启。
    await waitFor(() => { expect(screen.getByText(en.footerPending)).toBeTruthy() })
    expect(screen.getByText(en.hintRestart)).toBeTruthy()
    expect(screen.getByRole('button', { name: en.restore })).toBeTruthy()
    // 点击恢复撤回：行实际仍是启用状态，重读后待生效状态自愈清除，footer 消失。
    fireEvent.click(screen.getByRole('button', { name: en.restore }))
    await waitFor(() => { expect(fake.setPluginEnabled).toHaveBeenCalledWith(OFFICIAL_ROW_ENTRY_ID, true) })
    await waitFor(() => { expect(screen.queryByText(en.footerPending)).toBeNull() })
    view.unmount()
  })

  it('删除热生效（applied 且行集翻转）时，卡片卸载前的那次重读让 footer 立即出现', async () => {
    const fake = fakeRemote({ change: { changed: true, application: 'applied', enabled: false } })
    const { view } = renderPair(fake)
    await waitFor(() => { expect(removeButton().disabled).toBe(false) })
    // 写入热生效：宿主行集在写入后即反映停用（卡片随之卸载，组件重读共享行状态）。
    fireEvent.click(removeButton())
    fireEvent.click(within(screen.getByRole('dialog', { name: en.dialogTitle })).getByText(en.confirm))
    fake.rows = [officialRow({ enabled: false })]
    await waitFor(() => { expect(screen.getByText(en.footerRemoved)).toBeTruthy() })
    expect(screen.getByRole('button', { name: en.restore })).toBeTruthy()
    view.unmount()
  })
})
