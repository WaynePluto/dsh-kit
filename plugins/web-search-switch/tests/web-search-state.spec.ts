import { describe, expect, it } from 'vitest'
import {
  describeChange,
  restartHintActive,
  resolveWebSearchState,
  OFFICIAL_WEB_SEARCH_MODULE,
} from '../src/shared.js'
import type { PluginRowLike } from '../src/shared.js'

const officialRow = (overrides: Partial<PluginRowLike> = {}) => ({
  entryId: 'web-search-deepseek',
  moduleName: OFFICIAL_WEB_SEARCH_MODULE,
  enabled: true,
  patchId: 'web-search-deepseek',
  ...overrides,
})

describe('resolveWebSearchState', () => {
  it('从 listPlugins 行里找到官方网页搜索行', () => {
    expect(resolveWebSearchState([
      { entryId: 'web', moduleName: '@deepseek-ai/dsh-web', enabled: true, patchId: 'web' },
      officialRow(),
    ])).toEqual({ kind: 'ready', entryId: 'web-search-deepseek', enabled: true })
  })

  it('没有官方行时报告 unsupported（升级后官方移除该行的情形）', () => {
    expect(resolveWebSearchState([
      { entryId: 'web', moduleName: '@deepseek-ai/dsh-web', enabled: true, patchId: 'web' },
    ])).toEqual({ kind: 'unsupported' })
  })

  it('已停用的行仍是 ready 且 enabled 为 false（重启后可再启用）', () => {
    expect(resolveWebSearchState([officialRow({ enabled: false })]))
      .toEqual({ kind: 'ready', entryId: 'web-search-deepseek', enabled: false })
  })

  it('受保护或不可寻址的行报告 locked 并保留 enabled 供开关展示', () => {
    expect(resolveWebSearchState([officialRow({ patchId: undefined, readOnlyReason: 'management-required' })]))
      .toEqual({ kind: 'locked', reason: 'management-required', enabled: true })
    expect(resolveWebSearchState([officialRow({ patchId: undefined, readOnlyReason: 'unaddressable', enabled: false })]))
      .toEqual({ kind: 'locked', reason: 'unaddressable', enabled: false })
  })

  it('没有 readOnlyReason 却缺 entryId 的行按不可寻址处理', () => {
    expect(resolveWebSearchState([officialRow({ entryId: undefined })]))
      .toEqual({ kind: 'locked', reason: 'unaddressable', enabled: true })
  })
})

describe('describeChange', () => {
  it('热加载生效与需重启两种结果分别折叠', () => {
    expect(describeChange({ changed: true, application: 'applied', enabled: false }))
      .toEqual({ kind: 'applied', enabled: false })
    expect(describeChange({ changed: true, application: 'restart-required', enabled: false }))
      .toEqual({ kind: 'restart-required', enabled: false })
  })

  it('值未变化时不提示任何生效语义', () => {
    expect(describeChange({ changed: false, application: 'restart-required', enabled: true }))
      .toEqual({ kind: 'unchanged', enabled: true })
  })

  it('宿主折叠的失败与取消都报告为 failed 并保留诊断', () => {
    expect(describeChange({ changed: true, application: 'failed', enabled: false, error: { code: 'operation-error', diagnostic: 'EACCES' } }))
      .toEqual({ kind: 'failed', code: 'operation-error', detail: 'EACCES' })
    expect(describeChange({ changed: true, application: 'cancelled', enabled: false }))
      .toEqual({ kind: 'failed', code: undefined, detail: undefined })
  })

  it('被其他补丁覆盖时报告 overridden', () => {
    expect(describeChange({ changed: true, application: 'overridden', enabled: true }))
      .toEqual({ kind: 'overridden' })
  })
})

const readyState = (enabled: boolean) => ({ kind: 'ready' as const, entryId: 'web-search-deepseek', enabled })

describe('restartHintActive', () => {
  it('没有待生效写入时不显示提示', () => {
    expect(restartHintActive(undefined, readyState(false))).toBe(false)
  })

  it('写入目标尚未反映到实际状态时保留提示，追上后撤下', () => {
    expect(restartHintActive({ enabled: false }, readyState(true))).toBe(true)
    expect(restartHintActive({ enabled: false }, readyState(false))).toBe(false)
  })

  it('行不可用或不可寻址时不再保留重启提示', () => {
    expect(restartHintActive({ enabled: false }, { kind: 'unsupported' })).toBe(false)
    expect(restartHintActive({ enabled: false }, { kind: 'locked', reason: 'unaddressable', enabled: true })).toBe(false)
  })
})
