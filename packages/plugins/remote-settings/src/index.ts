import type { Context } from '@deepseek-ai/cordis'
import type { IndexInjection } from '@deepseek-ai/dsh-host-webserver'
import { CHANNEL } from './shared.js'
import { dispatchWorkspaceDirectory } from './workspace-directory.js'

// 保留拆分前的插件身份；Windows 目录打开兼容不改变目标机语义。
export const name = 'dsh-remote-remote-privileged'
export const inject = ['webServer', 'connection']
export const TRANSPORT_GLOBAL = '__DSH_TRANSPORT__'

export function transportInjection(): IndexInjection {
  // __DSH_TRANSPORT__ 的 dsh 契约：只有自组装 transport 的壳可以设置，被服务的页面
  // 绝不携带（见 dsh client-connection 源码注释）。静态 global 会抢占官方桌面
  // （dsh-app:// 自定义协议页）的注入语义，使页面 /api/WS 永久重连失败
  // （2026-10-09 官方桌面实测二分确认）。改为运行时条件脚本：只在经 HTTP(S)
  // 服务的页面（relay 远程入口、局域网直连）注入 ownsHost；自定义协议页跳过
  // （壳自己负责），本机 loopback 直连页的 location.hostname 本就是 loopback。
  return {
    kind: 'script',
    placement: 'head',
    text: "if (location.protocol === 'https:' || location.protocol === 'http:') { window.__DSH_TRANSPORT__ = Object.assign({}, window.__DSH_TRANSPORT__, { ownsHost: true }) }",
  }
}

export function installWindowsOpenCompatibility(
  ctx: Context, platform: NodeJS.Platform = process.platform,
): void {
  if (platform !== 'win32') return
  // dsh 0.1.7 移除了 settings/openAgentPresetDirectory RPC（预设改为 profile YAML 声明），
  // 预设目录拦截随之删除；这里只保留 Open In… Explorer 的立即返回与置前通道。
  const dispose = ctx.connection.rpc.handle(CHANNEL,
    async (endpoint, payload, signal) => await dispatchWorkspaceDirectory(endpoint, payload, signal))
  ctx.effect(() => () => { void dispose() }, 'remote-settings: visible Windows workspace opener')
}

export function apply(ctx: Context): void {
  ctx.on('webserver/index-inject', (table: IndexInjection[]) => {
    table.push(transportInjection())
  })
  installWindowsOpenCompatibility(ctx)
}
