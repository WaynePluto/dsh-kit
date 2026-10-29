import { useEffect, useLayoutEffect, useSyncExternalStore, type ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'
import type { SidebarRightTabInfo, TabId } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { ImageZoomOverlay, type ImageZoomStore } from './imageZoomOverlay.js'
import type { PreviewTabs } from './previewTabs.js'
import type { Translate } from './locales.js'

export const TEXT_PREVIEW_ID = '@deepseek-ai/dsh-client-ui-sidebar-documentpreview'
export const TITLE_SLOT = 'sidebar.right.pane.tab.title'

type NativeTitle = (props: Record<string, unknown>) => ReactNode

function isTemporaryTitle(manager: PreviewTabs, tabId: TabId): boolean {
  return manager.isTemporary(tabId)
}

function enhancedTitle(manager: PreviewTabs, entry: StoredEntry, imageStates: ImageZoomStore, translate: Translate): NativeTitle {
  const NativeTitle = entry.component as NativeTitle
  return function EnhancedTitle(rawProps: Record<string, unknown>): ReactNode {
    const props = rawProps as { readonly useTabInfo: () => SidebarRightTabInfo }
    const info = props.useTabInfo()
    const { tab } = info
    const temporary = useSyncExternalStore(
      listener => manager.subscribe(listener),
      () => isTemporaryTitle(manager, tab.id),
      () => false,
    )

    useLayoutEffect(() => {
      manager.observe(info)
    }, [manager, tab.contentId, tab.id, info.panel.id, tab.actions, tab.signal])
    useEffect(() => () => { manager.unobserve(tab.id, tab.signal) }, [manager, tab.id, tab.signal])

    const native = <NativeTitle {...rawProps} />
    const sessionId = sessionIdOfTitle(tab.contentId)
    if (sessionId === undefined) return native
    return (
      <>
        <span
          className={temporary ? 'dsh-files-preview-tab-title dsh-files-preview-tab-title-temporary' : 'dsh-files-preview-tab-title'}
          data-files-preview-tab-title={tab.id}
          data-files-preview-temporary={temporary || undefined}
          onDoubleClick={event => {
            event.preventDefault()
            event.stopPropagation()
            manager.confirm(sessionId, info.panel.id, tab.contentId)
          }}
        >
          {native}
        </span>
        <ImageZoomOverlay
          tabId={tab.id}
          paneId={info.panel.id}
          address={tab.contentId}
          signal={tab.signal}
          states={imageStates}
          t={translate}
        />
      </>
    )
  }
}

function sessionIdOfTitle(address: string): string | undefined {
  const prefix = 'dsh-resource://file/session/'
  if (!address.startsWith(prefix)) return undefined
  const end = address.search(/[?#]/)
  const encoded = address.slice(prefix.length, end === -1 ? undefined : end).split('/')[0]
  if (encoded === undefined || encoded === '') return undefined
  try { return decodeURIComponent(encoded) } catch { return undefined }
}

function nativeTitleEntry(entries: readonly StoredEntry[]): StoredEntry | undefined {
  return entries.find(entry => entry.options.key === TEXT_PREVIEW_ID && (entry.options.priority ?? 0) >= 0)
}

/**
 * Resolve the file tab a double-click landed on, from the dock chip or a
 * floating panel's header. The chip around the title span belongs to dsh's
 * dockkit and never reaches a plugin component, so the title's own handler
 * only covers the icon+text box; this reads dsh's chip markers instead.
 * Every file preview tab renders through the wrapped title above and therefore
 * carries `data-files-preview-tab-title`, including inside a float header.
 */
function chipTabIdOf(target: Element): TabId | undefined {
  const chip = target.closest('[data-dockkit-tab]')
  const marked = chip?.getAttribute('data-dockkit-tab')
    ?? target.closest('[data-dockkit-float-grip]')
      ?.querySelector('[data-files-preview-tab-title]')?.getAttribute('data-files-preview-tab-title')
  return marked as TabId | undefined
}

/**
 * Double-click anywhere on a file tab's chip — the blank padding included —
 * confirms it, matching the title span's own double-click and the tree row's.
 * Chips of non-file tabs resolve to no observation and stay untouched; the
 * chips' nested buttons (close, dock) act on the first click, so a double
 * click must not confirm behind them.
 */
export function installTabChipConfirm(manager: PreviewTabs): () => void {
  const onDoubleClick = (event: MouseEvent): void => {
    const target = event.target instanceof Element ? event.target : undefined
    if (target === undefined || target.closest('button') !== null) return
    const tabId = chipTabIdOf(target)
    if (tabId === undefined) return
    const observation = manager.observation(tabId)
    if (observation === undefined) return
    manager.confirm(observation.sessionId, observation.paneId, observation.contentId)
    event.preventDefault()
    event.stopPropagation()
  }
  document.addEventListener('dblclick', onDoubleClick, true)
  return () => { document.removeEventListener('dblclick', onDoubleClick, true) }
}

function registerWrappedTitle(ctx: Context, entry: StoredEntry, manager: PreviewTabs, imageStates: ImageZoomStore, translate: Translate): () => void {
  const options: Record<string, unknown> = {
    name: TITLE_SLOT,
    key: TEXT_PREVIEW_ID,
    priority: -1,
    ...(entry.locale === undefined ? {} : { locale: entry.locale }),
    ...(entry.store === undefined ? {} : { store: entry.store }),
    ...(entry.inject === undefined ? {} : { inject: entry.inject }),
  }
  const slots = ctx.slots as unknown as {
    register: (options: Record<string, unknown>, component: NativeTitle) => () => void
  }
  return slots.register(options, enhancedTitle(manager, entry, imageStates, translate))
}

/** Shadow only the native text title, keeping its icon/name and tab hook. */
export function installPreviewTitleEnhancement(ctx: Context, manager: PreviewTabs, imageStates: ImageZoomStore, translate: Translate): () => void {
  let native: StoredEntry | undefined
  let disposeWrapped: (() => void) | undefined
  let stopped = false
  const reconcile = (): void => {
    if (stopped) return
    const candidate = nativeTitleEntry(ctx.slots.entries(TITLE_SLOT) as readonly StoredEntry[])
    if (candidate === native) return
    disposeWrapped?.()
    disposeWrapped = undefined
    native = candidate
    if (candidate !== undefined) disposeWrapped = registerWrappedTitle(ctx, candidate, manager, imageStates, translate)
  }
  const disposeSubscription = ctx.slots.subscribe(TITLE_SLOT, reconcile)
  reconcile()
  return () => {
    stopped = true
    disposeSubscription()
    disposeWrapped?.()
    disposeWrapped = undefined
    native = undefined
  }
}
