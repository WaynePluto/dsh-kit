import {
  findAssistantMessageRow, findScrollport, findTurnDividerHost, MAX_LANDING_WAIT_MS, MAX_TARGET_WAIT_MS,
  scrollTopForMessage,
} from './locate.js'
import { durationForDistance, startScrollAnimation } from './animation.js'

interface MessageLandingOptions {
  /** 即使另一个会话正在挂载，也保持在所属 flow 内。 */
  readonly root: ParentNode
  readonly messageKey: string
  readonly reducedMotion: boolean
  /** 首次写入滚动位置前补足缺失的尾部空间；target 与动画目标同源（锚点元素对齐阅读线）。 */
  prepare(row: HTMLElement, scrollport: HTMLElement, target: number): void
  /** 只有几何测量确认到达目标锚点后才调用；header 为命中的原生分割线宿主（未命中为 null）。 */
  onLand(row: HTMLElement, scrollport: HTMLElement, header: HTMLElement | null): void
}

/** 落点守护的最长持续时间；超时后即使仍有非输入性的拉动也不再校正。 */
export const MAX_LANDING_HOLD_MS = 5_000

/** 视图连续保持这么多帧在阅读线上，守护才确认稳定（超时路径据此补闪）。 */
export const LANDING_HOLD_STABLE_FRAMES = 24

/** 目标锚点连续零高/隐藏这么多帧仍不恢复就结束守护（瞬时折叠过渡不算）。 */
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
    // 锚点优先取本轮的 turn 头部（「已完成，用时 X秒」）。多步轮次里头部远在
    // 消息上方，但「回到消息开头」要的是回到这一轮的开头：头部贴顶、分割线在
    // 其下方。头部不可测量（整轮折叠隐藏）时退回消息行锚点。
    const header = findTurnDividerHost(row)
    const anchor: HTMLElement = header ?? row
    const initialTarget = targetFor(anchor, scrollport)
    // 只有「对齐阅读线必须垫出尾部空白」（无滚动条短页、最后一条消息）且开头已可见时
    // 才跳过：那时硬对齐只会留下大片空白。长会话里开头可见但下方仍有内容时照常滚动——
    // 只判「已可见」会让屏幕中部的消息开头原地不动，落点看起来完全没反应。
    const naturalFloor = Math.max(0, scrollport.scrollHeight - scrollport.clientHeight)
    if (initialTarget > naturalFloor + 1 && startAlreadyVisible(anchor, scrollport)) {
      stopped = true
      removeInputListeners()
      options.onLand(row, scrollport, header)
      return
    }
    options.prepare(row, scrollport, initialTarget)
    animationStop = startScrollAnimation({
      scrollport,
      getTarget: () => targetFor(anchor, scrollport),
      reducedMotion: options.reducedMotion,
      durationMs: durationForDistance(initialTarget - scrollport.scrollTop),
      maxDurationMs: MAX_LANDING_WAIT_MS,
      onLand: () => {
        animationStop = null
        stopped = true
        removeInputListeners()
        options.onLand(row as HTMLElement, scrollport as HTMLElement, header)
        // dsh 的折叠批次、回底跟随等机制会在无用户输入时移动视图；
        // 落点后短时间内按帧把视图拉回阅读线。
        holdStop = startLandingHold({
          row: row as HTMLElement,
          scrollport: scrollport as HTMLElement,
          anchor,
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
          anchor,
          prepare: options.prepare,
          onStable: () => { options.onLand(row as HTMLElement, scrollport as HTMLElement, header) },
        })
      },
    })
  }

  settle()
  return stop
}

/**
 * 落点后的短暂守护：按帧复核目标锚点是否仍在阅读线上，漂移时写回；任何
 * pointerdown/wheel/keydown（行所属 document 捕获，覆盖原生 Turn 导航等
 * 滚动宿主之外的入口）立即让位。行或锚点卸载即停；锚点短暂零高/隐藏
 * （折叠过渡）时等待恢复，持续不恢复才结束。写回被浏览器钳制（目标暂时
 * 不可达）时重新执行 prepare 补足尾部滚动空间再写。
 * @returns 停止守护的函数。
 */
export function startLandingHold(options: {
  row: HTMLElement
  scrollport: HTMLElement
  /** 阅读线对齐的锚点元素：命中分割线时是 turn 头部，否则是消息行本身。 */
  anchor: HTMLElement
  /** 与 landing 相同的尾部空间准备回调；写入被钳制时按当前几何重算。 */
  prepare?(row: HTMLElement, scrollport: HTMLElement, target: number): void
  /** 首次连续稳定时调用一次；守护自然结束不重复调用。 */
  onStable?: () => void
}): () => void {
  const { row, scrollport, anchor } = options
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
    if (!row.isConnected || !anchor.isConnected || !scrollport.isConnected) { stop(); return }
    if (anchor.hidden || anchor.getBoundingClientRect().height === 0) {
      // 折叠/展开过渡会让锚点瞬时不可测量；短暂等待恢复，不把零几何当作目标。
      zeroRectFrames += 1
      if (zeroRectFrames >= HOLD_ZERO_RECT_PATIENCE_FRAMES) { stop(); return }
    } else {
      zeroRectFrames = 0
      const target = targetFor(anchor, scrollport)
      if (Math.abs(target - scrollport.scrollTop) <= 2) {
        stableFrames += 1
        if (stableFrames >= LANDING_HOLD_STABLE_FRAMES && !stableReported) {
          stableReported = true
          options.onStable?.()
        }
      } else {
        stableFrames = 0
        scrollport.scrollTop = target
        if (Math.abs(targetFor(anchor, scrollport) - scrollport.scrollTop) > 2 && options.prepare !== undefined) {
          // 写入被钳制：目标超过当前滚动底（上游可能回收了尾部空间），补足后重写。
          options.prepare(row, scrollport, targetFor(anchor, scrollport))
          scrollport.scrollTop = targetFor(anchor, scrollport)
        }
      }
    }
    frame = window.requestAnimationFrame(step)
  }

  frame = window.requestAnimationFrame(step)
  return stop
}

/** 判断消息开头（锚点元素上沿）是否已经在滚动可视区内（以 composer 座位上沿为可视下界）。 */
function startAlreadyVisible(anchor: HTMLElement, scrollport: HTMLElement): boolean {  const anchorRect = anchor.getBoundingClientRect()
  const portRect = scrollport.getBoundingClientRect()
  const composerSeat = scrollport.querySelector<HTMLElement>('[data-composer-seat]')
  const visibleBottom = composerSeat === null ? portRect.bottom : composerSeat.getBoundingClientRect().top
  return anchorRect.top >= portRect.top - 2 && anchorRect.top <= visibleBottom
}

/**
 * 计算把锚点元素上沿放到转录阅读线上的 scrollTop。锚点在折叠过渡中
 * 不可测量（hidden/零高）时按当前位置保持，等下一帧重新测量。
 */
function targetFor(anchor: HTMLElement | null, scrollport: HTMLElement | null): number {
  if (anchor === null || scrollport === null) return 0
  const rect = anchor.getBoundingClientRect()
  if (anchor.hidden || rect.height === 0) return scrollport.scrollTop
  return scrollTopForMessage(
    scrollport.scrollTop,
    rect.top,
    scrollport.getBoundingClientRect().top,
  )
}
