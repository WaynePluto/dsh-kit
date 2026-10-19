/**
 * 提供商标签样式：与原生模型触发器（ui-model-selection 的 ModelSelect.module.css
 * `.trigger`）同节奏的 13/20 常规字重静默前缀。非交互文本，无焦点/hover 态，
 * 因此 inline CSSProperties 即可（dsh-theme：状态样式才需要局部 stylesheet）。
 * `--dsh-composer-model-text-display` 由 composer 行的紧凑测量
 * （ui-conversation 的 control-row-layout.ts + InputBar.module.css
 * `.row[data-model-compact]`）发布：行宽不足时与模型文字一起隐藏、只留图标。
 */
import type { CSSProperties } from 'react'

/** 标签宿主：flex 居中 + 可收缩，紧凑模式随模型文字一起隐藏。 */
export const labelHostStyle: CSSProperties = {
  display: 'var(--dsh-composer-model-text-display, inline-flex)',
  alignItems: 'center',
  maxWidth: '160px',
  minWidth: 0,
  color: 'var(--dsw-alias-label-tertiary)',
  fontSize: '13px',
  lineHeight: '20px',
  fontWeight: 400,
}

/** 内层文本：省略号必须落在 flex 容器内的独立 span 上。 */
export const labelTextStyle: CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}
