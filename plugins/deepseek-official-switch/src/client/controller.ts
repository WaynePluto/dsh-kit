/** 经 ctx.remote 调用 dsh 官方 pluginManager 的薄封装；接口最小化，便于测试替换。
 *  行状态读取结果与待生效写入都存在控制器实例上：删除卡片与底部恢复入口两个槽位组件
 *  经 useSyncExternalStore 订阅同一份事实，任一处读取/写入后另一方立即跟上。 */

import { describeChange, resolveOfficialRowState, SharedStore } from '../shared.js'
import type { ChangeResultLike, OfficialRowState, PendingWrite, PendingWriteStore, PluginRowLike, ToggleOutcome } from '../shared.js'

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
  | { kind: 'state'; state: OfficialRowState }
  | { kind: 'error'; detail: string }

/** 行状态读取的共享存储；undefined 表示尚未完成首次读取。 */
export type RowStateStore = SharedStore<ReadOutcome | undefined>

export class OfficialSwitchController {
  /** 待生效写入：删除确认后底部恢复入口由此立即得知，无需等重启后的行状态。 */
  readonly pending: PendingWriteStore = new SharedStore<PendingWrite | undefined>(undefined)
  /** 最近一次行状态读取：热生效时卡片组件卸载前的重读就是 footer 的更新源。 */
  readonly rowState: RowStateStore = new SharedStore<ReadOutcome | undefined>(undefined)

  constructor(private readonly remote: RemoteLike) {}

  /** 先确认宿主在管理 profile，再取官方行的可操作状态；结果发布到共享存储。 */
  async read(): Promise<ReadOutcome> {
    const inventory = await this.remote.pluginInventory.list()
    const outcome: ReadOutcome = !inventory.ok
      ? { kind: 'error', detail: inventory.error.message }
      : inventory.value.managementAvailable !== true
        ? { kind: 'state', state: { kind: 'unavailable' } }
        : await (async () => {
          const plugins = await this.remote.pluginManager.listPlugins()
          if (!plugins.ok) return { kind: 'error', detail: plugins.error.message }
          return { kind: 'state', state: resolveOfficialRowState(plugins.value) }
        })()
    this.rowState.set(outcome)
    // 行状态已追上待生效目标（或行已不可用）时撤下待生效标记；读取失败保留标记。
    if (outcome.kind === 'state') {
      const pending = this.pending.get()
      const active = outcome.state.kind === 'ready' && outcome.state.enabled !== pending?.enabled
      this.pending.set(active === true && pending !== undefined ? pending : undefined)
    }
    return outcome
  }

  /** 移除（false）/恢复（true）官方行；失败一律折成 ToggleOutcome，不向上 throw。 */
  async setEnabled(entryId: string, enabled: boolean): Promise<ToggleOutcome> {
    const answer = await this.remote.pluginManager.setPluginEnabled(entryId, enabled)
    if (!answer.ok) return { kind: 'failed', code: answer.error.code, detail: answer.error.message }
    return describeChange(answer.value)
  }
}
