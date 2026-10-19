// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import { ModelProviderLabel } from '../src/client/ModelProviderLabel.js'
import { en } from '../src/client/locales.js'

function directoryState(overrides: Partial<ModelDirectoryState> = {}): ModelDirectoryState {
  return {
    current: { provider: 'zai', model: 'glm-5.3' },
    routable: true,
    groups: [
      { id: 'zai', name: 'Z.ai', models: [{ id: 'glm-5.3', name: 'GLM-5.3' }] },
    ],
    failures: [],
    status: 'ready',
    pending: null,
    error: null,
    ...overrides,
  }
}

function makeDirectory(initial: ModelDirectoryState) {
  const store = createSnapshotStore<ModelDirectoryState>(initial)
  return store
}

const t = (key: keyof typeof en): string => en[key]

afterEach(cleanup)

describe('ModelProviderLabel', () => {
  it('渲染当前供应商显示名', () => {
    const directory = makeDirectory(directoryState())
    render(<ModelProviderLabel available directory={directory} />)
    expect(screen.getByText('Z.ai')).toBeDefined()
  })

  it('目录 store 更新（切换供应商）时跟随', async () => {
    const directory = makeDirectory(directoryState())
    render(<ModelProviderLabel available directory={directory} t={t} />)
    expect(screen.getByText('Z.ai')).toBeDefined()
    directory.set(directoryState({
      current: { provider: 'deepseek-account', model: 'v4' },
      groups: [{ id: 'deepseek-account', name: 'deepseek', models: [] }],
    }))
    await waitFor(() => expect(screen.getByText('DeepSeek Account')).toBeDefined())
  })

  it('无当前选择（加载中）时不渲染', () => {
    const directory = makeDirectory(directoryState({ current: null, status: 'loading', groups: [] }))
    const { container } = render(<ModelProviderLabel available directory={directory} />)
    expect(container.querySelector('[data-model-provider-label]')).toBeNull()
  })

  it('寻址 subagent 会话（available=false）时不渲染', () => {
    const directory = makeDirectory(directoryState())
    const { container } = render(<ModelProviderLabel available={false} directory={directory} />)
    expect(container.querySelector('[data-model-provider-label]')).toBeNull()
  })

  it('t 缺席时回退到键名（与收藏选择器同款防御）', () => {
    const directory = makeDirectory(directoryState({
      current: { provider: 'deepseek-account', model: 'v4' },
      groups: [{ id: 'deepseek-account', name: 'deepseek', models: [] }],
    }))
    render(<ModelProviderLabel available directory={directory} />)
    expect(screen.getByText('provider.account')).toBeDefined()
  })

  it('省略号落在内层 span，外层保持 flex 容器', () => {
    const directory = makeDirectory(directoryState())
    const { container } = render(<ModelProviderLabel available directory={directory} />)
    const host = container.querySelector<HTMLElement>('[data-model-provider-label]')
    expect(host).not.toBeNull()
    expect(getComputedStyle(host!).display).toContain('flex')
    const inner = host!.firstElementChild as HTMLElement
    expect(getComputedStyle(inner).textOverflow).toBe('ellipsis')
  })
})
