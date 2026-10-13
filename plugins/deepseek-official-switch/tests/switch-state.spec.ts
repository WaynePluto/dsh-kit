import { describe, expect, it } from 'vitest'
import {
  describeChange,
  restartHintActive,
  resolveOfficialRowState,
  OFFICIAL_ROW_ENTRY_ID,
  OFFICIAL_ROW_MODULE,
} from '../src/shared.js'
import type { PluginRowLike } from '../src/shared.js'

const officialRow = (overrides: Partial<PluginRowLike> = {}) => ({
  entryId: OFFICIAL_ROW_ENTRY_ID,
  moduleName: OFFICIAL_ROW_MODULE,
  enabled: true,
  patchId: OFFICIAL_ROW_ENTRY_ID,
  ...overrides,
})

describe('resolveOfficialRowState', () => {
  it('从 listPlugins 行里找到官方 DeepSeek API 密钥行', () => {
    expect(resolveOfficialRowState([
      { entryId: 'llm', moduleName: '@deepseek-ai/dsh-llm', enabled: true, patchId: 'llm' },
      officialRow(),
    ])).toEqual({ kind: 'ready', entryId: OFFICIAL_ROW_ENTRY_ID, enabled: true })
  })

  it('没有官方行时报告 unsupported（升级后官方移除该行的情形）', () => {
    expect(resolveOfficialRowState([
      { entryId: 'llm', moduleName: '@deepseek-ai/dsh-llm', enabled: true, patchId: 'llm' },
    ])).toEqual({ kind: 'unsupported' })
  })

  it('已停用的行仍是 ready 且 enabled 为 false（重启后可再恢复）', () => {
    expect(resolveOfficialRowState([officialRow({ enabled: false })]))
      .toEqual({ kind: 'ready', entryId: OFFICIAL_ROW_ENTRY_ID, enabled: false })
  })

  it('受保护或不可寻址的行报告 locked 并保留 enabled 供控件展示', () => {
    expect(resolveOfficialRowState([officialRow({ patchId: undefined, readOnlyReason: 'management-required' })]))
      .toEqual({ kind: 'locked', reason: 'management-required', enabled: true })
    expect(resolveOfficialRowState([officialRow({ patchId: undefined, readOnlyReason: 'unaddressable', enabled: false })]))
      .toEqual({ kind: 'locked', reason: 'unaddressable', enabled: false })
  })

  it('没有 readOnlyReason 却缺 entryId 的行按不可寻址处理', () => {
    expect(resolveOfficialRowState([officialRow({ entryId: undefined })]))
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

const readyState = (enabled: boolean) => ({ kind: 'ready' as const, entryId: OFFICIAL_ROW_ENTRY_ID, enabled })

describe('restartHintActive', () => {
  it('没有待生效写入时不显示提示', () => {
    expect(restartHintActive(undefined, readyState(false))).toBe(false)
  })

  it('写入目标尚未反映到实际状态时保留提示，追上后撤下', () => {
    expect(restartHintActive({ enabled: false }, readyState(true))).toBe(true)
    expect(restartHintActive({ enabled: false }, readyState(false))).toBe(false)
    expect(restartHintActive({ enabled: true }, readyState(false))).toBe(true)
  })

  it('行不可用或不可寻址时不再保留重启提示', () => {
    expect(restartHintActive({ enabled: false }, { kind: 'unsupported' })).toBe(false)
    expect(restartHintActive({ enabled: false }, { kind: 'locked', reason: 'unaddressable', enabled: true })).toBe(false)
  })
})
