// dshRemoteTrust 服务：在 connection 行的 trustedHosts 表达式求值前提供
// 本机应信任的 authority 集合。它不能注入 connection（会与 connection 行的
// 配置表达式互相等待），token 写入由 index.ts 完成。
import { computeTrust, defaultStationHome } from './shared.js'

export function apply(ctx: {
  provide: (name: string, value: unknown) => void
  [key: string]: unknown
}): void {
  ctx.provide('dshRemoteTrust', computeTrust(defaultStationHome()))
}
