# @dsh-kit/dsh-plugin-user-message-fork

在普通用户消息的操作栏中增加「从此消息重新开始」按钮，并让 fork 出来的新会话排在侧边栏
分组的第一位（仍是普通会话，不置顶）。

## 行为

- 只影子覆盖 dsh 的 `conversation.chat.node` / `user` renderer；`steering` 和其他消息类型仍由 dsh 原生 renderer 负责。
- 消息之前有已完成轮次时：从该轮次之前的最后一个已完成 `turn/end` 创建新的子会话。
  - 新会话继承前置历史，不继承被点击的用户消息和其后续消息。
  - 子会话打开后，被点击的用户消息文本会回填到输入框，用户可以修改后重新发送。
  - 原会话不修改、不删除；它仍保留在会话列表中。
  - 标题沿用 dsh 的 fork 约定递增 `(1)` / `(2)`。
- 首轮消息（之前没有任何已完成轮次）不再禁用：点击后新建一个普通会话（优先落在源会话所在工作区，
  未归组时用相同目录），打开后把这条消息回填进输入框；新会话没有 `parentSession` 血缘，
  与「新会话」按钮创建的会话同形（都用 dsh 默认预设，不继承源会话的 agent preset）。
- 空文本消息、带附件或未知内容块的消息会保留按钮但禁用，避免创建分支时静默丢失内容。
- 如果前一轮暂时不在当前历史窗口，点击时会先按 dsh 的历史分页接口补齐前缀，再创建分支。

## fork 子会话的排序位置

- 全部 fork 入口统一：dsh 原生「在新对话中分叉」、侧边栏右键「分叉会话」、
  本插件的两个按钮，创建出的新会话都会排到**所属工作区分组的第一位**，扁平列表同样前置。
- **不是置顶**：不调用 `uiWorkspace.pinSession`，会话不进 pin 集合，侧边栏不显示图钉，
  用户之后随手拖动或切排序模式都按普通会话处理。
- 做法：dsh 没有「只移动位置」的公共 API——手动模式下分组顺序来自侧边栏自己的浏览器本地
  视图 store（localStorage `dsh.workspace.view.v5` 的 `sessionOrderByAccount`），宿主
  `workspace.insertSessionBefore` 不参与显示。插件从 `sidebar.workspaces` 槽位条目取到同一个
  store，调用它自己的 `pinSessionOrder` 动作（原生置顶按钮写顺序用的就是这个动作），
  只是不写宿主 pin。
- 宿主 attach 帧可能晚于 fork 返回：落位按快照通知重试；分组一直未知时先留在待办，
  超过宽限次数才按「未分组」账户落位，不会把子会话写进「未分组」而让分组里仍然沉底。
- 侧边栏切到「按更新时间」排序时无需落位（fork 子会话的 `createdAt` 是 fork 时刻，
  本来就在最前），此时写入只是保持手动顺序一致。
- 依赖是跨插件内部契据，全部运行时探测：store 缺失、动作改名或 dsh 换实现时只降级为
  「不落位」（一次性 `console.warn`），不影响 fork 本身。

插件使用 dsh 已有的 `ctx.sessions.fork()` / `ctx.sessions.create()` 和 scoped `conversation.input.setDraft()`，
不修改或 fork dsh 源码。dsh 只为已 retain 的会话物化 client scope（`fork()` / `create()` 只登记目录行），
所以草稿回填在打开会话之后执行（契约见 [会话](../../docs/dsh/conversation.md)）。

## 开发

```powershell
pnpm --filter @dsh-kit/dsh-plugin-user-message-fork build
pnpm --filter @dsh-kit/dsh-plugin-user-message-fork test
pnpm --filter @dsh-kit/dsh-plugin-user-message-fork typecheck
node scripts/user-message-fork-check.mjs
```

插件改完后必须重启 dsh；`dsh-kit-web` profile 没有 HMR，刷新页面不会重新加载新的浏览器 bundle。

## 分发与管理

本包不作为独立安装项分发，而是 `@dsh-kit/dsh-plugin-conversation-enhancements`（会话增强 Bundle）的组件。停用后，用户消息的「分叉」按钮消失，原生 fork 也不再自动落到分组第一位；已创建的子会话不受影响。
可在该 Bundle 详情中单独停用或重新启用本组件；安装、卸载和升级以整个会话增强 Bundle 为单位。
套件安装后本组件默认启用；后续升级以整个套件为单位，并保留 Bundle 与组件的停用状态；卸载后不会自动补回。
需要重装时，在 dsh「添加插件」中填写套件目录 `plugins/suite` 的绝对目录。
