/**
 * 「服务」全局面板正文：`sidebar.panellist` 行经 `layout.selectPanel` 打开的 `main` keyed 页面。
 * 页面按 {@link POLL_MS} 轮询，Host 每次做 registry 与 OS reconciliation；uptime 以 Host snapshot 时钟为基准，再加页面本地经过时间。
 * 服务退出属于正常状态，页面只展示当前存活服务；已停止服务的日志仍由 `service_logs` 读取。
 *
 * @module @dsh-kit/dsh-plugin-services/client/ServicesPage
 */

import { useCallback, useEffect } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { ServiceLogDialog } from './ServiceLogDialog.js'
import { ServiceRow } from './ServiceRow.js'
import { errorStyle, installLogDialogStyles, installPageStyles, listStyle } from './styles.js'
import { useServicesState, POLL_MS } from './use-services-state.js'
import type { ServicesActions, ServicesPageProps } from './types.js'
import type { ServicesKey } from './locales.js'
import type { LogDialogResizeDirection } from './log-dialog.js'

export { POLL_MS }
export type { ServicesActions, ServicesPageProps } from './types.js'

/** Modal 中的八向尺寸方向，保留旧 DOM 的顺序和拖动行为。 */
const LOG_RESIZE_DIRECTIONS = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'] as const satisfies readonly LogDialogResizeDirection[]

/** 页面框架 class；规则由 installPageStyles 安装（styles.ts 的 pageRule）。 */
const PAGE = 'dsh-services-page'

/** 全局面板没有会话绑定：列表恒为全局，排序锚点由注入的 currentSessionId 每次轮询时现取。 */
export function ServicesPage({ onList, onStop, onRestart, onLogs, currentSessionId, t }: ServicesPageProps) {
  const translate = useCallback((key: ServicesKey): string => t?.(key) ?? key, [t])
  const actions = { onList, onStop, onRestart, onLogs, currentSessionId } as Partial<ServicesActions>
  const state = useServicesState({ actions, translate })

  // 页面生命周期内各安装一个 stylesheet；宽度通过 custom property 传递，打开 dialog 不会重建 stylesheet。
  useEffect(() => {
    const disposePage = installPageStyles()
    const disposeLog = installLogDialogStyles()
    return () => {
      disposeLog()
      disposePage()
    }
  }, [])

  const {
    snapshot,
    error,
    busy,
    openLog,
    log,
    services,
    summary,
    rootRef,
    elapsed,
    load,
    act,
    showLog,
    closeLog,
    logFullscreen,
    toggleLogFullscreen,
    onLogResizePointerDown,
    onLogMovePointerDown,
  } = state

  return (
    <section ref={rootRef} className={PAGE} aria-label={translate('title')} data-dsh-services-page="">
      <div className={`${PAGE}-scroll`}>
        <div className={`${PAGE}-content`}>
          <div className={`${PAGE}-heading`}>
            <h1 className={`${PAGE}-title`}>{translate('title')}</h1>
            <Button variant="outline" size="sm" onClick={() => { void load() }}>{translate('refresh')}</Button>
          </div>
          {/* 首个 snapshot 到达前显示加载态：冷启动的身份探针要 spawn 一次子进程，不能让页面空白等待。 */}
          <p className={`${PAGE}-subline`}>
            {snapshot === undefined ? translate('loading') : services.length === 0 ? translate('emptyRunning') : summary}
          </p>
          <ul style={listStyle}>
            {services.map(service => (
              <ServiceRow
                key={service.name}
                service={service}
                sessionCwd={snapshot?.cwd ?? null}
                busy={busy[service.name]}
                actions={actions}
                translate={translate}
                elapsed={elapsed}
                onShowLog={showLog}
                onAction={act}
              />
            ))}
            {error !== null && <li style={errorStyle}>{error}</li>}
          </ul>
        </div>
      </div>

      <ServiceLogDialog
        openLog={openLog}
        log={log}
        translate={translate}
        onClose={closeLog}
        onRefresh={() => { if (openLog !== null) showLog(openLog) }}
        fullscreen={logFullscreen}
        onToggleFullscreen={toggleLogFullscreen}
        onLogResizePointerDown={onLogResizePointerDown}
        onLogMovePointerDown={onLogMovePointerDown}
        directions={LOG_RESIZE_DIRECTIONS}
      />
    </section>
  )
}
