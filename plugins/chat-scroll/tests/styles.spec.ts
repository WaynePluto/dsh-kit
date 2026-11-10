import { describe, expect, it, vi } from 'vitest'
import {
  DIVIDER_STYLE_MARKER, dividerHighlightStylesheet, locatorStylesheet, showDividerHighlight,
} from '../src/client/styles.js'

describe('chat-scroll styles', () => {
  it('keeps the button and flash names private and theme-aware', () => {
    const css = locatorStylesheet()
    expect(css).toContain('.dshx-chat-scroll-action')
    expect(css).toContain('.dshx-chat-scroll-flash')
    expect(css).toContain('[data-chat-flow]::after')
    expect(css).toContain('--dshx-chat-scroll-cushion')
    expect(css).toContain('--dsw-alias-state-business-primary')
    expect(css).toContain('@keyframes dshx-chat-scroll-flash')
    expect(css).toContain('prefers-reduced-motion')
  })

  it('targets one turn\'s native divider by dsh attributes without touching its DOM', () => {
    const css = dividerHighlightStylesheet('12')
    // 只按 dsh 自身 data 属性选择头部按钮，不写任何 class/属性进 React 节点
    expect(css).toContain('[data-chat-flow-kind="turn-process"] button[data-turn-process="12"]')
    expect(css).toContain('border-bottom-color: var(--dsw-alias-state-business-primary')
    expect(css).toContain('animation: dshx-chat-scroll-flash 720ms ease-out both')
    expect(css).toContain('prefers-reduced-motion')
    expect(css).toContain('animation-duration: 240ms')
    expect(css).not.toContain('!important')
  })

  it('installs and removes the divider highlight rule through a plugin style element', () => {
    const element = {
      attributes: new Map<string, string>(),
      textContent: null as string | null,
      remove: vi.fn(),
      setAttribute(name: string, value: string) { this.attributes.set(name, value) },
    }
    const head = { append: vi.fn() }
    const host = {
      createElement: () => element,
      head,
    }
    const cleanup = showDividerHighlight(host as never, '5')
    expect(head.append).toHaveBeenCalledExactlyOnceWith(element)
    expect(element.attributes.get(DIVIDER_STYLE_MARKER)).toBe('')
    expect(element.textContent).toContain('[data-turn-process="5"]')
    cleanup()
    expect(element.remove).toHaveBeenCalledTimes(1)
  })
})
