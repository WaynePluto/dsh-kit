/**
 * 交互终端 sidebar tab 的样式：容器布局、xterm.css 内嵌、主题覆盖、退出覆盖层与确认条。
 *
 * xterm 需要其官方 css（类名不可改）；插件产物是单文件 JS，没有独立 css chunk，
 * 因此把官方 xterm.css 原文内嵌进 <style> 注入（@xterm/xterm 6.0.0，MIT），
 * 再用容器作用域覆盖 viewport 的黑底默认，让底色跟随 dsh 主题。
 */

import type { CSSProperties } from 'react'

import { MONO as TERM_MONO, SECONDARY as DOCK_SECONDARY } from '@dsh-kit/plugin-ui'

export { MONO } from '@dsh-kit/plugin-ui'

/** tab body 根节点：占满 pane 高度（dockkit paneBody 经 display:contents 放入，不是 flex 容器）。 */
export const rootStyle: CSSProperties = {
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  minHeight: 0,
  padding: '8px',
  boxSizing: 'border-box',
  minWidth: 0,
  fontSize: '13px',
  lineHeight: 1.5,
}

/** xterm 挂载容器：占满剩余空间；ResizeObserver 在它身上量宽。 */
export const containerStyle: CSSProperties = {
  flex: '1 1 0%',
  minHeight: 0,
  minWidth: 0,
  position: 'relative',
}

/** 覆盖层（退出态 / 错误态）：盖在终端上方的一块说明。 */
export const overlayStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '8px',
  background: 'var(--dsw-alias-bg-base, inherit)',
  color: 'var(--dsw-alias-label-secondary, inherit)',
  zIndex: 3,
  padding: '0 16px',
  textAlign: 'center',
}

/** 覆盖层主文案。 */
export const overlayTitleStyle: CSSProperties = {
  fontWeight: 500,
  color: 'var(--dsw-alias-label-primary, inherit)',
}

/** 覆盖层错误文案。 */
export const overlayErrorStyle: CSSProperties = {
  color: 'var(--dsw-alias-state-error-primary, #dc2626)',
  overflowWrap: 'anywhere',
}

/** 连接/加载提示行。 */
export const statusStyle: CSSProperties = {
  position: 'absolute',
  top: '8px',
  left: '12px',
  right: '12px',
  display: 'flex',
  justifyContent: 'center',
  pointerEvents: 'none',
  zIndex: 2,
}

/** 提示行文字。 */
export const statusTextStyle: CSSProperties = {
  background: 'var(--dsw-specific-tip, rgba(128,128,128,0.1))',
  border: '0.5px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.3))',
  borderRadius: '12px',
  padding: '2px 10px',
  fontSize: '12px',
  color: DOCK_SECONDARY,
}

/** 关闭确认条：第一次点 chip × 后出现。 */
export const confirmStyle: CSSProperties = {
  position: 'absolute',
  left: '8px',
  right: '8px',
  bottom: '8px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '8px',
  padding: '6px 10px',
  borderRadius: '8px',
  border: '0.5px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.3))',
  background: 'var(--dsw-specific-tip, rgba(128,128,128,0.1))',
  zIndex: 4,
  fontSize: '12px',
  color: 'var(--dsw-alias-label-primary, inherit)',
}

/** 确认条内的「直接关闭」按钮。 */
export const confirmKillStyle: CSSProperties = {
  font: 'inherit',
  fontSize: '12px',
  padding: '2px 10px',
  borderRadius: '8px',
  border: '0.5px solid var(--dsw-alias-border-l3, rgba(128,128,128,0.4))',
  background: 'transparent',
  color: 'var(--dsw-alias-state-error-primary, #dc2626)',
  cursor: 'pointer',
}

/**
 * 官方 xterm.css 原文（@xterm/xterm 6.0.0，MIT，版权声明见文件头；此处省略注释块）。
 * 类名是 xterm DOM 的内部契约，不可改名；viewport 黑底用下方容器作用域规则覆盖。
 */
export const XTERM_CSS = `
.xterm { cursor: text; position: relative; user-select: none; -ms-user-select: none; -webkit-user-select: none; }
.xterm.focus, .xterm:focus { outline: none; }
.xterm .xterm-helpers { position: absolute; top: 0; z-index: 5; }
.xterm .xterm-helper-textarea {
  padding: 0; border: 0; margin: 0; position: absolute; opacity: 0; left: -9999em; top: 0;
  width: 0; height: 0; z-index: -5; white-space: nowrap; overflow: hidden; resize: none;
}
.xterm .composition-view { background: #000; color: #fff; display: none; position: absolute; white-space: nowrap; z-index: 1; }
.xterm .composition-view.active { display: block; }
.xterm .xterm-viewport {
  background-color: #000; overflow-y: scroll; cursor: default;
  position: absolute; right: 0; left: 0; top: 0; bottom: 0;
}
.xterm .xterm-screen { position: relative; }
.xterm .xterm-screen canvas { position: absolute; left: 0; top: 0; }
.xterm-char-measure-element { display: inline-block; visibility: hidden; position: absolute; top: 0; left: -9999em; line-height: normal; }
.xterm.enable-mouse-events { cursor: default; }
.xterm.xterm-cursor-pointer, .xterm .xterm-cursor-pointer { cursor: pointer; }
.xterm.column-select.focus { cursor: crosshair; }
.xterm .xterm-accessibility:not(.debug), .xterm .xterm-message {
  position: absolute; left: 0; top: 0; bottom: 0; right: 0; z-index: 10; color: transparent; pointer-events: none;
}
.xterm .xterm-accessibility-tree:not(.debug) *::selection { color: transparent; }
.xterm .xterm-accessibility-tree { font-family: monospace; user-select: text; white-space: pre; }
.xterm .xterm-accessibility-tree > div { transform-origin: left; width: fit-content; }
.xterm .live-region { position: absolute; left: -9999px; width: 1px; height: 1px; overflow: hidden; }
.xterm-dim { opacity: 1 !important; }
.xterm-underline-1 { text-decoration: underline; }
.xterm-underline-2 { text-decoration: double underline; }
.xterm-underline-3 { text-decoration: wavy underline; }
.xterm-underline-4 { text-decoration: dotted underline; }
.xterm-underline-5 { text-decoration: dashed underline; }
.xterm-overline { text-decoration: overline; }
.xterm-overline.xterm-underline-1 { text-decoration: overline underline; }
.xterm-overline.xterm-underline-2 { text-decoration: overline double underline; }
.xterm-overline.xterm-underline-3 { text-decoration: overline wavy underline; }
.xterm-overline.xterm-underline-4 { text-decoration: overline dotted underline; }
.xterm-overline.xterm-underline-5 { text-decoration: overline dashed underline; }
.xterm-strikethrough { text-decoration: line-through; }
.xterm-screen .xterm-decoration-container .xterm-decoration { z-index: 6; position: absolute; }
.xterm-screen .xterm-decoration-container .xterm-decoration.xterm-decoration-top-layer { z-index: 7; }
.xterm-decoration-overview-ruler { z-index: 8; position: absolute; top: 0; right: 0; pointer-events: none; }
.xterm-decoration-top { z-index: 2; position: relative; }
.xterm .xterm-scrollable-element > .scrollbar { cursor: default; }
.xterm .xterm-scrollable-element > .scrollbar > .scra { cursor: pointer; font-size: 11px !important; }
.xterm .xterm-scrollable-element > .visible {
  opacity: 1; background: rgba(0,0,0,0); transition: opacity 100ms linear; z-index: 11;
}
.xterm .xterm-scrollable-element > .invisible { opacity: 0; pointer-events: none; }
.xterm .xterm-scrollable-element > .invisible.fade { transition: opacity 800ms linear; }
.xterm .xterm-scrollable-element > .shadow { position: absolute; display: none; }
.xterm .xterm-scrollable-element > .shadow.top { display: block; top: 0; left: 3px; height: 3px; width: 100%; box-shadow: var(--vscode-scrollbar-shadow, #000) 0 6px 6px -6px inset; }
.xterm .xterm-scrollable-element > .shadow.left { display: block; top: 3px; left: 0; height: 100%; width: 3px; box-shadow: var(--vscode-scrollbar-shadow, #000) 6px 0 6px -6px inset; }
.xterm .xterm-scrollable-element > .shadow.top-left-corner { display: block; top: 0; left: 0; height: 3px; width: 3px; }
.xterm .xterm-scrollable-element > .shadow.top.left { box-shadow: var(--vscode-scrollbar-shadow, #000) 6px 0 6px -6px inset; }
`

/** 确认弹窗的危险确认键（task-board confirmDanger 同款最低覆写）。 */
export const confirmDangerClass = 'dshx-terminal-confirmDanger'

/** 插件自有样式：容器作用域的主题覆盖（viewport 黑底 → 透明，屏幕底色由 theme.background 提供）。 */
export const TERMINAL_CSS = `
.${'dshx-term'} .xterm-viewport { background-color: transparent !important; }
.${'dshx-term'} .xterm { font-family: ${TERM_MONO}; }
`
