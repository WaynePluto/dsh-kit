# 任务通知

`@dsh-kit/dsh-plugin-notify` 在运行 dsh 的 Windows 机器上发送常驻桌面通知。
通知不会发送到远程浏览器或手机；非 Windows 平台不发送系统通知。

## 使用

在 **设置 → 通知** 中配置两个默认开启的选项：

| 选项 | 时机 |
|---|---|
| 一轮跑完时通知我 | Agent 停下等待输入，700ms 后仍为 idle |
| 有东西在等我回答时也通知我 | 审批或用户提问持续等待 3 秒 |

设置存入 dsh-plugin-notify。通知包含项目、可用的会话标题与完成、失败、被拦下等结果；
用户手动停止结束的轮次不通知（停止本身就是回应），hook 中断、崩溃恢复等其他截断仍照常通知。
使用“发一条测试通知”确认 Windows 实际显示；没有通知时检查专注助手、系统通知权限和应用注册。

点击通知卡片（不是“关闭”按钮）会把官方 dsh 桌面版带到前台：脚本每次发送前现查桌面协议
（`HKCU/HKLM …Classes\dsh\shell\open\command`）是否注册，注册了才在 toast 上声明
`launch="dsh://open"` + `activationType="protocol"`，由 Windows Shell 直接执行协议 URL 唤起桌面版，
不依赖发送进程存活。未安装或从未启动过桌面版时不声明 launch，点击只是关闭通知。

## 限制

- 一次 turn/end 不一定代表整个任务结束，因此使用 Agent idle 而不是逐轮通知。
- 默认 YOLO 自动处理权限请求，仍需人工回答的用户提问可以触发等待通知。
- 通知只在运行 dsh 的 Windows 机器弹出，浏览器与手机看不到。
- 新会话第一次完成时标题可能尚未生成。
- Windows 通知 API 返回成功不保证 AUMID 对应通知真的显示，测试按钮不能省略。
- 点击聚焦依赖官方桌面版的 `dsh://` 协议注册（桌面版至少运行过一次）；从源码跑的桌面壳
  （未设 `DSH_DESKTOP_DEV_APP=1`）不注册协议，此时点击只是关闭。
- 文案通过环境变量传入固定 PowerShell 脚本，不拼接进可执行代码。

## 维护

通知时序见 [会话与消息](../../docs/dsh/conversation.md)，图标约定见 [插件机制](../../docs/dsh/plugins.md)。

```powershell
pnpm --filter @dsh-kit/dsh-plugin-notify test
node scripts/notify-check.mjs
```

冒烟会实际尝试弹出通知。修改插件后必须构建并重启 dsh。

## 分发与管理

本包不作为独立安装项分发，而是 `@dsh-kit/dsh-plugin-conversation-enhancements`（会话增强 Bundle）的组件。停用后，Windows 桌面任务通知消失。
可在该 Bundle 详情中单独停用或重新启用本组件；安装、卸载和升级以整个会话增强 Bundle 为单位。
套件安装后本组件默认启用；后续升级以整个套件为单位，并保留 Bundle 与组件的停用状态；卸载后不会自动补回。
需要重装时，在 dsh「添加插件」中填写套件目录 `plugins/suite` 的绝对目录。
