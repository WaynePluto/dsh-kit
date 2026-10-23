/**
 * services panel 的单行视图；操作回调仍由状态 hook 提供。
 * 名称列用 {@link midEllipsis} 做中间截断：CSS 的 text-overflow 只能截尾部，
 * 服务名却两头都有辨识价值（前缀常是项目名，尾段区分同名服务），因此由组件测量后手动压缩。
 */

import { useEffect, useRef, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { baseNameOf, midEllipsis } from '../shared.js'
import type { ServiceView } from '../shared.js'
import type { ServicesKey } from './locales.js'
import { factsStyle, nameSizerStyle, nameStyle, nameTextStyle, rowActionsStyle, rowStyle, warnStyle } from './styles.js'
import type { Busy, ServicesActions } from './types.js'

/** 单行渲染所需的输入。 */
export interface ServiceRowProps {
  service: ServiceView
  /** 排序锚点会话的项目目录；非本工作区的服务带来源徽标。 */
  sessionCwd: string | null
  busy: Busy
  actions?: Partial<ServicesActions> | undefined
  translate: (key: ServicesKey) => string
  elapsed: (service: ServiceView) => string
  onShowLog: (name: string) => void
  onAction: (name: string, kind: 'stop' | 'restart') => void
}

/** 名称列测量的内部状态：当前容量与两个 ref。 */
interface NameMeasure {
  /** 可容纳的字形数；未挂载/无法测量时为 null（显示原文）。 */
  capacity: number | null
  /** 名称列盒子。 */
  boxRef: React.RefObject<HTMLSpanElement>
  /** 隐藏的原文 sizer。 */
  sizerRef: React.RefObject<HTMLSpanElement>
}

/**
 * 观察名称列盒子的可用宽度，返回能放下的字形数；宽度或字体变化都会重新测量。
 * 服务名是 ASCII、名称列是等宽字体，字形数按原文总宽折算，无需逐字测量。
 * 盒子宽度来自隐藏的原文 sizer（宽度不随截断结果变化），因此测量是纯函数、不会振荡。
 * @param name - 完整服务名。
 * @returns 测量状态。
 */
function useNameGlyphCapacity(name: string): NameMeasure {
  // RefObject 形态（initialValue: null）让 ref prop 直接接受返回值。
  const boxRef = useRef<HTMLSpanElement>(null)
  const sizerRef = useRef<HTMLSpanElement>(null)
  const [capacity, setCapacity] = useState<number | null>(null)
  useEffect(() => {
    const box = boxRef.current
    const sizer = sizerRef.current
    if (box === null || sizer === null) return
    const measure = () => {
      const unit = sizer.getBoundingClientRect().width / Math.max(name.length, 1)
      // 半像素容差抵消 subpixel 舍入，避免放得下的名称被误截一个字形。
      setCapacity(unit > 0 ? Math.floor(box.clientWidth / unit + 0.5) : null)
    }
    measure()
    // ResizeObserver 覆盖面板折叠/展开、窗口缩放与字体加载后的盒宽变化。
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure)
    observer?.observe(box)
    observer?.observe(sizer)
    return () => { observer?.disconnect() }
  }, [name])
  return { capacity, boxRef, sizerRef }
}

/** 渲染一个运行中服务的名称、事实和操作按钮。 */
export function ServiceRow({ service, sessionCwd, busy, actions, translate, elapsed, onShowLog, onAction }: ServiceRowProps) {
  const { capacity, boxRef, sizerRef } = useNameGlyphCapacity(service.name)
  // capacity 为 null（未测量）时显示原文，避免首帧闪现省略号。
  const visibleName = capacity === null ? service.name : midEllipsis(service.name, capacity)
  // 其他工作区的服务以项目目录末段打头，宿主已把当前工作区排在最前；悬停可见完整来源路径。
  const foreign = sessionCwd !== null && service.root !== sessionCwd
  const origin = foreign ? `[${baseNameOf(service.root)}]` : undefined
  // 每个服务只占一行；命令等 facts 超长时在中间省略，完整内容通过 title 提供。
  const facts = [
    origin,
    service.port === undefined ? undefined : `:${String(service.port)}`,
    `pid ${String(service.pid)}`,
    elapsed(service),
    service.command,
  ].filter(Boolean).join('  ')
  const factsTitle = foreign ? `${service.root}  ${facts}` : facts
  return (
    <li style={{ minWidth: 0 }}>
      <div style={rowStyle}>
        <span ref={boxRef} style={nameStyle}>
          <span ref={sizerRef} style={nameSizerStyle} aria-hidden={true}>{service.name}</span>
          <span style={nameTextStyle} title={service.name} aria-label={service.name}>{visibleName}</span>
        </span>
        <span style={factsStyle} title={factsTitle}>{facts}</span>
        <span style={rowActionsStyle}>
          <Button
            variant="outline"
            size="sm"
            disabled={busy !== undefined}
            onClick={() => { onShowLog(service.name) }}
          >
            {translate('logs')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={busy !== undefined || actions?.onRestart === undefined}
            onClick={() => { onAction(service.name, 'restart') }}
          >
            {busy === 'restart' ? translate('restarting') : translate('restart')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={busy !== undefined || actions?.onStop === undefined}
            onClick={() => { onAction(service.name, 'stop') }}
          >
            {busy === 'stop' ? translate('stopping') : translate('stop')}
          </Button>
        </span>
      </div>
      {service.identity === 'unknown' && (
        <div style={warnStyle}>{translate('unknownIdentity')}</div>
      )}
    </li>
  )
}
