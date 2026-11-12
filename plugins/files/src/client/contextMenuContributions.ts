/**
 * 原生右键菜单贡献（dsh 0.2.2 起 `ctx.contextMenus` 对外部插件开放）。
 *
 * 树行右键完全使用原生菜单（ui-open-in-app 的打开/显示/复制路径、ui-file-actions
 * 的另存为等），插件只补充原生没有的两项：复制相对路径（文件与目录行）和
 * 查看 Git 变更（仅文件行）。贡献按 order 追加在原生组之后，首项带分隔线。
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-context-menu/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { Translate } from './locales.js'
import { workspaceRelativePath } from './treePath.js'

/** 排在原生 open-in-app（100）与 file-actions（200）两组之后。 */
const ORDER = 300

export interface ContextMenuContributionInputs {
  /** 打开该文件（工作区相对 slash 路径）的 Git 变更页签。 */
  readonly openGitReview: (sessionId: SessionId, path: string) => void
  readonly t: Translate
}

/**
 * 注册两个目标族的菜单贡献，返回撤销函数。
 * @param ctx - 插件上下文；读取 `ctx.sessions.list` 与 `ctx.contextMenus`。
 * @param inputs - Git 变更入口与文案。
 * @returns unregister，交给调用方的 effect 生命周期。
 */
export function installContextMenuContributions(ctx: Context, inputs: ContextMenuContributionInputs): () => void {
  const { openGitReview, t } = inputs

  // 菜单目标只携带 sessionId 与路径；相对路径以当前会话工作区根为基准，
  // 会话已切走（无 cwd）或路径越出根时放弃，不猜路径。
  const relativeOf = (sessionId: SessionId, path: string): string | undefined => {
    const cwd = ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd
    if (cwd === undefined) return undefined
    const relative = workspaceRelativePath(cwd, path)
    return relative === '' ? undefined : relative
  }

  const copyRelative = async (relative: string): Promise<void> => {
    await navigator.clipboard.writeText(relative)
    ctx.contextMenus.notify(t('copied'), true)
  }

  const disposeFile = ctx.contextMenus.register({
    id: 'dsh-kit-files.file', target: 'file', order: ORDER,
    resolve: ({ sessionId, path }) => {
      const relative = relativeOf(sessionId, path)
      if (relative === undefined) return []
      return [
        { id: 'git-review', label: t('gitReviewMenu'), separatorBefore: true, run: () => { openGitReview(sessionId, relative) } },
        { id: 'copy-relative-path', label: t('copyRelativePath'), failureLabel: t('copyFailed'),
          run: async () => { await copyRelative(relative) } },
      ]
    },
  })
  const disposeDirectory = ctx.contextMenus.register({
    id: 'dsh-kit-files.directory', target: 'directory', order: ORDER,
    resolve: ({ sessionId, path }) => {
      const relative = relativeOf(sessionId, path)
      if (relative === undefined) return []
      return [
        { id: 'copy-relative-path', label: t('copyRelativePath'), separatorBefore: true, failureLabel: t('copyFailed'),
          run: async () => { await copyRelative(relative) } },
      ]
    },
  })
  return () => {
    disposeDirectory()
    disposeFile()
  }
}
