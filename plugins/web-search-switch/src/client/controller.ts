/** 经 ctx.remote 调用 dsh 官方 pluginManager 的薄封装；接口最小化，便于测试替换。 */

import { describeChange, resolveWebSearchState } from '../shared.js'
import type { ChangeResultLike, PluginRowLike, ToggleOutcome, WebSearchState } from '../shared.js'

/** typert 远程调用应答的最小结构，与官方生成客户端的 Answer 判别联合对齐。 */
export type RemoteAnswer<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

/** 本插件用到的两个远程服务的最小结构。 */
export interface RemoteLike {
  readonly pluginManager: {
    listPlugins(): Promise<RemoteAnswer<readonly PluginRowLike[]>>
    setPluginEnabled(entryId: string, enabled: boolean): Promise<RemoteAnswer<ChangeResultLike>>
  }
  readonly pluginInventory: {
    list(): Promise<RemoteAnswer<{ readonly managementAvailable?: boolean | undefined }>>
  }
}

/** 一次读取的结果：终态或带原因的读取失败。 */
export type ReadOutcome =
  | { kind: 'state'; state: WebSearchState }
  | { kind: 'error'; detail: string }

export class WebSearchController {
  constructor(private readonly remote: RemoteLike) {}

  /** 先确认宿主在管理 profile，再取官方行的可操作状态。 */
  async read(): Promise<ReadOutcome> {
    const inventory = await this.remote.pluginInventory.list()
    if (!inventory.ok) return { kind: 'error', detail: inventory.error.message }
    if (inventory.value.managementAvailable !== true) return { kind: 'state', state: { kind: 'unavailable' } }
    const plugins = await this.remote.pluginManager.listPlugins()
    if (!plugins.ok) return { kind: 'error', detail: plugins.error.message }
    return { kind: 'state', state: resolveWebSearchState(plugins.value) }
  }

  /** 停用/启用官方行；失败一律折成 ToggleOutcome，不向上 throw。 */
  async setEnabled(entryId: string, enabled: boolean): Promise<ToggleOutcome> {
    const answer = await this.remote.pluginManager.setPluginEnabled(entryId, enabled)
    if (!answer.ok) return { kind: 'failed', code: answer.error.code, detail: answer.error.message }
    return describeChange(answer.value)
  }
}
