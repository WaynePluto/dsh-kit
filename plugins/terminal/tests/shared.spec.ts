/** 传输契约：kit 通道、端点、流式帧协议与 payload 守卫。 */

import { describe, expect, it } from 'vitest'
import {
  CHANNEL, ENDPOINTS, MAX_COLS, MAX_ROWS, SELF_NAMESPACE, STREAM_PATH,
  decodeStreamFrame, encodeStreamFrame, isCloseRequest, isListRequest, isResizeRequest,
  isStreamAttachRequest, isTerminalEndpoint, isWriteRequest,
} from '../src/shared.js'

describe('channel identity', () => {
  it('derives the channel from the package suffix', () => {
    expect(SELF_NAMESPACE).toBe('dsh-plugin-terminal')
    expect(CHANNEL).toBe('/terminal')
    expect(STREAM_PATH).toBe('/terminal/stream')
  })

  it('serves list/spawn/write/resize/close and nothing else', () => {
    expect([...ENDPOINTS]).toStrictEqual(['list', 'spawn', 'write', 'resize', 'close'])
    // 创建与杀进程都经由通道（guide 入口与用户关闭），但模型侧 read/send 语义不进页面通道。
    expect(isTerminalEndpoint('read')).toBe(false)
    expect(isTerminalEndpoint('send')).toBe(false)
    expect(isTerminalEndpoint('interrupt')).toBe(false)
    expect(isTerminalEndpoint('open')).toBe(false)
    expect(isTerminalEndpoint('list')).toBe(true)
    expect(isTerminalEndpoint('spawn')).toBe(true)
    expect(isTerminalEndpoint('write')).toBe(true)
    expect(isTerminalEndpoint('resize')).toBe(true)
    expect(isTerminalEndpoint('close')).toBe(true)
  })
})

describe('payload guards', () => {
  it('requires a non-empty sessionId for list', () => {
    expect(isListRequest({ sessionId: 's1' })).toBe(true)
    expect(isListRequest({ sessionId: '' })).toBe(false)
    expect(isListRequest({})).toBe(false)
    expect(isListRequest(undefined)).toBe(false)
  })

  it('requires session and terminal ids for stream attach', () => {
    expect(isStreamAttachRequest({ sessionId: 's1', terminalId: 'pty-1' })).toBe(true)
    expect(isStreamAttachRequest({ sessionId: 's1' })).toBe(false)
    expect(isStreamAttachRequest({ terminalId: 'pty-1' })).toBe(false)
  })

  it('requires terminalId and non-empty data for write', () => {
    expect(isWriteRequest({ sessionId: 's1', terminalId: 'pty-1', data: 'ls\r' })).toBe(true)
    expect(isWriteRequest({ sessionId: 's1', terminalId: 'pty-1', data: '' })).toBe(false)
    expect(isWriteRequest({ sessionId: 's1', terminalId: 'pty-1' })).toBe(false)
    expect(isWriteRequest({ sessionId: 's1', data: 'x' })).toBe(false)
  })

  it('bounds resize to the documented grid', () => {
    expect(isResizeRequest({ sessionId: 's1', terminalId: 'p', cols: 80, rows: 24 })).toBe(true)
    expect(isResizeRequest({ sessionId: 's1', terminalId: 'p', cols: MAX_COLS, rows: MAX_ROWS })).toBe(true)
    expect(isResizeRequest({ sessionId: 's1', terminalId: 'p', cols: 1, rows: 24 })).toBe(false)
    expect(isResizeRequest({ sessionId: 's1', terminalId: 'p', cols: MAX_COLS + 1, rows: 24 })).toBe(false)
    expect(isResizeRequest({ sessionId: 's1', terminalId: 'p', cols: 80, rows: 0 })).toBe(false)
    expect(isResizeRequest({ sessionId: 's1', terminalId: 'p', cols: 80.5, rows: 24 })).toBe(false)
  })

  it('requires terminalId for close', () => {
    expect(isCloseRequest({ sessionId: 's1', terminalId: 'pty-1' })).toBe(true)
    expect(isCloseRequest({ sessionId: 's1' })).toBe(false)
  })
})

describe('stream frames', () => {
  it('round-trips ring/data/exit frames as ndjson lines', () => {
    const ring = encodeStreamFrame({ t: 'ring', b64: 'SGVsbG8=' })
    expect(ring.endsWith('\n')).toBe(true)
    expect(decodeStreamFrame(ring.trimEnd())).toStrictEqual({ t: 'ring', b64: 'SGVsbG8=' })
    expect(decodeStreamFrame(encodeStreamFrame({ t: 'data', b64: '' }))).toStrictEqual({ t: 'data', b64: '' })
    expect(decodeStreamFrame(encodeStreamFrame({ t: 'exit', code: 0 }))).toStrictEqual({ t: 'exit', code: 0 })
    expect(decodeStreamFrame(encodeStreamFrame({ t: 'exit', code: null }))).toStrictEqual({ t: 'exit', code: null })
  })

  it('carries the platform semantic on size frames', () => {
    expect(decodeStreamFrame(encodeStreamFrame({ t: 'size', cols: 160, rows: 40, platform: 'windows' })))
      .toStrictEqual({ t: 'size', cols: 160, rows: 40, platform: 'windows' })
    expect(decodeStreamFrame(encodeStreamFrame({ t: 'size', cols: 160, rows: 40, platform: 'posix' })))
      .toStrictEqual({ t: 'size', cols: 160, rows: 40, platform: 'posix' })
    // 旧宿主没有 platform 字段（或值不认识）时按 POSIX 兜底（不清屏），几何坏值拒帧。
    expect(decodeStreamFrame('{"t":"size","cols":160,"rows":40}'))
      .toStrictEqual({ t: 'size', cols: 160, rows: 40, platform: 'posix' })
    expect(decodeStreamFrame('{"t":"size","cols":160,"rows":40,"platform":"win32"}'))
      .toStrictEqual({ t: 'size', cols: 160, rows: 40, platform: 'posix' })
    expect(decodeStreamFrame('{"t":"size","cols":1,"rows":40,"platform":"windows"}')).toBeUndefined()
  })

  it('tolerates garbage lines without throwing', () => {
    expect(decodeStreamFrame('')).toBeUndefined()
    expect(decodeStreamFrame('not json')).toBeUndefined()
    expect(decodeStreamFrame('{"t":"weird"}')).toBeUndefined()
    expect(decodeStreamFrame('{"t":"data"}')).toBeUndefined()
    expect(decodeStreamFrame('{"t":"exit","code":"7"}')).toBeUndefined()
    expect(decodeStreamFrame('null')).toBeUndefined()
  })
})
