/** 样式表是全局的，因此类名刻意使用命名空间。 */
export const ANCHOR_CLASS = 'dshx-session-workspace-anchor'
export const PILL_CLASS = 'dshx-session-workspace-pill'
export const LABEL_CLASS = 'dshx-session-workspace-label'
export const STYLE_MARKER = 'data-dsh-plugin-session-workspace'

/**
 * 界面契约：逐条复刻原生统计 pill（`ui-chat/src/client/chat/StatsPills.module.css`，
 * 0.2.1-rc.3 核对）：anchor 收缩包裹并定 12px 次级字号；pill 是 `1px 8px` 圆角
 * `--dsw-radius-sm` 的透明静息态、tertiary 文字，hover 走 `--dsw-alias-interactive-bg-hover`
 * 并升到 secondary；svg 14px 不收缩；可变长文本放内层 label 省略，外层只负责排布。
 */
export function pillStylesheet(): string {
  return `
.${ANCHOR_CLASS} {
  display: inline-flex;
  min-width: 0;
  font-size: calc(var(--dsh-content-font-size-secondary, 13px) - 1px);
  line-height: calc(20px + var(--dsh-content-font-delta-secondary, 0px));
}

.${PILL_CLASS} {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  box-sizing: border-box;
  max-width: 100%;
  padding: 1px 8px;
  border: none;
  border-radius: var(--dsw-radius-sm, 8px);
  background: transparent;
  color: var(--dsw-alias-label-tertiary, #6b7280);
  font: inherit;
  line-height: inherit;
  white-space: nowrap;
  cursor: pointer;
}

.${PILL_CLASS} svg {
  width: 14px;
  height: 14px;
  flex: none;
}

.${PILL_CLASS}:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, 0.12));
  color: var(--dsw-alias-label-secondary, #6b7280);
}

.${LABEL_CLASS} {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
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
export function installPillStyles(host: StyleHost | undefined): () => void {
  if (host === undefined) return () => {}
  const element = host.createElement('style')
  element.setAttribute(STYLE_MARKER, '')
  element.textContent = pillStylesheet()
  const head = host.head as {
    append?: (node: unknown) => void
    appendChild?: (node: unknown) => void
  }
  if (typeof head.append === 'function') head.append(element)
  else head.appendChild?.(element)
  return () => { element.remove() }
}
