import { afterEach, describe, expect, it, vi } from 'vitest'
import { openInPreviewPane, type PreviewPaneRef } from './paneNavigation.js'

afterEach(() => { vi.unstubAllGlobals() })

describe('openInPreviewPane', () => {
  it('lets the native tab navigation handle narrow viewports', () => {
    vi.stubGlobal('window', { innerWidth: 600 })
    const split = vi.fn()
    const openResource = vi.fn()
    const pane: PreviewPaneRef = { current: undefined }
    const sidebar = { split } as never
    const nav = { panelId: 'pane1', isLive: () => true }
    expect(openInPreviewPane(sidebar, nav, 'session' as never, 'C:\\work', 'C:\\work\\a.md', pane, openResource)).toBe(true)
    expect(split).not.toHaveBeenCalled()
    expect(openResource).toHaveBeenCalledWith('pane1')
    expect(pane.current).toBe('pane1')
  })

  it('splits a second pane when the viewport allows and none is live', async () => {
    vi.stubGlobal('window', { innerWidth: 1200 })
    const split = vi.fn(() => 'pane2')
    const openResource = vi.fn()
    const pane: PreviewPaneRef = { current: undefined }
    const sidebar = { split } as never
    const nav = { panelId: 'pane1', isLive: () => true }
    expect(openInPreviewPane(sidebar, nav, 'session' as never, 'C:\\work', 'C:\\work\\a.md', pane, openResource)).toBe(true)
    expect(split).toHaveBeenCalledWith('pane1')
    await new Promise(resolve => { setTimeout(resolve, 0) })
    expect(openResource).toHaveBeenCalledWith('pane2')
  })
})
