/** 样式契约测试：类名私有、复刻原生 StatsPills 的 pill token；只作防退化检查，不宣称验证了视觉。 */

import { describe, expect, it } from 'vitest'
import {
  ANCHOR_CLASS, LABEL_CLASS, PILL_CLASS, STYLE_MARKER, installPillStyles, pillStylesheet,
} from '../src/client/styles.js'

describe('session-workspace styles', () => {
  it('keeps class names namespaced and replicates the native pill contract', () => {
    const css = pillStylesheet()
    expect(ANCHOR_CLASS).toBe('dshx-session-workspace-anchor')
    expect(PILL_CLASS).toBe('dshx-session-workspace-pill')
    expect(LABEL_CLASS).toBe('dshx-session-workspace-label')
    expect(css).toContain(`.${ANCHOR_CLASS}`)
    expect(css).toContain(`.${PILL_CLASS}`)
    expect(css).toContain(`.${LABEL_CLASS}`)
    // 与原生 StatsPills 同一批 token（0.2.x 起别名层是 --dsw-alias-*，不是 --dsh-alias-*）。
    expect(css).toContain('--dsw-radius-sm')
    expect(css).toContain('--dsw-alias-label-tertiary')
    expect(css).toContain('--dsw-alias-interactive-bg-hover')
    expect(css).toContain('--dsh-content-font-size-secondary')
    expect(css).not.toContain('--dsh-alias-')
    // 图标不收缩、文字省略在内层 label，避免 flex 容器做不了 text-overflow 的坑。
    expect(css).toContain('flex: none')
    expect(css).toContain('text-overflow: ellipsis')
  })

  it('installs one marked style element and removes it on dispose', () => {
    const created: FakeStyle[] = []
    const dispose = installPillStyles({
      createElement: () => {
        const element = new FakeStyle()
        created.push(element)
        return element
      },
      head: { append: () => {} },
    })
    expect(created).toHaveLength(1)
    const [element] = created
    expect(element?.marker).toBe('')
    expect(element?.removed).toBe(false)
    dispose()
    expect(element?.removed).toBe(true)
  })

  it('is a no-op without a document host', () => {
    expect(installPillStyles(undefined)).toBeInstanceOf(Function)
  })
})

/** 最小样式元素替身，记录 marker 属性与移除状态。 */
class FakeStyle {
  marker: string | undefined
  removed = false
  textContent: string | null = null
  setAttribute(name: string, value: string): void {
    if (name === STYLE_MARKER) this.marker = value
  }
  remove(): void {
    this.removed = true
  }
}
