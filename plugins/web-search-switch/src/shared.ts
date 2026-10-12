/** 网页搜索开关的共享常量与纯状态逻辑；浏览器半与测试共用。 */

/** 本插件拥有的文案命名空间；dsh 0.1.7 起与表单 entry id 不是同一个字符串。 */
export const NAMESPACE = 'dsh-plugin-web-search-switch'

/** 本插件在 cordis.patch.yml insert 行的 id，即插件行稳定身份。 */
export const ENTRY_ID = 'web-search-switch'

/** 本插件的 Bundle 完整包名，也是 plugins.bundle.config keyed 槽的 key。 */
export const BUNDLE_PACKAGE = '@dsh-kit/dsh-plugin-web-search-switch'

/** dsh 官方网页搜索宿主行的模块名（base bundle 行 `web-search-deepseek`）。 */
export const OFFICIAL_WEB_SEARCH_MODULE = '@deepseek-ai/dsh-web-search-deepseek'

/** listPlugins 返回里可用行的最小结构；字段名与 @deepseek-ai/dsh-plugin-manager 的 PluginInfo 对齐。 */
export interface PluginRowLike {
  readonly entryId?: string | undefined
  readonly moduleName: string
  readonly enabled: boolean
  readonly patchId?: string | undefined
  readonly readOnlyReason?: string | undefined
}

/** 官方网页搜索行在当前 dsh 里的可操作状态。 */
export type WebSearchState =
  | { kind: 'ready'; entryId: string; enabled: boolean }
  | { kind: 'locked'; reason: 'management-required' | 'unaddressable'; enabled: boolean }
  | { kind: 'unsupported' }
  | { kind: 'unavailable' }

/** 从 listPlugins 的返回解析官方网页搜索行的状态。 */
export function resolveWebSearchState(rows: readonly PluginRowLike[]): WebSearchState {
  const row = rows.find(item => item.moduleName === OFFICIAL_WEB_SEARCH_MODULE)
  if (row === undefined) return { kind: 'unsupported' }
  if (row.readOnlyReason !== undefined) {
    return { kind: 'locked', reason: row.readOnlyReason === 'management-required' ? 'management-required' : 'unaddressable', enabled: row.enabled }
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

/** 一次停用/启用操作折叠后的结果。 */
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

/** 重启提示是否仍需显示：目标值已经反映到实际行状态（或状态已不可用）时不再保留。 */
export function restartHintActive(pending: { readonly enabled: boolean } | undefined, state: WebSearchState): boolean {
  if (pending === undefined) return false
  return state.kind === 'ready' && state.enabled !== pending.enabled
}
