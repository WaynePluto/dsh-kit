# `@dsh-kit/dsh-plugin-turn-retry`

一次网络抖动不该让你重新打一遍字；按了停止之后想接着做，也不该。

## 它解决什么

dsh 自己已经会自动退避重试失败的模型请求。自动重试最终放弃后，一轮会以
`turn/end {kind:'error'}` 收尾；手动停止则留下 `aborted{user}`。原版 dsh 在这些结局后
都要求用户再发一条消息。

本插件有两层：

- **在环自动重试**（固定行为）：见下节。
- **事后手动重试**：入口是输入框上方的持久重试栏，显示失败原因与重试或继续操作。

## 在环自动重试

对失败中的模型请求直接介入 `agent/request-error`，两条规则：

1. **未知错误重试一次**：`PI_AI_ERROR` 是 pi-ai 适配器无法分类的上游错误（典型：中转
   返回不带状态码的非标准文案，如 "all accounts are temporarily unavailable"）。官方
   llm-retry 对它直接放弃；本插件在同一 turn/step 内自动重试一次（等待 2 秒），仍失败
   则照常失败、交给重试栏。
2. **官方瞬态重试封顶 2 次**：dsh 默认对 EMPTY_RESPONSE、RATE_LIMIT、SERVER、TIMEOUT、
   TRANSPORT 最多退避重试 5 次；本插件把它收紧为 2 次，失败更快落到重试栏交还给你。
   `mode:'always'` 或你在 provider 里显式配置过的可重试码不受影响。

两条规则都不追加会话事件；封顶计数来自折叠官方 `llm/retry` 事件的投影，未知错误计数
只在内存中（重启后同一失败会多重试一次）。

## 工作方式

宿主半把最近一次可恢复的 `turn/end` 折进 session projection `turnRetry`。浏览器半
在 `conversation.input.dock` 渲染：

- `error` →「上一轮失败了」+ `[查看原因]` + `[重试]`；点击「查看原因」在弹窗中阅读错误详情
- `aborted{user}` →「上一轮被你停止了」+ `[继续]`
- `aborted{disposed|legacy}` / `interrupted` →「上一轮没有跑完」+ `[继续]`
- `aborted{hook|parent}` 与正常结局 → 不显示

投影来自会话日志，所以刷新、换设备或稍后回来仍然可见。

## 排队消息保护

`agent.followup()` 会把重试通知追加到 `nextTurn` 队尾。失败后如果已有用户消息排队，
直接调用它会先发送最老的排队消息。

插件因此在宿主侧 fail closed：只要 `nextTurn` 非空，就返回 `pending-input`。
这个分支：

- 不调用 `followup()`，不唤醒 agent；
- 不增删、不重排 inbox；
- 不产生新的 turn 或 `user/message`；
- 保留失败投影，用户处理完队列后仍可再次点击重试。

## 事后重试的消息形状

dsh 没有“不追加 UserMessage 就重新推理”的公开入口。按钮会开一个新 turn，并带一条
plugin 溯源、`form:'notice'` 的短通知；会话里显示为折叠 context 行，不是用户气泡。
原 prompt 已经在日志里，插件不会重复发送。

供应商错误在投影里最多保留 2000 字，给模型的通知最多 300 字。错误详情不常驻占用 dock 高度，
点击「查看原因」后在 dsh 的 `Modal` 中阅读；弹窗尺寸与服务插件日志一致，内容可独立纵向滚动，超长行可横向滚动。
弹窗可拖动、八向调整，右上角关闭按钮旁有全屏开关：全屏时拉满视口并禁止拖动/调整，再次点击恢复原尺寸与位置。
横幅同时复用 dsh 的 composer 宽度轴，不会撑破消息区。

## 两半与接缝

| 部分 | 实现 |
|---|---|
| 宿主半 | `src/index.ts`：projection、inbox guard、RPC；`src/auto-retry.ts`：在环自动重试 |
| 浏览器半 | `src/client/`：输入框上方的重试栏 |
| 状态接缝 | session projection `turnRetry`、封顶投影 `turnRetryAutoCap`（仅宿主内读） |
| 动作接缝 | 认证通道 `/turn-retry/retry`；`agent/request-error` waterfall（prepend） |

投影形状仍是 failed/stopped/null，`stateVersion` 保持 2。

## 验证

```powershell
pnpm --filter @dsh-kit/dsh-plugin-turn-retry test
pnpm --filter @dsh-kit/dsh-plugin-turn-retry typecheck
pnpm --filter @dsh-kit/dsh-plugin-turn-retry build
node scripts/turn-retry-check.mjs
```

## 分发与管理

本包不作为独立安装项分发，而是 `@dsh-kit/dsh-plugin-conversation-enhancements`（会话增强 Bundle）的组件。停用后，在环自动重试（未知错误一次、封顶 2 次）与失败重试、停止继续横幅、排队消息保护一并消失；dsh 自带的自动重试（默认 5 次）恢复原样。
可在该 Bundle 详情中单独停用或重新启用本组件；安装、卸载和升级以整个会话增强 Bundle 为单位。
套件安装后本组件默认启用；后续升级以整个套件为单位，并保留 Bundle 与组件的停用状态；卸载后不会自动补回。
需要重装时，在 dsh「添加插件」中填写套件目录 `plugins/suite` 的绝对目录。
