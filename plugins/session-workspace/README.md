# 会话工作区显示

`@dsh-kit/dsh-plugin-session-workspace` 在输入框下方的统计栏（「N 轮 N 步 · tok/s」一行）最左
增加一个工作区 pill：文件夹图标 + 当前会话工作区的末级目录名（如 `dsh-kit`），悬停显示完整
路径，点击复制完整路径并短暂显示「已复制」。

## 行为

- 显示位置在统计栏最左（官方 `conversation.composer.dock` list 槽位的 `order: -1` 条目，
  位于原生 activity/usage 两个 pill 之前）；整条统计栏居中排版，pill 随之参与居中。
- 数据取自 dsh sessions 服务的会话列表（`byId[sessionId].cwd`），与原生工作区悬停卡同源；
  会话还没有 cwd 时不渲染，切换会话随槽位作用域自动刷新。
- 点击复制走浏览器剪贴板（`navigator.clipboard`）；部分浏览器在普通 HTTP 下会拒绝剪贴板
  访问，此时不改变标签，悬停 title 的完整路径始终可看。
- 样式逐条复刻原生统计 pill 契约（12px 次级字号、`1px 8px` 圆角、tertiary 静息色、hover
  走 `--dsw-alias-interactive-bg-hover`），深浅主题随 dsh token 自动跟随；图标用原生
  `IconFolderCloseMedium`（dsh 工作区行的同族闭合文件夹字形）。

## 实现边界

统计栏是 dsh 原生 StatsPills，不在本套件内；官方把统计栏开放为
`conversation.composer.dock` list 槽位（session 作用域），源码注释明示插件可按 id 新增
pill。本组件注册一个新 id 条目，不覆写任何官方行（D16）。组件从槽位标准props 直接收到
`sessionId` 与 `useSessions`，全程浏览器半，无宿主服务、无 RPC。
上游依据：`packages/client/ui-chat/src/client/{apply.ts,chat/StatsPills.tsx}`、
`packages/client/ui-conversation/src/client/skeleton/InputBar.tsx`。

## 维护与验证

```powershell
pnpm --filter @dsh-kit/dsh-plugin-session-workspace test
```

纯浏览器半、无宿主服务；浏览器半构建落盘后由官方 client-hmr 自动热替换（组件行已装载时），
宿主半与装载层（新组件行）首次接入必须重启 dsh。实机验收深浅主题、切会话刷新、点击复制。

## 分发与管理

本包不作为独立安装项分发，而是 `@dsh-kit/dsh-plugin-conversation-enhancements`（会话增强 Bundle）
的组件。停用后 pill 消失，原生统计栏不受影响。
可在该 Bundle 详情中单独停用或重新启用本组件；安装、卸载和升级以整个 Bundle 为单位。
套件安装后本组件默认启用；后续升级以整个套件为单位，并保留 Bundle 与组件的停用状态。
需要重装时，在 dsh「添加插件」中填写套件目录 `plugins/suite` 的绝对目录。
