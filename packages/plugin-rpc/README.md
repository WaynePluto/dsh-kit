# @dsh-kit/plugin-rpc

kit 组件私有 RPC 通道的共享实现（宿主半注册 + 浏览器半调用），供各组件以依赖形式内联。

- 宿主半：`registerKitChannel(ctx, channel, handler)` 把端点分发函数挂到官方
  `connection.fetch.register` 的 `/api` 精确 Fetch 路由——由官方共享 `/api` 桥统一应用
  Host/Origin 围栏与浏览器认证，不要求 connection 行注入 `webServer`，
  套件层因此不需要覆写官方 connection 行。
- 浏览器半：`callKitChannel<T>(channel, endpoint, payload?, signal?)` 以同源 fetch 调用，
  返回与 dsh `ConnectionRpcResult` 同形的结果；传输失败抛 Error。
- 信封：`POST /api<channel>`，请求体 `{ endpoint, payload }`，响应 `{ ok, value | error }`。

背景：官方 `connection.rpc.handle` 的注册路径要求 connection 行注入 `webServer`，套件曾用
行覆写满足它；官方行覆写在套件启停的 HMR 重组合中会级联重启官方服务，命中 dsh 0.2.0
session-controller 的 file-upload Agent resolver 二次注册竞态。决策记录见
[docs/01-decisions.md](../../docs/01-decisions.md) D16。

本包只在插件构建期被内联，无运行时依赖；`@deepseek-ai/*` 仅作类型引用（devDependencies）。
