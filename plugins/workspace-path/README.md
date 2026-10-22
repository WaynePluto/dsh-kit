# 复制工作区路径

`@dsh-kit/dsh-plugin-workspace-path` 在工作区列表每个工作区标题行 hover 出现的 `···`
菜单里增加「复制路径」项，点击后复制该工作区的完整目录路径。

dsh 原生的路径复制在工作区行的 hover 卡片上（悬停约 0.8 秒后的复制按钮）；
本组件把同一数据（官方 `workspaces` 服务的 `WorkspaceView.path`）带进菜单，
省去等待 hover 卡片。

## 行为

- 菜单项插在「重命名」与「删除」之间，危险操作（删除）保持收尾的原生次序；
  悬停菜单项可见将要复制的完整路径。
- 复制使用官方 `writeClipboard`；菜单关闭走与原生行相同的 Escape 语义。
- 注入的行是标准 `MenuItemButton`（external 复用页面样式），自动加入菜单的方向键导航。
- 未分组桶没有 `···` 菜单，不受影响；空状态选择器（WorkspacePicker）是另一套界面，不注入。

## 实现边界

dsh 只为会话行菜单提供槽位（`sidebar.workspaces.session.menu.item`）；工作区行菜单
是 ui-workspace 私有的 rename/delete 两行，没有插件接缝。因此本组件按
deepseek-official-switch 卡片操作区的同款结构化注入工作：捕获工作区行
（`[data-row-key="workspace:<id>"]`）的点击做归因，等 Menu portal（`[role="menu"]`）
出现在 body 后在其 viewport 挂载。上游依据：
`packages/client/ui-workspace/src/client/rows/Rows.tsx`（菜单构造与 data-row-key）、
`packages/client/ui-primitives/src/Menu.tsx`（portal 结构与 DOM 键盘走查）。
类名/文案结构变化会静默失效，升级需按 dsh-upgrade 流程复核。

## 维护与验证

```powershell
pnpm --filter @dsh-kit/dsh-plugin-workspace-path test
```

纯浏览器半、无宿主服务；修改后构建并重启 dsh 实机验收（深浅主题与中英文界面）。

## 分发与管理

本包不作为独立安装项分发，而是 `@dsh-kit/dsh-plugin-conversation-enhancements`（会话增强 Bundle）
的组件。停用后菜单项消失，不影响原生 rename/delete。
可在该 Bundle 详情中单独停用或重新启用本组件；安装、卸载和升级以整个 Bundle 为单位。
套件安装后本组件默认启用；后续升级以整个套件为单位，并保留 Bundle 与组件的停用状态。
需要重装时，在 dsh「添加插件」中填写套件目录 `plugins/suite` 的绝对目录。
