import type {
  ISidebarRight, PaneId,
} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Below this width the native Sidebar should use one tab at a time, not two cramped panes. */
export const DUAL_PANE_MIN_VIEWPORT = 701

/** Mutable per-tree association with the pane created for document previews. */
export interface PreviewPaneRef {
  current: PaneId | undefined
  pending?: () => void
}

/**
 * What a caller must know about the files tree that originated a navigation:
 * the pane holding it, and whether that tree is still mounted (its tab has not
 * closed). DOM-level enhancement derives both from the live tree root.
 */
export interface PaneNavigationContext {
  readonly panelId: PaneId
  readonly isLive: () => boolean
}

/**
 * The dock kit exposes its live docked panes as data attributes. Keep this DOM
 * read local and defensive: it is only used to reject a stale pane id before
 * calling the public Sidebar navigation face, never to mutate the layout.
 */
export function isLiveDockedPane(paneId: PaneId): boolean {
  if (typeof document === 'undefined') return false
  return [...document.querySelectorAll<HTMLElement>('[data-dockkit-pane]')]
    .some(element => element.dataset.dockkitPane === paneId)
}

/** Return an already-rendered docked pane other than the tree's current pane. */
export function otherLiveDockedPane(current: PaneId): PaneId | undefined {
  if (typeof document === 'undefined') return undefined
  return [...document.querySelectorAll<HTMLElement>('[data-dockkit-pane]')]
    .map(element => element.dataset.dockkitPane as PaneId | undefined)
    .find(pane => pane !== undefined && pane !== current)
}

/**
 * Open one native file resource in the preview pane belonging to a files tree.
 * Returns false when the public split/navigation face cannot safely provide a
 * target; callers then leave the native tree's own click behavior intact.
 */
export function openInPreviewPane(
  sidebar: ISidebarRight,
  nav: PaneNavigationContext,
  sessionId: SessionId,
  workspaceRoot: string,
  absolutePath: string,
  pane: PreviewPaneRef,
  openResource: (paneId: PaneId) => void,
): boolean {
  if (typeof window !== 'undefined' && window.innerWidth < DUAL_PANE_MIN_VIEWPORT) {
    try {
      pane.current = nav.panelId
      openResource(nav.panelId)
      return true
    } catch {
      pane.current = undefined
      return false
    }
  }
  let paneId = pane.current
  let created = false
  if (paneId !== undefined && !isLiveDockedPane(paneId) && pane.pending !== undefined) {
    pane.pending = () => { if (pane.current !== undefined) openResource(pane.current) }
    return true
  }
  if (paneId === undefined || !isLiveDockedPane(paneId)) {
    paneId = otherLiveDockedPane(nav.panelId)
    if (paneId !== undefined) {
      pane.current = paneId
    } else {
      try {
        paneId = sidebar.split(nav.panelId)
      } catch {
        paneId = undefined
      }
      if (paneId === undefined) {
        pane.current = undefined
        return false
      }
      pane.current = paneId
      created = true
    }
  }

  const navigate = (): boolean => {
    try {
      openResource(paneId)
      return true
    } catch {
      // A user can merge/move a pane between the DOM check and this navigation.
      // Forget it and let a later click retry from the current pane.
      pane.current = undefined
      return false
    }
  }
  if (!created) return navigate()
  // split() commits a store intent and mounts the new pane on the next React
  // turn. Keep one replaceable pending intent so a double click or a fast
  // second file click does not split again before that pane is live.
  const pending = (): void => {
    delete pane.pending
    if (nav.isLive() && pane.current === paneId) void navigate()
  }
  pane.pending = pending
  setTimeout(() => {
    if (pane.pending === pending) pending()
  }, 0)
  return true
}
