/**
 * dsh 主题 token → xterm ITheme。
 *
 * 底座四色（背景/前景/光标/选区）跟随 dsh 主题（深浅自动切换），16 色 ANSI 色板
 * 不设置——用 xterm 内置经典色板，程序输出的彩色（ANSI SGR）原样呈现。
 * 主题切换由插件在 `theme/change` 时重新应用（见 index.tsx 的装配）。
 */

import type { ITheme } from '@xterm/xterm'

/** 从 body 计算样式读一个 CSS 变量；空值返回 undefined（xterm 用内置默认）。 */
function token(name: string): string | undefined {
  if (typeof window === 'undefined') return undefined
  const value = getComputedStyle(document.body).getPropertyValue(name).trim()
  return value.length > 0 ? value : undefined
}

/**
 * 解析当前 dsh 主题下的 xterm 主题。
 * @returns xterm 主题对象（只含底座四色；其余字段留内置默认）。
 */
export function resolveTerminalTheme(): ITheme {
  const background = token('--dsw-alias-bg-base')
  const foreground = token('--dsw-alias-label-primary')
  const theme: ITheme = {}
  if (background !== undefined) {
    theme.background = background
    theme.cursorAccent = background
  }
  if (foreground !== undefined) {
    theme.foreground = foreground
    theme.cursor = foreground
    theme.selectionBackground = foreground
  }
  return theme
}

/** xterm 实例的通用选项（与主题无关的部分）。 */
export interface TerminalOptionsInput {
  /** 等宽字体栈。 */
  mono: string
}

/**
 * 组装 xterm 构造选项。
 * @param input - 字体等环境值。
 * @returns xterm 选项。
 */
export function terminalOptions(input: TerminalOptionsInput): {
  fontFamily: string
  fontSize: number
  scrollback: number
  theme: ITheme
  convertEol: false
} {
  return {
    fontFamily: input.mono,
    fontSize: 13,
    scrollback: 2000,
    theme: resolveTerminalTheme(),
    convertEol: false,
  }
}
