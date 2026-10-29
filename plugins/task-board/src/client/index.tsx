/**
 * browser half：注册「任务看板」全局面板——`main` keyed 主列页面 +
 * `sidebar.panellist` 侧边栏行（order 30，排在插件 0、自动化任务 10、服务 20 之后），
 * 与 services 同款官方双注册，无 DOM 注入。行点击经 `layout.selectPanel` 打开页面；
 * 活动行再点一次回会话由 panel-toggle 组件统一提供。
 *
 * @module @dsh-kit/dsh-plugin-task-board/client
 */

import type { Context } from '@deepseek-ai/cordis'
// 仅类型：引入声明本插件读取的 Context service merge。
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// 仅类型：'main' keyed 槽的声明在 ui-layout；sessions/uiWorkspace/workspaces 是发送动作的官方服务。
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { CHANNEL, SELF_NAMESPACE } from '../shared.js'
import type { BoardDocument } from '../shared.js'
import { TaskBoardPanelIcon } from './TaskBoardPanelIcon.js'
import { TaskBoardPage } from './TaskBoardPage.js'
import { sendTaskToWorkspace } from './send-task.js'
import { en, zh } from './locales.js'
import type { TaskBoardKey } from './locales.js'
import { callKitChannel } from '@dsh-kit/plugin-rpc'

export { TaskBoardPage } from './TaskBoardPage.js'
export type { TaskBoardPageProps } from './TaskBoardPage.js'
export { TaskBoardPanelIcon } from './TaskBoardPanelIcon.js'
export { sendTaskToWorkspace } from './send-task.js'
export type { SendTaskDeps } from './send-task.js'
export type { TaskBoardKey } from './locales.js'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** 本插件的文案命名空间，与包名后缀一致。 */
    'dsh-plugin-task-board': TaskBoardKey
  }
}

/** 本插件的文案 namespace。 */
const NS = SELF_NAMESPACE

/**
 * 面板 id：`main` keyed 槽的 key 与 `sidebar.panellist` 条目的 id 共用同一字符串。
 * 用包名后缀避免与官方面板 key（plugins/schedules）撞名。
 */
export const PANEL_ID = SELF_NAMESPACE as MainPanelId

/** 侧边栏行在面板列表中的顺序：插件（0）、自动化任务（10）、服务（20）之后。 */
const ORDER = 30

/** RPC channel 错误。 */
export class TaskBoardChannelError extends Error {}

/** 所需 service：槽位注册、文案、连接（RPC）与发送动作的官方会话服务。 */
export const inject = ['slots', 'locale', 'connection', 'sessions', 'uiWorkspace', 'workspaces']

/** 调用 `/task-board/<endpoint>` RPC，并将失败转换为 TaskBoardChannelError。 */
const call = async (endpoint: string, payload: object): Promise<unknown> => {
  const result = await callKitChannel(CHANNEL, endpoint, payload)
  if (!result.ok) throw new TaskBoardChannelError(result.error.message)
  return result.value
}

/** 注册文案、RPC channel、主列页面与侧边栏行。 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'task-board: copy dictionaries')
  const t = ctx.locale.bind(NS)

  // 页面注入：工作区清单与发送目标每次现取（全局面板没有会话绑定）。
  const pageActions = {
    onLoad: async (seedLocale: 'zh' | 'en') =>
      await call('get', { seed: seedLocale }) as { board: BoardDocument, seeded: boolean },
    onSave: async (board: BoardDocument) => {
      await call('put', { board })
    },
    workspaces: () => ctx.workspaces.list.getSnapshot().phase === 'ready'
      ? ctx.workspaces.list.getSnapshot().items.map(item => ({
        id: String(item.workspaceId),
        title: item.title === '' ? t('untitledWorkspace') : item.title,
        path: item.path,
      }))
      : [],
    copyText: async (text: string) => await writeClipboard(text),
    sendTask: async (text: string, workspaceId: string | undefined) => {
      await sendTaskToWorkspace(
        {
          sessions: {
            create: async options =>
              await ctx.sessions.create(options === undefined ? {} : { workspaceId: options.workspaceId }) as SessionId,
            scope: id => ctx.sessions.scope(id) as never,
          },
          uiWorkspace: {
            openSession: id => { ctx.uiWorkspace.openSession(id) },
          },
        },
        text,
        workspaceId,
      )
    },
  }

  // 先注册主列页面再注册侧边栏行：行点击的 layout.selectPanel 要求 key 已注册，
  // 顺序与官方 ui-plugin-manager/ui-schedule/services 一致。
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: NS,
    inject: () => pageActions,
  }, TaskBoardPage))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: ORDER,
    locale: NS,
    label: () => t('panel'),
  }, TaskBoardPanelIcon))
}

/** 保持 namespace 可供检查 package bundle 的 consumer 使用。 */
export const namespace = SELF_NAMESPACE
