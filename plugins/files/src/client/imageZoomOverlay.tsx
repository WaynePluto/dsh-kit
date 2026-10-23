import { useCallback, useEffect, useLayoutEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { TabId } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { parseFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import type { Translate } from './locales.js'
import { installImagePan } from './imagePan.js'

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg'])
const MIN_SCALE = 0.1
const MAX_SCALE = 8
const STEP = 1.25

type ImageState = { readonly mode: 'fit' | 'fixed'; readonly scale: number }

export class ImageZoomStore {
  private readonly states = new Map<TabId, ImageState>()
  get(tabId: TabId): ImageState {
    return this.states.get(tabId) ?? { mode: 'fit', scale: 1 }
  }
  set(tabId: TabId, state: ImageState): void { this.states.set(tabId, state) }
  delete(tabId: TabId): void { this.states.delete(tabId) }
  clear(): void { this.states.clear() }
}

interface ImageView {
  readonly pane: HTMLElement
  readonly body: HTMLElement
  readonly frame: HTMLElement
  readonly image: HTMLImageElement
  readonly scrollport: HTMLElement
}

function clamp(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}

function imagePathOf(address: string): string | undefined {
  const parsed = parseFileAddress(address)
  return parsed?.path.replaceAll('\\', '/')
}

function isImageAddress(address: string): boolean {
  const path = imagePathOf(address)
  if (path === undefined) return false
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase()
  return IMAGE_EXTENSIONS.has(name.slice(name.lastIndexOf('.') + 1))
}

function selectedTab(tabId: TabId): boolean {
  if (typeof document === 'undefined') return false
  return [...document.querySelectorAll<HTMLElement>('[data-dockkit-tab]')]
    .some(tab => tab.dataset.dockkitTab === tabId && tab.getAttribute('aria-selected') === 'true')
}

function findImageView(address: string, paneId: string): ImageView | undefined {
  if (typeof document === 'undefined') return undefined
  const pane = [...document.querySelectorAll<HTMLElement>('[data-dockkit-pane]')]
    .find(element => element.dataset.dockkitPane === paneId)
  if (pane === undefined) return undefined
  const preview = [...pane.querySelectorAll<HTMLElement>('[data-textpreview-state="text"][data-textpreview-url]')]
    .find(element => element.dataset.textpreviewUrl === address)
  const frame = preview?.querySelector<HTMLElement>('[data-image-preview]')
  const image = frame?.querySelector<HTMLImageElement>('img')
  const body = preview?.querySelector<HTMLElement>('[data-textpreview-body]')
  const scrollport = frame?.closest<HTMLElement>('[data-document-zoom-scrollport]')
  if (preview === undefined || frame === null || frame === undefined || image === null || image === undefined || body === null || body === undefined || scrollport === null || scrollport === undefined) return undefined
  return { pane, body, frame, image, scrollport }
}

function positionFor(view: ImageView): CSSProperties {
  const rect = view.body.getBoundingClientRect()
  const right = Math.max(8, window.innerWidth - rect.right + 8)
  return { top: Math.max(8, rect.top + 6), right }
}

/** Render image controls outside the native preview DOM and zoom only its native image frame. */
export function ImageZoomOverlay({ tabId, paneId, address, signal, states, t }: {
  readonly tabId: TabId
  readonly paneId: string
  readonly address: string
  readonly signal: AbortSignal
  readonly states: ImageZoomStore
  readonly t: Translate
}): ReactNode {
  const image = isImageAddress(address)
  const [view, setView] = useState<ImageView | undefined>()
  const [position, setPosition] = useState<CSSProperties>()
  const [fitScale, setFitScale] = useState(1)
  const [state, setState] = useState<ImageState>(() => states.get(tabId))
  const scale = state.mode === 'fit' ? fitScale : state.scale
  const percent = Math.round(scale * 100)

  const update = useCallback((next: ImageState): void => {
    states.set(tabId, next)
    setState(next)
  }, [states, tabId])
  // 坐标未变时返回同一引用，滚动/缩放等高频布局事件不再触发重渲染。
  const applyPosition = useCallback((next: CSSProperties): void => {
    setPosition(current => {
      if (current !== undefined && current.top === next.top && current.right === next.right) return current
      return next
    })
  }, [])
  const fixedScale = useCallback((next: number): void => {
    update({ mode: 'fixed', scale: clamp(next) })
  }, [update])
  const fit = useCallback((): void => { update({ mode: 'fit', scale: 1 }) }, [update])

  useEffect(() => {
    const onAbort = (): void => { states.delete(tabId) }
    signal.addEventListener('abort', onAbort, { once: true })
    return () => { signal.removeEventListener('abort', onAbort) }
  }, [signal, states, tabId])

  useLayoutEffect(() => {
    if (!image) {
      setView(undefined)
      return undefined
    }
    const scan = (): void => {
      const next = selectedTab(tabId) ? findImageView(address, paneId) : undefined
      setView(current => current?.frame === next?.frame ? current : next)
      if (next !== undefined) applyPosition(positionFor(next))
    }
    scan()
    const pane = [...document.querySelectorAll<HTMLElement>('[data-dockkit-pane]')]
      .find(element => element.dataset.dockkitPane === paneId)
    const mutation = typeof MutationObserver === 'undefined' || pane === undefined ? undefined : new MutationObserver(scan)
    if (mutation !== undefined && pane !== undefined) mutation.observe(pane, { childList: true, subtree: true, attributes: true })
    // 滚动/resize 用已认领的 view 就地重算位置，不再每次全文档重找 pane；
    // rAF 把一批滚动事件合并为一次布局读。
    let frame = 0
    const onLayout = (): void => {
      if (frame !== 0) return
      frame = requestAnimationFrame(() => {
        frame = 0
        if (view === undefined || !view.frame.isConnected) return
        applyPosition(positionFor(view))
      })
    }
    window.addEventListener('resize', onLayout)
    window.addEventListener('scroll', onLayout, true)
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame)
      mutation?.disconnect()
      window.removeEventListener('resize', onLayout)
      window.removeEventListener('scroll', onLayout, true)
    }
  }, [address, applyPosition, image, paneId, tabId, view])

  useLayoutEffect(() => {
    if (view === undefined) return undefined
    const measure = (): void => {
      if (view.image.naturalWidth <= 0 || view.image.naturalHeight <= 0) return
      const availableWidth = Math.max(1, view.body.clientWidth - 16)
      const availableHeight = Math.max(1, view.body.clientHeight - 16)
      setFitScale(clamp(Math.min(1, availableWidth / view.image.naturalWidth, availableHeight / view.image.naturalHeight)))
      applyPosition(positionFor(view))
    }
    measure()
    const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure)
    resize?.observe(view.body)
    resize?.observe(view.image)
    return () => { resize?.disconnect() }
  }, [applyPosition, view])

  useLayoutEffect(() => {
    if (view === undefined) return undefined
    const previousZoom = view.frame.style.zoom
    view.frame.style.zoom = String(scale)
    return () => {
      if (view.frame.style.zoom === String(scale)) view.frame.style.zoom = previousZoom
    }
  }, [scale, view])

  useEffect(() => {
    if (view === undefined || signal.aborted) return undefined
    return installImagePan(view.scrollport, view.frame, {
      signal,
      active: () => selectedTab(tabId) && findImageView(address, paneId)?.frame === view.frame,
    })
  }, [address, paneId, signal, tabId, view])

  useEffect(() => {
    if (view === undefined) return undefined
    const body = view.body
    const onWheel = (event: WheelEvent): void => {
      if (!view.frame.contains(event.target as Node) || (!event.ctrlKey && !event.metaKey)) return
      event.preventDefault()
      fixedScale(scale * (event.deltaY < 0 ? STEP : 1 / STEP))
    }
    body.addEventListener('wheel', onWheel, { passive: false })
    return () => { body.removeEventListener('wheel', onWheel) }
  }, [fixedScale, scale, view])

  if (!image || view === undefined || position === undefined) return null
  return createPortal(
    <div
      className="dsh-files-image-toolbar"
      role="toolbar"
      aria-label={t('imageZoomToolbar')}
      style={{ position: 'fixed', ...position }}
      data-files-image-zoom
      // portal 仍在原生页签的 React 事件树中；阻止按下触发拖动及重建。
      onPointerDown={event => { event.stopPropagation() }}
      onClick={event => { event.stopPropagation() }}
    >
      <button type="button" className="dsh-files-image-tool" aria-label={t('imageZoomOut')} title={t('imageZoomOut')} onClick={() => { fixedScale(scale / STEP) }}>−</button>
      <span className="dsh-files-image-percent" aria-live="polite">{t('imageZoomPercent', { value: percent })}</span>
      <button type="button" className="dsh-files-image-tool" aria-label={t('imageZoomIn')} title={t('imageZoomIn')} onClick={() => { fixedScale(scale * STEP) }}>+</button>
      <button type="button" className="dsh-files-image-tool" aria-label={t('imageZoomActual')} title={t('imageZoomActual')} onClick={() => { fixedScale(1) }}>100%</button>
      <button type="button" className="dsh-files-image-tool" aria-label={t('imageZoomFit')} title={t('imageZoomFit')} onClick={fit}>{t('imageZoomFitShort')}</button>
    </div>,
    document.body,
  )
}
