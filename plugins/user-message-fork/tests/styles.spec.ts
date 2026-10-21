import { describe, expect, it } from 'vitest'
import { installUserMessageForkStyles, userMessageForkStyles } from '../src/client/styles.js'

describe('user-message-fork styles', () => {
  it('keeps the fork chrome namespaced without re-capping the official stack width', () => {
    const css = userMessageForkStyles()
    expect(css).toContain('.dshx-user-message-fork-action')
    expect(css).toContain('align-items: center')
    expect(css).toContain('line-height: 0')
    // 官方 UserContent 根节点 .userStack 自带整行宽下的宽度上限；插件行内若再包一层
    // 同上限 wrapper，内层百分比会改对已收缩到内容宽的父级解析，短消息被折行。
    expect(css).not.toContain('dshx-user-message-fork-user-stack')
    const rowRule = css.match(/\.dshx-user-message-fork-user-row\s*\{([^}]*)\}/)
    expect(rowRule).not.toBeNull()
    expect(rowRule?.[1]).not.toContain('max-width')
  })

  it('removes its stylesheet on dispose', () => {
    let removed = false
    const element = {
      textContent: null as string | null,
      setAttribute: () => {},
      remove: () => { removed = true },
    }
    const host = {
      createElement: () => element,
      head: { append: () => {} },
    }
    const dispose = installUserMessageForkStyles(host)
    dispose()
    expect(removed).toBe(true)
  })
})
