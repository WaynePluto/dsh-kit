import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const styles = readFileSync(new URL('../src/client/terminal-tab.styles.ts', import.meta.url), 'utf8')
const component = readFileSync(new URL('../src/client/TerminalTab.tsx', import.meta.url), 'utf8')
const entry = readFileSync(new URL('../src/client/index.tsx', import.meta.url), 'utf8')

describe('sidebar tab body theme contract', () => {
  it('sizes the tab root for the dockkit paneBody (not a flex child)', () => {
    expect(styles).toContain('height: \'100%\'')
    expect(styles).toContain('minHeight: 0')
    expect(styles).not.toContain('height: \'0\'')
  })

  it('embeds the official xterm.css with a scoped viewport override', () => {
    expect(styles).toContain('XTERM_CSS')
    expect(styles).toContain('.xterm .xterm-helper-textarea')
    // viewport 的黑底默认必须被容器作用域规则覆盖，底色由 theme.background 提供。
    expect(styles).toContain("background-color: transparent !important")
    expect(styles).toContain('dshx-term')
  })

  it('stays on the current dsw alias token layer', () => {
    expect(styles).not.toContain('--dsh-alias')
    expect(styles).toContain('--dsw-alias-bg-base')
    expect(styles).toContain('--dsw-alias-label-primary')
    expect(styles).toContain('--dsw-alias-state-error-primary')
  })
})

describe('xterm terminal contract', () => {
  it('keeps the terminal data path on the streaming route and masked input gone', () => {
    expect(component).toContain('STREAM_PATH')
    expect(component).toContain('decodeStreamFrame')
    // 键盘直写：不再有密码遮罩表单（回显语义归程序管）。
    expect(component).not.toContain('type="password"')
    expect(component).toContain('onWrite')
  })

  it('installs styles once at plugin apply, not per body render', () => {
    expect(entry).toContain('installTerminalStyles')
    expect(entry).toContain('XTERM_CSS')
  })

  it('follows the dsh theme for the terminal base colors', () => {
    const theme = readFileSync(new URL('../src/client/terminal-theme.ts', import.meta.url), 'utf8')
    expect(theme).toContain('--dsw-alias-bg-base')
    expect(theme).toContain('--dsw-alias-label-primary')
    // 16 色 ANSI 色板不覆盖：输出彩色来自 xterm 内置经典色板。
    expect(theme).not.toContain('ansi')
  })
})
