# 会话重命名

`@dsh-kit/dsh-plugin-session-rename` 让**双击会话顶栏的当前会话标题**弹出
「重命名会话」弹窗：输入新标题后回车或点「重命名」，顶栏 crumb 与侧栏行
立即更新。dsh 原生的重命名入口只在侧栏（行双击、右键菜单与
`Cmd/Ctrl+Alt+G` 快捷键），顶栏标题是纯文本、没有任何操作通道。

## 行为与边界

- 重命名走 dsh 原生 `session.rename` 命令（`session-title` 服务）：标题被
  用户显式重命名后即**固定**，后续消息不再触发自动标题生成；控制字符、
  方向控制符与多余空白由宿主规整，规整后为空会被拒绝（`session/title-invalid`），
  错误信息就地显示在弹窗内。成功后 title 投影立即结算，无需等待推送。
- 弹窗与原生侧栏的重命名弹窗同构（标题 + 关闭按钮 + 输入框 + 右下角
  取消/重命名；回车提交、IME 组合中的回车不提交、提交中禁用）；文案与
  原生逐字一致。原生弹窗由 ui-workspace 私有状态驱动，第三方无法直接
  触发，本组件以同一契约自建。
- 只响应**当前会话标题**（crumb 链的最后一节）：祖先 crumb 双击仍是原生
  行为（可点击祖先为按钮，双击只触发两次导航）。空白「新会话」（尚未发过
  消息）不响应，与原生侧栏口径一致；种子草稿用持久标题，未命名时为空。
- macOS 桌面版顶栏属于窗口拖拽区，双击可能同时触发系统窗口缩放，
  属平台行为；Windows/Linux 无此问题。
- 双击识别依据顶栏结构事实（`header[data-window-drag]` 内带
  `crumbCurrent` 类后缀的标题元素，见 [会话](../../docs/dsh/conversation.md)）；
  上游类名后缀变更时双击静默失效，dsh 升级适配需复核。

## 维护与验证

dsh 侧契约（rename 命令链路、顶栏标题 DOM、原生弹窗行为）见
[会话](../../docs/dsh/conversation.md)。

```powershell
pnpm --filter @dsh-kit/dsh-plugin-session-rename test
pnpm --filter @dsh-kit/dsh-plugin-session-rename typecheck
```

修改插件后必须构建并重启 dsh。

## 分发与管理

本包不作为独立安装项分发，而是 `@dsh-kit/dsh-plugin-conversation-enhancements`（会话增强 Bundle）的组件。
停用后，顶栏双击不再弹窗（侧栏的原生重命名入口不受影响）。
可在该 Bundle 详情中单独停用或重新启用本组件；安装、卸载和升级以整个会话增强 Bundle 为单位。
套件安装后本组件默认启用；后续升级以整个套件为单位，并保留 Bundle 与组件的停用状态；卸载后不会自动补回。
需要重装时，在 dsh「添加插件」中填写套件目录 `plugins/suite` 的绝对目录。
