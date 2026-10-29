// @vitest-environment jsdom
/** 套件更新卡片的渲染测试：api.check 成功/失败三种形态的界面结果（信封语义回归防线）。 */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SuiteUpdatesCard } from '../src/client/SuiteUpdatesCard.js'
import type { SuiteUpdatesApi } from '../src/client/SuiteUpdatesCard.js'
import { en, fill } from '../src/client/locales.js'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  // jsdom 无剪贴板：桩成成功复制，锁定「已复制」提示分支。
  writeClipboard: vi.fn(async () => true),
  Button: (props: Record<string, unknown>) => <button type="button" {...props} />,
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const t = (key: keyof typeof en, values?: Record<string, string | number>): string =>
  fill(en[key], values)

const okResult = (overrides?: Partial<{ current: string; latest: string; hasUpdate: boolean; url: string }>) => ({
  current: '0.0.1',
  latest: '0.0.1',
  hasUpdate: false,
  url: 'https://github.com/WaynePluto/dsh-kit/releases/download/v0.0.1/dsh-kit.tar.gz',
  ...overrides,
})

describe('SuiteUpdatesCard', () => {
  it('检查成功且已是最新：显示当前版本与已最新提示，不显示失败', async () => {
    const api: SuiteUpdatesApi = { check: vi.fn(async () => okResult()) }
    render(<SuiteUpdatesCard t={t} api={api} />)

    const hint = await screen.findByRole('status')
    expect(hint.textContent).toContain('Already up to date.')
    expect(screen.getByText('Current version v0.0.1')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('检查成功且有新版本：显示新版本与已复制提示', async () => {
    const api: SuiteUpdatesApi = { check: vi.fn(async () => okResult({
      latest: '0.0.2', hasUpdate: true, url: 'https://example.com/v0.0.2',
    })) }
    render(<SuiteUpdatesCard t={t} api={api} />)

    const hint = await screen.findByRole('status')
    expect(hint.textContent).toContain('New version v0.0.2 available.')
    expect(hint.textContent).toContain('Upgrade address copied')
  })

  it('检查失败：显示失败原因，不再把成功值误读成信封（回归）', async () => {
    const api: SuiteUpdatesApi = { check: vi.fn(async () => { throw new Error('boom') }) }
    render(<SuiteUpdatesCard t={t} api={api} />)

    expect((await screen.findByRole('alert')).textContent).toContain('Check failed: boom')
  })
})
