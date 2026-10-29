/**
 * dsh-kit task-board 插件（宿主半）：把看板 JSON 文档挂在 `/task-board` kit 通道后。
 * 只有两个 endpoint——`get` 读取（文件缺失时按界面语言播种）与 `put` 整份写回
 * （写前全量校验，越界按 bad payload 拒绝）；页面是唯一写方，乐观更新在浏览器半，
 * 这里不做业务。无工具、无设置：看板是人的面板，不给模型注册 task 入口。
 *
 * @module @dsh-kit/dsh-plugin-task-board
 */

import type { Context } from '@deepseek-ai/cordis'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type { ConnectionRpcResult } from '@deepseek-ai/dsh-client-connection'
import { registerKitChannel } from '@dsh-kit/plugin-rpc'
import {
  BAD_PAYLOAD_CODE, CHANNEL, INTERNAL_CODE, UNKNOWN_ENDPOINT_CODE,
  isBoardDocument, isGetPayload, isTaskBoardEndpoint,
} from './shared.js'
import type { BoardGetResult, BoardPutResult } from './shared.js'
import { loadOrSeedBoard, writeBoard } from './store.js'

export * from './shared.js'
export { boardPath, loadOrSeedBoard, readBoard, writeBoard } from './store.js'

/** Cordis 插件名，出现在 dsh 插件树和诊断信息中。 */
export const name = 'dsh-kit-task-board'

/** 所需 service：`connection` 提供 `/api` 精确路由注册（D16）。 */
export const inject = ['connection']

/**
 * 分发 panel 解码后的 RPC call。
 * @param endpoint - 相对 channel 的 endpoint 名称。
 * @param payload - browser payload。
 * @param home - dsh home；默认实时解析 `$DSH_HOME`，测试注入显式目录。
 * @returns 结果或带错误码的失败。
 */
export function dispatch(
  endpoint: string,
  payload: unknown,
  home: string = resolveDshHome(),
): ConnectionRpcResult<BoardGetResult | BoardPutResult> {
  if (!isTaskBoardEndpoint(endpoint)) {
    return {
      ok: false,
      error: { code: UNKNOWN_ENDPOINT_CODE, message: `unknown endpoint "${endpoint}"`, details: {} },
    }
  }
  try {
    if (endpoint === 'get') {
      if (!isGetPayload(payload)) {
        return { ok: false, error: { code: BAD_PAYLOAD_CODE, message: '"get" payload is malformed', details: {} } }
      }
      const seed = payload?.seed ?? 'zh'
      const loaded = loadOrSeedBoard(home, seed)
      return { ok: true, value: loaded satisfies BoardGetResult }
    }
    const board = (payload as { board?: unknown } | null)?.board
    if (!isBoardDocument(board)) {
      return { ok: false, error: { code: BAD_PAYLOAD_CODE, message: '"put" board is malformed or out of bounds', details: {} } }
    }
    writeBoard(home, board)
    return {
      ok: true,
      value: {
        lists: board.lists.length,
        cards: board.lists.reduce((sum, list) => sum + list.cards.length, 0),
      } satisfies BoardPutResult,
    }
  } catch (error: unknown) {
    return {
      ok: false,
      error: {
        code: INTERNAL_CODE,
        message: error instanceof Error ? error.message : String(error),
        details: {},
      },
    }
  }
}

/**
 * 挂载 panel channel。
 * @param ctx - Host plugin context。
 */
export function apply(ctx: Context): void {
  const dispose = registerKitChannel(
    ctx,
    CHANNEL,
    async (endpoint, payload) => dispatch(endpoint, payload),
  )
  ctx.effect(() => () => void dispose(), 'task-board: channel')
}
