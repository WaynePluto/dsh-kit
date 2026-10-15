/**
 * services panel 的 DOM/CSS 样式与日志 dialog 的浏览器辅助。
 * 样式 token 保持与 dsh todo dock 一致；状态和组件不在这里实现。
 */

import type { CSSProperties } from 'react'
import {
  LOG_DIALOG_HEIGHT,
  LOG_DIALOG_WIDTH_PROP,
  LOG_PATH_MIN_HEIGHT_PX,
  logDialogRule,
  publishLogDialogWidth,
} from './log-dialog.js'
import {
  BORDER as DOCK_BORDER,
  MONO as DOCK_MONO,
  SECONDARY as DOCK_SECONDARY,
  TERTIARY as DOCK_TERTIARY,
} from '@dsh-kit/plugin-ui'

/** 安装日志 dialog stylesheet；每个 panel 实例只安装一份。 */
export function installLogDialogStyles(): () => void {
  const element = document.createElement('style')
  element.dataset['dshServicesLogDialog'] = ''
  element.textContent = logDialogRule()
  document.head.append(element)
  return () => {
    element.remove()
    document.documentElement.style.removeProperty(LOG_DIALOG_WIDTH_PROP)
  }
}

/** 将测得的 dialog 宽度（px）发布到 `<html>`，供 stylesheet 读取。 */
export function publishWidth(width: number): void {
  publishLogDialogWidth(
    (name, value) => { document.documentElement.style.setProperty(name, value) },
    width,
  )
}

export {
  chevronStyle,
  headerStyle,
  leadStyle,
  rootStyle,
  summaryStyle,
  summaryTextStyle,
  titleStyle,
} from '@dsh-kit/plugin-ui'

export const listStyle: CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: '0 12px 8px',
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  minWidth: 0,
}

/** 单行布局：不允许换行，超长内容由 name/facts 各自的 ellipsis 吸收。 */
export const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  minWidth: 0,
}

/**
 * 名称列：隐藏的全文 span 留在文档流里撑出列的 flex 基础尺寸（宽表名多占宽、窄表名少占宽），
 * 截断后的可见文本绝对定位覆盖，宽度不反馈进布局，测量结果是纯函数、不会振荡。
 */
export const nameStyle: CSSProperties = {
  position: 'relative',
  fontFamily: DOCK_MONO,
  fontWeight: 600,
  flex: '0 1 auto',
  minWidth: 0,
  overflow: 'hidden',
}

/** 名称列里撑宽度用的隐藏原文；`visibility:hidden` 保占位，sr 仍可读到完整名称。 */
export const nameSizerStyle: CSSProperties = {
  whiteSpace: 'pre',
  visibility: 'hidden',
}

/** 名称列里实际显示的截断文本，覆盖在 sizer 上方。 */
export const nameTextStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  whiteSpace: 'pre',
  overflow: 'hidden',
}

export const factsStyle: CSSProperties = {
  color: DOCK_SECONDARY,
  fontSize: '12px',
  flex: '1 1 0%',
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

/** 行尾操作按钮组；flex:none 保证 facts 超长时按钮不被压缩换行。 */
export const rowActionsStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  flex: 'none',
}

/** modal 内的日志 body，固定高度避免日志加载后 dialog 跳变。 */
export const logBoxStyle: CSSProperties = {
  height: LOG_DIALOG_HEIGHT,
  flex: 'none',
  overflow: 'auto',
  overscrollBehavior: 'contain',
  margin: 0,
  padding: '10px 12px',
  borderRadius: '8px',
  border: `1px solid ${DOCK_BORDER}`,
  background: 'rgba(128,128,128,0.1)',
  color: DOCK_SECONDARY,
  fontFamily: DOCK_MONO,
  fontSize: '12px',
  lineHeight: 1.5,
  whiteSpace: 'pre',
  minWidth: 0,
  boxSizing: 'border-box',
}

/** body 上方显示的日志路径；预留高度避免 Host 返回后 dialog 跳变。 */
export const logPathStyle: CSSProperties = {
  fontFamily: DOCK_MONO,
  fontSize: '11px',
  lineHeight: `${String(LOG_PATH_MIN_HEIGHT_PX)}px`,
  minHeight: `${String(LOG_PATH_MIN_HEIGHT_PX)}px`,
  color: DOCK_TERTIARY,
  margin: '0 0 8px',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

export const errorStyle: CSSProperties = {
  color: 'var(--dsw-alias-state-error-primary, #dc2626)',
  fontSize: '12px',
  minWidth: 0,
  overflowWrap: 'anywhere',
}

export const warnStyle: CSSProperties = { ...errorStyle, color: DOCK_SECONDARY }

