import type { Context } from '@deepseek-ai/cordis'
// 仅类型：激活 browser half 使用的 locale、slots、session、connection 与 Sidebar merge。
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { FilesEndpoint, FilesSnapshot } from '../shared.js'
import { en, NS, zh, type FilesKey } from './locales.js'
import { ImageZoomStore } from './imageZoomOverlay.js'
import { installNativeFilesEnhancement } from './nativeFilesAdapter.js'
import { installPreviewTitleEnhancement } from './previewTabTitle.js'
import { PreviewTabs } from './previewTabs.js'
import { installTabContextActions } from './tabContextActions.js'
import {
  GIT_REVIEW_TAB_ID, GitReviewData, GitReviewTab, gitReviewAddress, gitReviewTabDefinition, createGitReviewStore,
} from './gitReviewTab.js'
import type { GitReviewInjected } from './gitReviewTab.js'
import { installStyles } from './styles.js'
import { callKitChannel } from '@dsh-kit/plugin-rpc'

export { en, zh, NS } from './locales.js'
export type { FilesKey } from './locales.js'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'dsh-plugin-files': FilesKey }
}

class FilesChannelError extends Error {
  constructor(message: string) { super(message); this.name = 'FilesChannelError' }
}

export const inject = ['slots', 'locale', 'connection', 'sidebarRight', 'sidebarRightTabs']

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'files: copy dictionaries')
  ctx.effect(installStyles, 'files: view styles')
  const t = ctx.locale.bind(NS)
  const call = async <T,>(endpoint: FilesEndpoint, payload: object): Promise<T> => {
    const result = await callKitChannel('/files', endpoint, payload)
    if (!result.ok) throw new FilesChannelError(result.error.message)
    return result.value as T
  }
  const loadGit = async (sessionId: SessionId, _signal: AbortSignal): Promise<FilesSnapshot> =>
    await call<FilesSnapshot>('snapshot', { sessionId: String(sessionId) })
  const previewTabs = new PreviewTabs()
  const imageStates = new ImageZoomStore()
  // Git review 面板：私有通道的 review/diff 端点 + 右键菜单到页签的导航。
  const gitReviewData = new GitReviewData((endpoint, payload) => call(endpoint, payload))
  ctx.on('connection/reset', () => { gitReviewData.reset() })
  const openGitReview = (sessionId: SessionId, path: string): void => {
    ctx.sidebarRight.openResource(gitReviewAddress(sessionId), { params: { path } })
  }
  ctx.effect(() => {
    const disposeFiles = installNativeFilesEnhancement(ctx, ctx.sidebarRight, loadGit, t, previewTabs, openGitReview)
    const disposeTitle = installPreviewTitleEnhancement(ctx, previewTabs, imageStates, t)
    const disposeMenu = installTabContextActions(ctx, ctx.sidebarRight, t)
    return () => {
      disposeMenu()
      imageStates.clear()
      disposeTitle()
      disposeFiles()
      previewTabs.dispose()
    }
  }, 'files: native files enhancement')
  ctx.effect(() => ctx.sidebarRightTabs.register(gitReviewTabDefinition(t)), 'files: git review tab type')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    {
      name: 'sidebar.right.pane.tab',
      key: GIT_REVIEW_TAB_ID,
      locale: NS,
      store: createGitReviewStore(),
      inject: (): GitReviewInjected => ({
        hooks: { summary: gitReviewData.summarySource, diff: gitReviewData.diffSource },
        reloadSummary: sessionId => gitReviewData.reloadSummary(sessionId),
        loadDiff: (sessionId, path) => gitReviewData.loadDiff(sessionId, path),
      }),
    },
    GitReviewTab,
  )), 'files: git review tab body')
}
