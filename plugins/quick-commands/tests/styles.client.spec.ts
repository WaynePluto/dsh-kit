import { describe, expect, it } from 'vitest'
import { classes, stylesheet } from '../src/client/styles.js'

describe('button toggle-state contract', () => {
  const button = `.${classes.button}`

  it('关闭态透明底 + 次级图标色（不能常驻灰底，否则看不出开关状态）', () => {
    const rule = new RegExp(`${button.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{[^}]*\\}`)
    const match = stylesheet.match(rule)
    expect(match).not.toBeNull()
    expect(match?.[0]).toContain('background: transparent')
    expect(match?.[0]).toContain('color: var(--dsw-alias-label-secondary)')
  })

  it('打开态（aria-expanded=true）换 specific-selector 灰底 + 主色图标', () => {
    expect(stylesheet).toContain(`${button}[aria-expanded='true'] {`)
    expect(stylesheet).toContain('background: var(--dsw-specific-selector)')
    expect(stylesheet).toMatch(new RegExp(`\\[aria-expanded='true'\\] \\{[^}]*color: var\\(--dsw-alias-label-primary\\)`, 's'))
  })

  it('两种状态各有 hover 反馈', () => {
    expect(stylesheet).toContain(`${button}:hover:not(:disabled)`)
    expect(stylesheet).toContain(`${button}[aria-expanded='true']:hover:not(:disabled)`)
    expect(stylesheet).toContain('background: var(--dsw-alias-interactive-bg-hover)')
    expect(stylesheet).toContain('background: var(--dsw-alias-interactive-bg-hover-solid)')
  })

  it('几何契约保持 .add 形态：28×28 圆形', () => {
    const rule = new RegExp(`${button.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{[^}]*\\}`)
    const match = stylesheet.match(rule)
    expect(match?.[0]).toContain('width: 28px')
    expect(match?.[0]).toContain('height: 28px')
    expect(match?.[0]).toContain('border-radius: 999px')
  })
})
