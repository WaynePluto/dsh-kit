import { describe, expect, it } from 'vitest'
import { providerDisplayName } from '../src/client/label.js'

const ACCOUNT = 'DeepSeek 账号'

function state(current: { provider: string; model: string } | null, groups: Array<{ id: string; name: string }> = []) {
  return {
    current,
    groups: groups.map(group => ({ id: group.id, name: group.name, models: [] })),
  }
}

describe('providerDisplayName', () => {
  it('无当前选择时不显示', () => {
    expect(providerDisplayName(state(null), ACCOUNT)).toBeNull()
  })

  it('显示当前供应商组的显示名', () => {
    const snapshot = state(
      { provider: 'zai', model: 'glm-5.3' },
      [{ id: 'zai', name: 'Z.ai' }, { id: 'deepseek-official', name: 'DeepSeek' }],
    )
    expect(providerDisplayName(snapshot, ACCOUNT)).toBe('Z.ai')
  })

  it('deepseek-account 特判为账号显示名（对齐原生菜单标题）', () => {
    const snapshot = state(
      { provider: 'deepseek-account', model: 'v4' },
      [{ id: 'deepseek-account', name: 'deepseek' }],
    )
    expect(providerDisplayName(snapshot, ACCOUNT)).toBe(ACCOUNT)
  })

  it('目录未装载（组缺失）时回退原始 provider id', () => {
    expect(providerDisplayName(state({ provider: 'zai', model: 'glm' }), ACCOUNT)).toBe('zai')
  })

  it('组名为空时回退组 id', () => {
    const snapshot = state({ provider: 'zai', model: 'glm' }, [{ id: 'zai', name: '' }])
    expect(providerDisplayName(snapshot, ACCOUNT)).toBe('zai')
  })

  it('provider 为空串时不显示', () => {
    expect(providerDisplayName(state({ provider: '', model: 'm' }), ACCOUNT)).toBeNull()
  })
})
