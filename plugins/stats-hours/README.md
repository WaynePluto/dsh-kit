# 会话统计小时档

`@dsh-kit/dsh-plugin-stats-hours` 增强 dsh 输入框上方的**会话统计**弹窗：
`模型用时`、`工具调用用时`（以及首 token 平均）超过一小时时，
由原生的两档显示（`62分5秒` / `62m5s`）改写为与 turn-tail 用时一致的
三档显示（`1小时2分5秒` / `1h 2m 5s`）。

## 行为与边界

- 只改显示文本：识别弹窗明细行里 ≥1 小时的两档时长并整节点改写，
  不足一小时、无法识别或已是三档的文本保持 dsh 原样；不改任何数据与记账。
- dsh 自家的 turn-tail 用时与运行指示本就支持小时档（`duration.hourUnit`），
  本插件只补会话统计弹窗（StatsPills `formatDuration`）缺的这一档；
  上游将来原生支持后，停用本组件即恢复原生行为。
- 弹窗经 React portal 挂在 `document.body`，插件用 body 级
  MutationObserver 在每个 DOM 变更批次后重新改写（React 重渲染覆盖文本、
  语言切换都会被再次改写）；改写结果不再匹配识别模式，无循环。
- DOM 契约是 `dl[data-session-stats-details] dd`（dsh ui-chat StatsPills 的
  测试钩子）；Token 用量弹窗（`data-session-stats-usage`）不涉及时长，不处理。

## 维护与验证

dsh 侧契约（`data-session-stats-details`、formatDuration 两档与
formatRunDuration 三档的对照）见 [会话](../../docs/dsh/conversation.md)。

```powershell
pnpm --filter @dsh-kit/dsh-plugin-stats-hours test
pnpm --filter @dsh-kit/dsh-plugin-stats-hours typecheck
node scripts/stats-hours-check.mjs
```

修改插件后必须构建并重启 dsh。

## 分发与管理

本包不作为独立安装项分发，而是 `@dsh-kit/dsh-plugin-conversation-enhancements`（会话增强 Bundle）的组件。
停用后，会话统计弹窗恢复原生两档显示。
可在该 Bundle 详情中单独停用或重新启用本组件；安装、卸载和升级以整个会话增强 Bundle 为单位。
套件安装后本组件默认启用；后续升级以整个套件为单位，并保留 Bundle 与组件的停用状态；卸载后不会自动补回。
需要重装时，在 dsh「添加插件」中填写套件目录 `plugins/suite` 的绝对目录。
