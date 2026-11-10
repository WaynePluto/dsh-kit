import {
  findAssistantMessageRow, findScrollport, MAX_LANDING_WAIT_MS, MAX_TARGET_WAIT_MS,
  scrollTopForMessage,
} from './locate.js'
import { durationForDistance, startScrollAnimation } from './animation.js'

interface MessageLandingOptions {
  /** 即使另一个会话正在挂载，也保持在所属 flow 内。 */
  readonly root: ParentNode
  readonly messageKey: string
  readonly reducedMotion: boolean
  /** 首次写入滚动位置前补足缺失的尾部空间。 */
  prepare(row: HTMLElement, scrollport: HTMLElement): void
  /** 只有几何测量确认到达目标行后才调用。 */
  onLand(row: HTMLElement, scrollport: HTMLElement): void
}

/** 落点守护的最长持续时间；超时后即使仍有非输入性的拉动也不再校正。 */
export const MAX_LANDING_HOLD_MS = 5_000

/** 视图连续保持这么多帧在阅读线上，守护才确认稳定（超时路径据此补闪）。 */
export const LANDING_HOLD_STABLE_FRAMES = 24

/** 目标行连续零高/隐藏这么多帧仍不恢复就结束守护（瞬时折叠过渡不算）。 */
export const HOLD_ZERO_RECT_PATIENCE_FRAMES = 40

/** 设置写入契约：此处说明命名空间、校验、回读确认和草稿保留。 */
export function startMessageLanding(options: MessageLandingOptions): () => void {
  const startedAt = Date.now()
  let frame: number | null = null
  let animationStop: (() => void) | null = null
  let holdStop: (() => void) | null = null
  let stopped = false
  let row: HTMLElement | null = null
  let scrollport: HTMLElement | null = null

  const removeInputListeners = (): void => {
    scrollport?.removeEventListener('pointerdown', stop, true)
    scrollport?.removeEventListener('wheel', stop, true)
    scrollport?.removeEventListener('keydown', stop, true)
  }

  function stop(): void {
    if (stopped) return
    stopped = true
    if (frame !== null) window.cancelAnimationFrame(frame)
    frame = null
    animationStop?.()
    animationStop = null
    holdStop?.()
    holdStop = null
    removeInputListeners()
  }

  const settle = (): void => {
    if (stopped) return
    frame = null
    const now = Date.now()
    const nextRow = findAssistantMessageRow(options.root, options.messageKey)
    const nextPort = nextRow === null ? null : findScrollport(nextRow)
    if (nextRow === null || nextPort === null) {
      if (now - startedAt >= MAX_TARGET_WAIT_MS) stop()
      else frame = window.requestAnimationFrame(settle)
      return
    }

    if (row === nextRow && scrollport === nextPort) return
    removeInputListeners()
    row = nextRow
    scrollport = nextPort
    scrollport.addEventListener('pointerdown', stop, { capture: true, passive: true })
    scrollport.addEventListener('wheel', stop, { capture: true, passive: true })
    scrollport.addEventListener('keydown', stop, { capture: true })
    // 消息开头已在可视区内（无滚动条的短页，或开头本来就看得见）：对齐阅读线
    // 没有意义——最后一条消息还会因此垫出大片空白。不滚动、不加衬垫，直接闪线。
    if (startAlreadyVisible(row, scrollport)) {
      stopped = true
      removeInputListeners()
      options.onLand(row, scrollport)
      return
    }
    options.prepare(row, scrollport)
    const initialTarget = targetFor(row, scrollport)
    animationStop = startScrollAnimation({
      scrollport,
      getTarget: () => targetFor(row, scrollport),
      reducedMotion: options.reducedMotion,
      durationMs: durationForDistance(initialTarget - scrollport.scrollTop),
      maxDurationMs: MAX_LANDING_WAIT_MS,
      onLand: () => {
        animationStop = null
        stopped = true
        removeInputListeners()
        options.onLand(row as HTMLElement, scrollport as HTMLElement)
        // dsh 的折叠批次、回底跟随等机制会在无用户输入时移动视图；
        // 落点后短时间内按帧把视图拉回阅读线。
        holdStop = startLandingHold({
          row: row as HTMLElement,
          scrollport: scrollport as HTMLElement,
          prepare: options.prepare,
        })
      },
      onTimeout: () => {
        animationStop = null
        stopped = true
        removeInputListeners()
        // 超时说明布局仍在变化：继续按帧复核，连续稳定在阅读线后才补闪，
        // 不产生虚假的到达效果。
        holdStop = startLandingHold({
          row: row as HTMLElement,
          scrollport: scrollport as HTMLElement,
          prepare: options.prepare,
          onStable: () => { options.onLand(row as HTMLElement, scrollport as HTMLElement) },
        })
      },
    })
  }

  settle()
  return stop
}

/**
 * 落点后的短暂守护：按帧复核目标行是否仍在阅读线上，漂移时写回；任何
 * pointerdown/wheel/keydown（行所属 document 捕获，覆盖原生 Turn 导航等
 * 滚动宿主之外的入口）立即让位。行卸载即停；行短暂零高/隐藏（折叠过渡）时
 * 等待恢复，持续不恢复才结束。写回被浏览器钳制（目标暂时不可达）时重新执行
 * prepare 补足尾部滚动空间再写。
 * @returns 停止守护的函数。
 */
export function startLandingHold(options: {
  row: HTMLElement
  scrollport: HTMLElement
  /** 与 landing 相同的尾部空间准备回调；写入被钳制时按当前几何重算。 */
  prepare?(row: HTMLElement, scrollport: HTMLElement): void
  /** 首次连续稳定时调用一次；守护自然结束不重复调用。 */
  onStable?: () => void
}): () => void {
  const { row, scrollport } = options
  const startedAt = Date.now()
  let frame: number | null = null
  let stopped = false
  let stableFrames = 0
  let stableReported = false
  let zeroRectFrames = 0

  const onInput = (): void => { stop() }
  const inputTarget: Document | HTMLElement = row.ownerDocument ?? scrollport
  for (const type of ['pointerdown', 'wheel', 'keydown'] as const) {
    inputTarget.addEventListener(type, onInput, { capture: true, passive: true })
  }

  function stop(): void {
    if (stopped) return
    stopped = true
    if (frame !== null) window.cancelAnimationFrame(frame)
    frame = null
    for (const type of ['pointerdown', 'wheel', 'keydown'] as const) {
      inputTarget.removeEventListener(type, onInput, { capture: true })
    }
  }

  const step = (): void => {
    if (stopped) return
    frame = null
    if (Date.now() - startedAt >= MAX_LANDING_HOLD_MS) { stop(); return }
    if (!row.isConnected || !scrollport.isConnected) { stop(); return }
    if (row.hidden || row.getBoundingClientRect().height === 0) {
      // 折叠/展开过渡会让行瞬时不可测量；短暂等待恢复，不把零几何当作目标。
      zeroRectFrames += 1
      if (zeroRectFrames >= HOLD_ZERO_RECT_PATIENCE_FRAMES) { stop(); return }
    } else {
      zeroRectFrames = 0
      const target = targetFor(row, scrollport)
      if (Math.abs(target - scrollport.scrollTop) <= 2) {
        stableFrames += 1
        if (stableFrames >= LANDING_HOLD_STABLE_FRAMES && !stableReported) {
          stableReported = true
          options.onStable?.()
        }
      } else {
        stableFrames = 0
        scrollport.scrollTop = target
        if (Math.abs(targetFor(row, scrollport) - scrollport.scrollTop) > 2 && options.prepare !== undefined) {
          // 写入被钳制：目标超过当前滚动底（上游可能回收了尾部空间），补足后重写。
          options.prepare(row, scrollport)
          scrollport.scrollTop = targetFor(row, scrollport)
        }
      }
    }
    frame = window.requestAnimationFrame(step)
  }

  frame = window.requestAnimationFrame(step)
  return stop
}

/** 判断消息开头是否已经在滚动可视区内（以 composer 座位上沿为可视下界）。 */
function startAlreadyVisible(row: HTMLElement, scrollport: HTMLElement): boolean {
  const rowRect = row.getBoundingClientRect()
  const portRect = scrollport.getBoundingClientRect()
  const composerSeat = scrollport.querySelector<HTMLElement>('[data-composer-seat]')
  const visibleBottom = composerSeat === null ? portRect.bottom : composerSeat.getBoundingClientRect().top
  return rowRect.top >= portRect.top - 2 && rowRect.top <= visibleBottom
}

function targetFor(row: HTMLElement | null, scrollport: HTMLElement | null): number {
  if (row === null || scrollport === null) return 0
  return scrollTopForMessage(
    scrollport.scrollTop,
    row.getBoundingClientRect().top,
    scrollport.getBoundingClientRect().top,
  )
}
