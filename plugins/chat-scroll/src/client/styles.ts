/** 样式表是全局的，因此类名刻意使用命名空间。 */
export const ACTION_CLASS = 'dshx-chat-scroll-action'
export const FLASH_CLASS = 'dshx-chat-scroll-flash'
export const STYLE_MARKER = 'data-dsh-plugin-chat-scroll'
export const CUSHION_PROPERTY = '--dshx-chat-scroll-cushion'

/** 界面契约：此处说明布局、主题 token、尺寸或 DOM 接缝。 */
export function locatorStylesheet(): string {
  return `
.${ACTION_CLASS} {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: calc(28px + var(--dsh-content-font-delta, 0px));
  height: calc(28px + var(--dsh-content-font-delta, 0px));
  padding: 6px;
  border: none;
  border-radius: 28px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary, #6b7280);
  cursor: pointer;
  line-height: 0;
}

.${ACTION_CLASS} svg {
  width: calc(15px + var(--dsh-content-font-delta, 0px));
  height: calc(15px + var(--dsh-content-font-delta, 0px));
}

.${ACTION_CLASS}:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, 0.12));
  color: var(--dsw-alias-label-secondary, #6b7280);
}

.${ACTION_CLASS}:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, #3964fe);
  outline-offset: 2px;
}

/** 本插件按钮、flash 分界线和 cushion 使用的全局 class/CSS。 */
[data-chat-flow]::after {
  content: '';
  display: block;
  flex: 0 0 var(${CUSHION_PROPERTY}, 0px);
  height: var(${CUSHION_PROPERTY}, 0px);
  pointer-events: none;
}

.${FLASH_CLASS} {
  position: fixed;
  z-index: 12;
  height: 2px;
  min-width: 1px;
  border-radius: 999px;
  pointer-events: none;
  background: var(--dsw-alias-state-business-primary, #3964fe);
  box-shadow: 0 0 8px rgba(57, 100, 254, 0.48);
  opacity: 0;
  transform: scaleX(0.25);
  transform-origin: center;
}

.${FLASH_CLASS}[data-active] {
  animation: dshx-chat-scroll-flash 720ms ease-out both;
}

@keyframes dshx-chat-scroll-flash {
  0% { opacity: 0; transform: scaleX(0.25); }
  18% { opacity: 1; transform: scaleX(1); }
  68% { opacity: 1; transform: scaleX(1); }
  100% { opacity: 0; transform: scaleX(1); }
}

@media (prefers-reduced-motion: reduce) {
  .${FLASH_CLASS}[data-active] {
    animation-duration: 240ms;
  }
}
`.trim()
}

interface StyleElement {
  textContent: string | null
  setAttribute(name: string, value: string): void
  remove(): void
}

/** 最小文档接口，让安装器仍可进行单元测试。 */
export interface StyleHost {
  createElement(tag: 'style'): StyleElement
  /** 保持不透明，使真实 Document 与小型测试替身共享同一接口。 */
  readonly head: unknown
}

/** 在浏览器半激活期间安装样式表。 */
export function installLocatorStyles(host: StyleHost | undefined): () => void {
  if (host === undefined) return () => {}
  const element = host.createElement('style')
  element.setAttribute(STYLE_MARKER, '')
  element.textContent = locatorStylesheet()
  const head = host.head as {
    append?: (node: unknown) => void
    appendChild?: (node: unknown) => void
  }
  if (typeof head.append === 'function') head.append(element)
  else head.appendChild?.(element)
  return () => { element.remove() }
}

/** 原生分割线高亮样式元素的标记属性。 */
export const DIVIDER_STYLE_MARKER = 'data-dshx-chat-scroll-divider-highlight'

/** 原生分割线闪烁时长；复用 dshx-chat-scroll-flash 关键帧的节奏。 */
export const DIVIDER_FLASH_MS = 720
/** 减少动态效果时的闪烁时长。 */
export const DIVIDER_FLASH_REDUCED_MS = 240

/**
 * 针对一个 turn 的原生分割线高亮规则。只按 dsh 自身 data 属性选择
 * turn-process 头部按钮，不向 React 拥有的节点写任何 class/属性/内联样式；
 * 特异性 (0,2,1) 高于 CSS module 哈希类，无需 !important。
 */
export function dividerHighlightStylesheet(turn: string): string {
  const target = `[data-chat-flow-kind="turn-process"] button[data-turn-process="${turn}"]`
  return `
${target} {
  position: relative;
  border-bottom-color: var(--dsw-alias-state-business-primary, #3964fe);
}

${target}::after {
  content: '';
  position: absolute;
  right: 0;
  bottom: -1px;
  left: 0;
  height: 2px;
  border-radius: 999px;
  pointer-events: none;
  background: var(--dsw-alias-state-business-primary, #3964fe);
  box-shadow: 0 0 8px color-mix(in srgb, var(--dsw-alias-state-business-primary, #3964fe) 48%, transparent);
  opacity: 0;
  transform: scaleX(0.25);
  transform-origin: center;
  animation: dshx-chat-scroll-flash ${DIVIDER_FLASH_MS}ms ease-out both;
}

@media (prefers-reduced-motion: reduce) {
  ${target}::after {
    animation-duration: ${DIVIDER_FLASH_REDUCED_MS}ms;
  }
}
`.trim()
}

/**
 * 高亮指定 turn 的原生分割线：注入只包含该 turn 规则的插件样式元素，
 * 到时移除。返回清理函数；不依赖 React 重建（新按钮同属性即命中）。
 */
export function showDividerHighlight(host: StyleHost, turn: string): () => void {
  const element = host.createElement('style')
  element.setAttribute(DIVIDER_STYLE_MARKER, '')
  element.textContent = dividerHighlightStylesheet(turn)
  const head = host.head as {
    append?: (node: unknown) => void
    appendChild?: (node: unknown) => void
  }
  if (typeof head.append === 'function') head.append(element)
  else head.appendChild?.(element)
  return () => { element.remove() }
}
