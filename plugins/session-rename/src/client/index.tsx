/**
 * browser half：双击会话顶栏的当前会话标题，弹窗重命名。
 *
 * dsh 原生的重命名入口在侧栏（行双击/右键菜单/Cmd+Alt+G），顶栏标题是纯文本
 * span、没有重命名通道；原生弹窗（`shell.overlay` 的 `workspace.session-rename`）
 * 由 ui-workspace 私有 store 驱动，第三方无法触发。本组件以同一契约自建弹窗：
 * 双击识别用 DOM 结构事实（见 header-target.ts），重命名走原生
 * `sessions.using(... binding.session.rename)`——成功后 title 投影立即结算，
 * 顶栏 crumb 与侧栏行同帧更新，用户重命名会 pin 标题、自动生成停止调度。
 *
 * @module @dsh-kit/dsh-plugin-session-rename/client
 */

import type { Context } from '@deepseek-ai/cordis'
// 仅类型 import：激活本插件使用的 locale、slots 服务、shell.overlay 槽声明、
// uiSession 与 sessions 的 Context 合并。
// oxlint-disable-next-line unicorn/require-module-specifiers -- 激活 locale Context 合并
import type {} from '@deepseek-ai/dsh-client-locale/client'
// oxlint-disable-next-line unicorn/require-module-specifiers -- 激活 shell.overlay SlotMap 合并
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// oxlint-disable-next-line unicorn/require-module-specifiers -- 激活 renderer/slots Context 合并
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// oxlint-disable-next-line unicorn/require-module-specifiers -- 激活 uiSession Context 合并
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// oxlint-disable-next-line unicorn/require-module-specifiers -- 激活 sessions Context 与引用来源合并
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createHeaderTitleDoubleClickListener } from './double-click.js'
import type { SessionRenameRequest } from './rename.js'
import { SessionRenameDialog, type SessionRenameDialogInjected } from './SessionRenameDialog.js'
import { installSessionRenameStyles } from './styles.js'
import { en, zh, type SessionRenameKey } from './locales.js'

export { isConversationTitleTarget } from './header-target.js'
export { createHeaderTitleDoubleClickListener, type HeaderTitleDoubleClickFacts } from './double-click.js'
export { renameRequestFromSummary, type SessionRenameRequest, type SessionSummaryLike } from './rename.js'
export { SessionRenameDialog, type SessionRenameDialogInjected, type SessionRenameDialogProps } from './SessionRenameDialog.js'
export { installSessionRenameStyles } from './styles.js'
export type { SessionRenameKey } from './locales.js'

/** 让 locale service 可以使用本包文案。 */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'dsh-plugin-session-rename': SessionRenameKey
  }
}

/** 本插件自己的会话引用来源：弹窗确认期间短暂 retain，计数独立于 mainView。 */
declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    sessionRenameDialog: unknown
  }
}

/** 本插件拥有的文案 namespace。 */
const NAMESPACE = 'dsh-plugin-session-rename'

/** 所需 service：槽位注册、文案、会话目录与当前会话绑定。 */
export const inject = ['slots', 'locale', 'sessions', 'uiSession']

/** 注册文案、弹窗 overlay 条目与顶栏双击监听。 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NAMESPACE, { zh, en }), 'session-rename: copy dictionaries')
  ctx.effect(
    () => installSessionRenameStyles(typeof document === 'undefined' ? null : document),
    'session-rename: dialog styles',
  )

  const renameRequest = createSnapshotStore<SessionRenameRequest | null>(null)
  const renameSession: SessionRenameDialogInjected['renameSession'] = async (sessionId, title) => {
    const result = await ctx.sessions.using(
      sessionId,
      { source: 'sessionRenameDialog' },
      reference => reference.binding.session.rename(title),
    )
    if (!result.ok) throw new Error(result.error.message)
  }

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: NAMESPACE,
    locale: NAMESPACE,
    inject: (): SessionRenameDialogInjected => ({
      hooks: { renameRequest },
      settleSessionRename: () => { renameRequest.set(null) },
      renameSession,
    }),
  }, SessionRenameDialog))

  if (typeof document === 'undefined') return
  const onDoubleClick = createHeaderTitleDoubleClickListener({
    currentSessionId: () => {
      const key = ctx.uiSession.adapter.current.getSnapshot().key
      return key === undefined ? undefined : (key as SessionId)
    },
    summaryOf: sessionId => ctx.sessions.list.getSnapshot().byId[sessionId],
    requestRename: request => { renameRequest.set(request) },
  })
  ctx.effect(() => {
    document.addEventListener('dblclick', onDoubleClick, { capture: true })
    return () => { document.removeEventListener('dblclick', onDoubleClick, { capture: true }) }
  }, 'session-rename: header title double-click')
}
