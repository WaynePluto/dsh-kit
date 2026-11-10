import { describe, expect, it } from 'vitest'
import {
  assistantMessageNodeKey, bottomCushionForTarget, dividerAdjacentToRow, dividerGeometry,
  dividerVisibleInScrollport, findAssistantMessageRow, findTurnDividerHost,
  messageReachedLanding, scrollTopForMessage,
} from '../src/client/locate.js'

/** 构造一个带 flow/node key 与可配置几何的助手行替身。 */
function makeRow(flowKey: string, nodeKey: string, height: number, hidden = false) {
  return {
    dataset: { chatFlowKey: flowKey, chatNodeKey: nodeKey },
    hidden,
    getBoundingClientRect: () => ({ top: 0, height }),
  } as unknown as HTMLElement
}

describe('chat-scroll locator math', () => {
  it('maps each finalized assistant message id to its own Chat Node', () => {
    const nodes = new Map([
      ['user-1', { kind: 'user' }],
      ['assistant-1', { kind: 'assistant-step', data: { finalNode: { messageId: 'msg-1' } } }],
      ['tool-1', { kind: 'tool-call' }],
      ['assistant-2', { kind: 'assistant-step', data: { finalNode: { messageId: 'msg-2' } } }],
      ['assistant-running', { kind: 'assistant-step', data: {} }],
    ])
    const snapshot = {
      order: ['user-1', 'assistant-1', 'tool-1', 'assistant-2', 'assistant-running'],
      nodes: { get: (key: string) => nodes.get(key) },
    }
    expect(assistantMessageNodeKey(snapshot, 'msg-1')).toBe('assistant-1')
    expect(assistantMessageNodeKey(snapshot, 'msg-2')).toBe('assistant-2')
    expect(assistantMessageNodeKey(snapshot, 'missing')).toBeNull()
  })

  it('traverses a snapshot once for repeated lookups from every message button', () => {
    const nodes = new Map([
      ['assistant-1', { kind: 'assistant-step', data: { finalNode: { messageId: 'msg-1' } } }],
      ['assistant-2', { kind: 'assistant-step', data: { finalNode: { messageId: 'msg-2' } } }],
    ])
    let reads = 0
    const snapshot = {
      order: ['assistant-1', 'assistant-2'],
      nodes: {
        get: (key: string) => {
          reads += 1
          return nodes.get(key)
        },
      },
    }
    expect(assistantMessageNodeKey(snapshot, 'msg-1')).toBe('assistant-1')
    const afterFirst = reads
    expect(assistantMessageNodeKey(snapshot, 'msg-2')).toBe('assistant-2')
    expect(assistantMessageNodeKey(snapshot, 'missing')).toBeNull()
    expect(reads).toBe(afterFirst)
  })

  it('places a message 26px below the scrollport top without negative scroll', () => {
    // 26px inset：约一行高度，顶部完整露出上一条消息的最后一行，不裁半个字
    expect(scrollTopForMessage(380, 920, 120)).toBe(1_154)
    expect(scrollTopForMessage(0, 10, 120)).toBe(0)
    expect(messageReachedLanding(146, 120)).toBe(true)
    expect(messageReachedLanding(149, 120)).toBe(false)
  })

  it('adds enough tail room when the browser would clamp a final-message landing', () => {
    expect(bottomCushionForTarget(508, 1_270, 942)).toBe(180)
    expect(bottomCushionForTarget(200, 1_270, 942)).toBe(0)
    expect(bottomCushionForTarget(50, 500, 942)).toBe(50)
  })

  it('clips the flash divider to the visible scrollport width', () => {
    expect(dividerGeometry(
      { left: 40, right: 980, top: 244 },
      { left: 16, right: 920 },
    )).toEqual({ left: 40, top: 244, width: 880 })
  })

  it('resolves the row from the caller-provided Chat flow only', () => {
    const row = makeRow('current-row', 'node-1', 40)
    const root = { querySelectorAll: () => [row] } as unknown as ParentNode
    expect(findAssistantMessageRow(root, 'current-row')).toBe(row)
    expect(findAssistantMessageRow(root, 'stale-row')).toBeNull()
  })

  it('skips folded-away leading parts and lands on the first measurable part of the message', () => {
    // 消息 msg-1 的首选行（snapshot key）是分组里的响应 part；它的首个 part
    // 被折叠（hidden），中间 part 零高（折叠过渡），不能按它们的零几何定位。
    const hiddenPart = makeRow('["node-1","process"]', 'node-1', 0, true)
    const zeroHeightPart = makeRow('["node-1","middle"]', 'node-1', 0)
    const responsePart = makeRow('node-1', 'node-1', 120)
    const nextMessage = makeRow('node-2', 'node-2', 300)
    const root = { querySelectorAll: () => [hiddenPart, zeroHeightPart, responsePart, nextMessage] } as unknown as ParentNode
    expect(findAssistantMessageRow(root, 'node-1')).toBe(responsePart)
    expect(findAssistantMessageRow(root, '["node-1","process"]')).toBe(responsePart)
  })

  it('waits instead of landing on zero geometry when every part of the message is folded', () => {
    const hiddenPart = makeRow('["node-1","process"]', 'node-1', 0, true)
    const responsePart = makeRow('node-1', 'node-1', 0)
    const nextMessage = makeRow('node-2', 'node-2', 300)
    const root = { querySelectorAll: () => [hiddenPart, responsePart, nextMessage] } as unknown as ParentNode
    expect(findAssistantMessageRow(root, 'node-1')).toBeNull()
    // 不会越过消息边界落到下一条消息的行上。
    expect(findAssistantMessageRow(root, 'node-1')).not.toBe(nextMessage)
  })

  it('finds the owning turn divider host through the ancestor flow levels', () => {
    // 行在过程组内容层内：从行父层逐级上溯，直到包含同 turn 头部按钮的 flow 层。
    const header = {
      hidden: false,
      getBoundingClientRect: () => ({ height: 33 }),
    } as unknown as HTMLElement
    const groupContent = {
      querySelector: () => null,
    }
    const column = {
      querySelector: (selector: string) => (
        selector.includes('[data-chat-flow-kind="turn-process"]')
        && selector.includes('[data-chat-turn="7"]')
        && selector.includes('button[data-turn-process]')
          ? header
          : null
      ),
    }
    const row = {
      dataset: { chatTurn: '7' },
      parentElement: groupContent,
    } as unknown as HTMLElement
    ;(groupContent as { parentElement?: unknown }).parentElement = column
    expect(findTurnDividerHost(row)).toBe(header)
  })

  it('rejects divider hosts without a turn, without a match, or without geometry', () => {
    const header = {
      hidden: false,
      getBoundingClientRect: () => ({ height: 33 }),
    } as unknown as HTMLElement
    const column = { querySelector: () => header }
    const noTurn = { dataset: {}, parentElement: column } as unknown as HTMLElement
    expect(findTurnDividerHost(noTurn)).toBeNull()
    // 祖先里没有同 turn 头部：一路上溯到 null 才放弃
    const unmatched = {
      dataset: { chatTurn: '9' },
      parentElement: { querySelector: () => null, parentElement: null },
    } as unknown as HTMLElement
    expect(findTurnDividerHost(unmatched)).toBeNull()
    // 头部自身不可测量（隐藏或零高）时不能当作锚点
    const zeroHeight = {
      hidden: false,
      getBoundingClientRect: () => ({ height: 0 }),
    } as unknown as HTMLElement
    const withZeroHost = {
      dataset: { chatTurn: '7' },
      parentElement: { querySelector: () => zeroHeight, parentElement: null },
    } as unknown as HTMLElement
    expect(findTurnDividerHost(withZeroHost)).toBeNull()
  })

  it('accepts the divider only when its hairline sits right above the row and on screen', () => {
    // 折叠组隐藏时隔 12px、无组时隔 16px，都在容差内；过程组展开远超容差。
    expect(dividerAdjacentToRow({ bottom: 44 }, { top: 60 })).toBe(true)
    expect(dividerAdjacentToRow({ bottom: 44 }, { top: 90 })).toBe(false)
    expect(dividerVisibleInScrollport({ bottom: 44 }, { top: 0 })).toBe(true)
    expect(dividerVisibleInScrollport({ bottom: -8 }, { top: 0 })).toBe(false)
  })
})
