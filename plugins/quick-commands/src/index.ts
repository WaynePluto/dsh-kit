/**
 * dsh-kit quick-commands 插件（宿主半）：把指令 JSON 文档挂在 `/quick-commands`
 * kit 通道后。只有两个 endpoint——`get` 读取（文件缺失返回空文档）与 `put`
 * 整份写回（写前全量校验，越界按 bad payload 拒绝）；面板是唯一写方，这里不做业务。
 * 无工具、无设置：快捷指令是人的输入助手，不给模型注册入口。
 *
 * @module @dsh-kit/dsh-plugin-quick-commands
 */

import type { Context } from '@deepseek-ai/cordis'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type { ConnectionRpcResult } from '@deepseek-ai/dsh-client-connection'
import { registerKitChannel } from '@dsh-kit/plugin-rpc'
import {
  BAD_PAYLOAD_CODE, CHANNEL, INTERNAL_CODE, UNKNOWN_ENDPOINT_CODE,
  isQuickCommandDocument, isQuickCommandsEndpoint,
} from './shared.js'
import type { QuickCommandsGetResult, QuickCommandsPutResult } from './shared.js'
import { loadOrEmpty, writeCommands } from './store.js'

export * from './shared.js'
export { commandsPath, loadOrEmpty, readCommands, writeCommands } from './store.js'

/** Cordis 插件名，出现在 dsh 插件树和诊断信息中。 */
export const name = 'dsh-kit-quick-commands'

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
): ConnectionRpcResult<QuickCommandsGetResult | QuickCommandsPutResult> {
  if (!isQuickCommandsEndpoint(endpoint)) {
    return {
      ok: false,
      error: { code: UNKNOWN_ENDPOINT_CODE, message: `unknown endpoint "${endpoint}"`, details: {} },
    }
  }
  try {
    if (endpoint === 'get') {
      return { ok: true, value: loadOrEmpty(home) satisfies QuickCommandsGetResult }
    }
    const document = (payload as { document?: unknown } | null)?.document
    if (!isQuickCommandDocument(document)) {
      return { ok: false, error: { code: BAD_PAYLOAD_CODE, message: '"put" document is malformed or out of bounds', details: {} } }
    }
    writeCommands(home, document)
    return { ok: true, value: { commands: document.commands.length } satisfies QuickCommandsPutResult }
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
  ctx.effect(() => () => void dispose(), 'quick-commands: channel')
}
