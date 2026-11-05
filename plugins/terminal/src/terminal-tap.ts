/**
 * PTY 原始输出 tap：sessionId → 句柄登记、有界 ring buffer 与实时扇出。
 *
 * 句柄由 {@link ./terminal-backend.ts!} 的包装 backend 在 spawn 时登记（上游
 * `LocalPtySession` 照常消费同一 `output` Readable 的另一组 listener，互不干扰）。
 * 浏览器流式路由从这里取数据：attach 先重放 ring 再接实时帧；进程退出后
 * entry 保留（exit 帧可重放），直到 registry close 移除。
 */

import type { SubprocessTerminalHandle } from '@deepseek-ai/dsh-subprocess'

/** ring buffer 默认容量：重连重放最近 512KB 原始字节。 */
export const RING_MAX_BYTES = 512 * 1024

/** PTY 当前几何（spawn 时上报，重放按原几何渲染避免错位）。 */
export interface TapSize {
  readonly cols: number
  readonly rows: number
}

/** 单个终端的 tap 记录：句柄、重放缓冲与实时订阅者。 */
export interface TapEntry {
  /** 上游 subprocess 句柄（write/resize/terminate 经由它）。 */
  readonly handle: SubprocessTerminalHandle
  /** 有界重放缓冲（原始字节）。 */
  readonly ring: BoundedRing
  /** 实时帧订阅者；流式路由 attach/detach。 */
  readonly listeners: Set<(frame: TapFrame) => void>
  /** spawn 时的 PTY 几何（上游 spec 上报）。 */
  readonly size: TapSize
  /** 顶层进程是否已退出。 */
  exited: boolean
  /** 退出码；未知为 null。 */
  exitCode: number | null
}

/** tap 层向订阅者发出的帧（宿主内）；编码成 wire 帧见 shared。 */
export type TapFrame =
  | { readonly kind: 'data'; readonly bytes: Uint8Array }
  | { readonly kind: 'exit'; readonly exitCode: number | null }

/**
 * 有界字节环：保留最近 maxBytes 字节用于重连重放。
 * 超限时丢弃最旧数据（终端重放允许截断头部）。
 */
export class BoundedRing {
  private chunks: Uint8Array[] = []
  private bytes = 0

  constructor(readonly maxBytes: number = RING_MAX_BYTES) {}

  /** 追加一段输出；超过容量时从头丢弃旧块。 */
  append(chunk: Uint8Array): void {
    if (chunk.length === 0) return
    this.chunks.push(chunk)
    this.bytes += chunk.length
    while (this.bytes > this.maxBytes && this.chunks.length > 1) {
      const dropped = this.chunks.shift()
      if (dropped === undefined) break
      this.bytes -= dropped.length
    }
    // 单块超限时按尾截断（极端大输出块不撑爆内存）。
    if (this.bytes > this.maxBytes) {
      const last = this.chunks[0]
      if (last === undefined) {
        this.chunks = []
        this.bytes = 0
        return
      }
      const keep = last.subarray(last.length - this.maxBytes)
      this.chunks = [Uint8Array.from(keep)]
      this.bytes = keep.length
    }
  }

  /** 当前缓冲的总字节数。 */
  size(): number {
    return this.bytes
  }

  /** 合并为一份连续副本；空缓冲返回空数组。 */
  snapshot(): Uint8Array {
    if (this.chunks.length === 0) return new Uint8Array(0)
    const first = this.chunks[0]
    if (first === undefined) return new Uint8Array(0)
    if (this.chunks.length === 1) return Uint8Array.from(first)
    const merged = new Uint8Array(this.bytes)
    let offset = 0
    for (const chunk of this.chunks) {
      merged.set(chunk, offset)
      offset += chunk.length
    }
    return merged
  }

  /**
   * 把缓冲裁剪为最后一次出现的 marker 及其后内容；没找到保持原样。
   * @param marker - 要定位的字节序列（受控提示符）。
   * @returns 是否找到并裁剪。
   */
  trimToTail(marker: Uint8Array): boolean {
    if (marker.length === 0 || this.bytes < marker.length) return false
    const hay = this.snapshot()
    let found = -1
    for (let start = hay.length - marker.length; start >= 0 && found < 0; start -= 1) {
      let matched = true
      for (let index = 0; index < marker.length; index += 1) {
        if (hay[start + index] !== marker[index]) {
          matched = false
          break
        }
      }
      if (matched) found = start
    }
    if (found < 0) return false
    const keep = hay.subarray(found)
    this.chunks = [Uint8Array.from(keep)]
    this.bytes = keep.length
    return true
  }
}

/** sessionId → tap 记录。生命周期：spawn 登记，registry close（用户/模型关闭）移除。 */
export class TerminalTapRegistry {
  private readonly entries = new Map<string, TapEntry>()

  /** 登记 spawn 出的句柄与 spawn 几何；同 id 重复登记以最新为准。 */
  bind(sessionId: string, handle: SubprocessTerminalHandle, size: TapSize): TapEntry {
    const previous = this.entries.get(sessionId)
    if (previous !== undefined) this.detach(previous)
    const entry: TapEntry = {
      handle,
      ring: new BoundedRing(),
      listeners: new Set(),
      size,
      exited: false,
      exitCode: null,
    }
    this.entries.set(sessionId, entry)
    // Readable 的 'data' listener 让流进入 flowing 模式；上游 session 已挂自己的
    // listener，这里追加即广播，不改变上游消费。exit 后保留 entry 供重放 exit 帧。
    handle.output.on('data', (chunk: Buffer) => {
      const bytes = new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)
      entry.ring.append(bytes)
      for (const listener of entry.listeners) listener({ kind: 'data', bytes })
    })
    void handle.done.then(
      (outcome) => {
        entry.exited = true
        entry.exitCode = outcome.exitCode
        for (const listener of entry.listeners) listener({ kind: 'exit', exitCode: entry.exitCode })
        return undefined
      },
      () => {
        entry.exited = true
        entry.exitCode = null
        for (const listener of entry.listeners) listener({ kind: 'exit', exitCode: null })
        return undefined
      },
    )
    return entry
  }

  /** 取一个终端的 tap 记录；未登记或已移除返回 undefined。 */
  entryOf(sessionId: string): TapEntry | undefined {
    return this.entries.get(sessionId)
  }

  /**
   * 标记启动完成：重放缓冲裁到最后一次受控提示符处，启动期回显（pwsh 编码 preamble +
   * prompt 安装命令）不再进入 tab 重放画面。时机在 backend spawn 完成（就绪探测已过、
   * 提示符已印出）之后；此后的实时帧与已开始的流不受影响。启动失败不调用，报错仍可见。
   */
  markReady(sessionId: string, promptMarker: Uint8Array): void {
    this.entries.get(sessionId)?.ring.trimToTail(promptMarker)
  }

  /** 移除记录并断开全部订阅者（registry close 后浏览器流自然收到断开）。 */
  remove(sessionId: string): void {
    const entry = this.entries.get(sessionId)
    if (entry === undefined) return
    this.entries.delete(sessionId)
    this.detach(entry)
  }

  /** 插件卸载时清空全部登记。 */
  clear(): void {
    for (const sessionId of this.entries.keys()) this.remove(sessionId)
  }

  private detach(entry: TapEntry): void {
    entry.listeners.clear()
  }
}

/** Attach 一个实时订阅者；返回解绑函数。重放（ring + exit 状态）由调用方路由负责。 */
export function subscribeTap(entry: TapEntry, listener: (frame: TapFrame) => void): () => void {
  entry.listeners.add(listener)
  return () => { entry.listeners.delete(listener) }
}
