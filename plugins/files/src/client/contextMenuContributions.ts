/**
 * 原生右键菜单贡献（dsh 0.2.2 起 `ctx.contextMenus` 对外部插件开放）。
 *
 * 树行右键完全使用原生菜单（ui-open-in-app 的打开/显示/复制路径、ui-file-actions
 * 的另存为等），插件只补充：复制完整路径（文件与目录行，2026-11-13 恢复——官方
 * ui-open-in-app 的目录复制用 `resolveWorkspacePath` 拼接不归一相对段的分隔符，
 * Windows 下产出 `/` 与 `\` 混排路径，上游修复后撤下本项）、复制相对路径
 * （文件与目录行）和查看 Git 变更（仅文件行）。贡献按 order 追加在原生组之后，
 * 首项带分隔线。
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-context-menu/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { Translate } from './locales.js'
import { absolutePathOf, workspaceRelativePath } from './treePath.js'

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

  // 菜单目标只携带 sessionId 与路径；以当前会话工作区根为基准换算。
  // relative 为 undefined（无 cwd 或路径越出根）时不贡献复制项；
  // relative 为 ''（根目录行）只提供完整路径（即根本身），不提供相对路径。
  const targetOf = (sessionId: SessionId, path: string)
    : { cwd: string, relative: string } | undefined => {
    const cwd = ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd
    if (cwd === undefined) return undefined
    const relative = workspaceRelativePath(cwd, path)
    return relative === undefined ? undefined : { cwd, relative }
  }

  const copy = async (value: string): Promise<void> => {
    await navigator.clipboard.writeText(value)
    ctx.contextMenus.notify(t('copied'), true)
  }

  const copyItems = (cwd: string, relative: string) => [
    { id: 'copy-absolute-path', label: t('copyAbsolutePath'), failureLabel: t('copyFailed'),
      run: async () => { await copy(absolutePathOf(cwd, relative)) } },
    ...(relative === '' ? [] : [{
      id: 'copy-relative-path', label: t('copyRelativePath'), failureLabel: t('copyFailed'),
      run: async () => { await copy(relative) },
    }]),
  ]

  const disposeFile = ctx.contextMenus.register({
    id: 'dsh-kit-files.file', target: 'file', order: ORDER,
    resolve: ({ sessionId, path }) => {
      const target = targetOf(sessionId, path)
      if (target === undefined || target.relative === '') return []
      return [
        { id: 'git-review', label: t('gitReviewMenu'), separatorBefore: true, run: () => { openGitReview(sessionId, target.relative) } },
        ...copyItems(target.cwd, target.relative),
      ]
    },
  })
  const disposeDirectory = ctx.contextMenus.register({
    id: 'dsh-kit-files.directory', target: 'directory', order: ORDER,
    resolve: ({ sessionId, path }) => {
      const target = targetOf(sessionId, path)
      if (target === undefined) return []
      return copyItems(target.cwd, target.relative).map((item, index) =>
        index === 0 ? { ...item, separatorBefore: true } : item)
    },
  })
  return () => {
    disposeDirectory()
    disposeFile()
  }
}
