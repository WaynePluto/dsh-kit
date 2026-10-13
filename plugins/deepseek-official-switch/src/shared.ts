/** 内置 DeepSeek（API 密钥）开关的共享常量与纯状态逻辑；浏览器半与测试共用。 */

/** 本插件拥有的文案命名空间；dsh 0.1.7 起与表单 entry id 不是同一个字符串。 */
export const NAMESPACE = 'dsh-plugin-deepseek-official-switch'

/** 本插件在 cordis.patch.yml insert 行的 id，即插件行稳定身份。 */
export const ENTRY_ID = 'deepseek-official-switch'

/** base bundle 里 deepseek-official 路由的宿主行 entry id（`llm-deepseek`）。 */
export const OFFICIAL_ROW_ENTRY_ID = 'llm-deepseek'

/** 官方 DeepSeek API 密钥行的模块名（base bundle 行 `llm-deepseek`）。 */
export const OFFICIAL_ROW_MODULE = '@deepseek-ai/dsh-llm-deepseek-api-key'

/** 要移除的内置供应商路由 id；模型页卡片按它的 settingsNs 寻址。 */
export const PROVIDER_ROUTE = 'deepseek-official'

/** 深见官方路由的 settingsNs，即原生 `settings.models.provider-card` keyed 槽的 key。 */
export const SETTINGS_NAMESPACE = 'llm-deepseek'

/** listPlugins 返回里可用行的最小结构；字段名与 @deepseek-ai/dsh-plugin-manager 的 PluginInfo 对齐。 */
export interface PluginRowLike {
  readonly entryId?: string | undefined
  readonly moduleName: string
  readonly enabled: boolean
  readonly patchId?: string | undefined
  readonly readOnlyReason?: string | undefined
}

/** 官方 DeepSeek API 密钥行在当前 dsh 里的可操作状态。 */
export type OfficialRowState =
  | { kind: 'ready'; entryId: string; enabled: boolean }
  | { kind: 'locked'; reason: 'management-required' | 'unaddressable'; enabled: boolean }
  | { kind: 'unsupported' }
  | { kind: 'unavailable' }

/** 从 listPlugins 的返回解析官方 DeepSeek API 密钥行的状态。 */
export function resolveOfficialRowState(rows: readonly PluginRowLike[]): OfficialRowState {
  const row = rows.find(item => item.moduleName === OFFICIAL_ROW_MODULE)
  if (row === undefined) return { kind: 'unsupported' }
  if (row.readOnlyReason !== undefined) {
    return {
      kind: 'locked',
      reason: row.readOnlyReason === 'management-required' ? 'management-required' : 'unaddressable',
      enabled: row.enabled,
    }
  }
  // 没有 readOnlyReason 的行必然给出 patchId 与 entryId；缺 entryId 是契约破坏，按不可寻址处理。
  if (row.entryId === undefined) return { kind: 'locked', reason: 'unaddressable', enabled: row.enabled }
  return { kind: 'ready', entryId: row.entryId, enabled: row.enabled }
}

/** ChangeResult 的最小结构（pluginManager setPluginEnabled 的返回值）。 */
export interface ChangeResultLike {
  readonly changed?: boolean | undefined
  readonly application?: string | undefined
  readonly enabled?: boolean | undefined
  readonly error?: { readonly code?: string | undefined; readonly diagnostic?: string | undefined } | undefined
}

/** 一次移除/恢复操作折叠后的结果。 */
export type ToggleOutcome =
  | { kind: 'applied'; enabled: boolean }
  | { kind: 'restart-required'; enabled: boolean }
  | { kind: 'unchanged'; enabled: boolean }
  | { kind: 'overridden' }
  | { kind: 'failed'; code?: string | undefined; detail?: string | undefined }

/** 把 setPluginEnabled 的 ChangeResult 折成界面可直接呈现的结果；宿主失败不 throw，折进 application:'failed'。 */
export function describeChange(result: ChangeResultLike): ToggleOutcome {
  if (result.application === 'failed' || result.application === 'cancelled') {
    return { kind: 'failed', code: result.error?.code, detail: result.error?.diagnostic }
  }
  if (result.application === 'overridden') return { kind: 'overridden' }
  const enabled = result.enabled === true
  if (result.changed === false) return { kind: 'unchanged', enabled }
  if (result.application === 'restart-required') return { kind: 'restart-required', enabled }
  return { kind: 'applied', enabled }
}

/** 待生效写入：目标值已写入 profile 补丁，实际行状态尚未跟上（等重启或热加载）。 */
export interface PendingWrite {
  readonly enabled: boolean
}

/**
 * 极小外部存储：控制器持有同一实例，删除卡片与底部恢复入口两个槽位组件经
 * useSyncExternalStore 共享事实（待生效写入、最近一次行状态读取），任一处读取或写入
 * 都让另一方立即跟上——热生效路径里卡片组件卸载前的那次重读就是 footer 的更新源。
 * set 按结构化值去重；subscribe 绑定为箭头函数，保证 useSyncExternalStore 拿到稳定引用。
 */
export class SharedStore<T> {
  private value: T
  private readonly listeners = new Set<() => void>()

  constructor(initial: T) { this.value = initial }

  get(): T { return this.value }

  set(next: T): void {
    if (JSON.stringify(this.value) === JSON.stringify(next)) return
    this.value = next
    for (const listener of this.listeners) listener()
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
}

/** 待生效写入的共享存储。 */
export type PendingWriteStore = SharedStore<PendingWrite | undefined>

/** 待生效写入是否仍需显示：目标值已经反映到实际行状态（或状态已不可用）时不再保留。 */
export function restartHintActive(
  pending: PendingWrite | undefined,
  state: OfficialRowState,
): boolean {
  if (pending === undefined) return false
  return state.kind === 'ready' && state.enabled !== pending.enabled
}
