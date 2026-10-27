/**
 * composer 统计栏最左的工作区 pill：文件夹图标 + 末级目录名，悬停 title 显示完整
 * 路径，点击复制完整路径并短暂显示「已复制」。cwd 取自 sessions 标准服务的列表态
 * `byId[sessionId].cwd`（与原生工作区悬停卡同源），会话还没有 cwd 时不渲染。
 *
 * @module @dsh-kit/dsh-plugin-session-workspace/client/pill
 */

import { useEffect, useRef, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconFolderCloseMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import { ANCHOR_CLASS, LABEL_CLASS, PILL_CLASS } from './styles.js'
import { workspaceLabel } from './label.js'

/** 复制成功后「已复制」停留的时长。 */
const COPIED_RESET_MS = 1500

/** dock entry 的完整 props：会话标准 kit（sessionId + useSessions）+ 本插件文案。 */
export type WorkspacePillProps =
  PropsRuntime<'conversation.composer.dock'>
  & PropsLocale<'dsh-plugin-session-workspace'>

/**
 * Slot entry：显示当前会话工作区，点击复制完整路径。
 * @param props - 会话作用域标准 props 与文案。
 * @returns pill；会话还没有 cwd 时渲染 null。
 */
export function WorkspacePill({ sessionId, useSessions, t }: WorkspacePillProps) {
  const cwd = useSessions(sessions => sessions.byId[sessionId]?.cwd)
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => { clearTimeout(timer.current) }, [])

  if (cwd === undefined || cwd === '') return null

  const copy = (): void => {
    void (async () => {
      try {
        await navigator.clipboard?.writeText(cwd)
        setCopied(true)
        clearTimeout(timer.current)
        timer.current = setTimeout(() => { setCopied(false) }, COPIED_RESET_MS)
      } catch {
        // 部分浏览器在普通 HTTP 下拒绝剪贴板访问；悬停 title 的完整路径始终是回退。
      }
    })()
  }

  return (
    <span className={ANCHOR_CLASS}>
      <button type="button" className={PILL_CLASS} title={cwd} onClick={copy}>
        <IconFolderCloseMedium size={14} />
        <span className={LABEL_CLASS}>{copied ? t('copied') : workspaceLabel(cwd)}</span>
      </button>
    </span>
  )
}
