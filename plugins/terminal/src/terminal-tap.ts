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
  /** PTY 当前几何：spawn 时由上游 spec 上报，此后随 resize 端点前移（size 帧契约）。 */
  size: TapSize
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

/**
 * 浏览器侧流量的「终端查询」剥离器：丢弃 CSI 6 n（DSR 光标查询）与 CSI … c
 * （DA/DA2/DA3 请求）两种字节序列，其余原样放行（含跨 chunk 的不完整序列与
 * OSC/DCS 字符串态——字符串负载里的 ESC 不会被误判成新序列）。
 *
 * 背景（真实栈字节捕获实证）：pwsh/conhost 会向终端发这些查询并按行读回应答；上游
 * 会话的 headless 模拟器从自己的 output listener 看到原始流并应答（1:1，宿主内闭环）。
 * 浏览器 xterm 收到查询也会自动应答（onData → write 端点），形成第二份应答写入 PTY
 * 输入——pwsh 的按行读取把多余的应答当正文、并吞掉随后的回车，命令文本残留输入行
 * （「幽灵输入」：直接回车显示 Clear-Host、命令执行后被自动重输一次）。tap 在 ring
 * 与实时帧进浏览器之前剥掉查询字节；上游模拟器不经 tap，应答通道不受影响。
 */
export class TerminalQueryStripper {
  /** CSI 参数区最长保持字节数；超过按非查询放行（防御性，避免异常流挂死）。 */
  private static readonly MAX_CSI = 16

  private state: 'normal' | 'esc' | 'csi' | 'string' | 'string-esc' = 'normal'
  private carry: number[] = []

  /**
   * 喂入一段原始输出字节；返回过滤后的字节（整段都是挂起中的序列时为空）。
   * @param chunk - PTY 原始输出。
   * @returns 剥掉查询后的字节；挂起的不完整序列留待下一段判定。
   */
  feed(chunk: Uint8Array): Uint8Array {
    const out: number[] = []
    for (const byte of chunk) {
      if (this.state === 'normal') {
        if (byte === 0x1b) { this.carry = [byte]; this.state = 'esc'; continue }
        out.push(byte)
        continue
      }
      if (this.state === 'esc') {
        if (byte === 0x5b) { this.carry.push(byte); this.state = 'csi'; continue }
        // OSC/DCS/APC/PM 字符串 opener：整对放行后进入字符串态，负载原样透传直到终止符。
        if (byte === 0x5d || byte === 0x50 || byte === 0x58 || byte === 0x5e || byte === 0x5f) {
          out.push(this.carry[0]!, byte)
          this.carry = []
          this.state = 'string'
          continue
        }
        // 其它 ESC 序列（SS3、字符集、单字符转义…）：整对放行。
        out.push(this.carry[0]!, byte)
        this.carry = []
        this.state = 'normal'
        continue
      }
      if (this.state === 'string') {
        if (byte === 0x07) { out.push(byte); this.state = 'normal'; continue }
        if (byte === 0x1b) { this.state = 'string-esc'; continue }
        out.push(byte)
        continue
      }
      if (this.state === 'string-esc') {
        out.push(0x1b, byte)
        // ESC \ 是字符串终止符（ST）；其余 ESC x 视为字符串内的字节，留在字符串态。
        this.state = byte === 0x5c ? 'normal' : 'string'
        continue
      }
      // csi：参数/私标字节累积，终止字节按查询或整段放行。
      if (byte >= 0x30 && byte <= 0x3f) {
        this.carry.push(byte)
        if (this.carry.length <= TerminalQueryStripper.MAX_CSI) continue
        out.push(...this.carry)
        this.carry = []
        this.state = 'normal'
        continue
      }
      const sequence = String.fromCharCode(...this.carry, byte)
      this.carry = []
      this.state = 'normal'
      // 查询形态：DSR 光标（ESC[6n）与 DA 族（ESC[…c，参数区允许 ? > = 私标）。正则不写
      // ESC 字面控制字符（lint 禁止），先按前后缀截出参数区再校验。
      const isQuery = sequence === '\x1b[6n'
        || (sequence.startsWith('\x1b[') && sequence.endsWith('c')
          && /^[?>=]?[0-9;]*$/u.test(sequence.slice(2, -1)))
      if (isQuery) continue
      out.push(...Array.from(sequence, char => char.charCodeAt(0)))
    }
    return Uint8Array.from(out)
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
    // listener（原始流，不经 stripper——它要替 pwsh 应答查询），这里追加即广播，不改变
    // 上游消费。exit 后保留 entry 供重放 exit 帧。
    const stripper = new TerminalQueryStripper()
    handle.output.on('data', (chunk: Buffer) => {
      const bytes = stripper.feed(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength))
      if (bytes.length === 0) return
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
   * 前移一个终端的当前几何。resize 端点在 `handle.resize` 成功后调用；size 帧
   * （重连重放的建画面几何）从这里读，停留 spawn 值会让重放在过期几何上错位。
   */
  setGeometry(sessionId: string, size: TapSize): void {
    const entry = this.entries.get(sessionId)
    if (entry !== undefined) entry.size = { cols: size.cols, rows: size.rows }
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
