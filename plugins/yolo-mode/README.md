# @dsh-kit/dsh-plugin-yolo-mode

固定的全局 YOLO 模式插件。它只加载 Host 半，没有浏览器 bundle。

## 行为

套件安装后本插件**默认停用**：dsh 原生权限预设与权限选择器保持原样。
在插件页打开「固定 YOLO」组件行开关并重启 dsh 后才整体生效（开关写入 profile patch 的
`- id: yolo-mode` + `disabled: false` 覆写行）：

- `sandbox-policy` 固定为 `danger-full-access`，`approval` 固定为 `ask`；
- 原生权限预设服务与权限选择器被禁用，页面不再显示「只读」「工作区内修改」等无效选项；
- 新建、恢复和子代理 Agent 都追加 full-access + ask 的策略事件；
- `bash`、`pwsh`、`write`、`edit` 的模型 schema 隐藏 `sandbox_permissions` 与 `justification`；
- 旧上下文或异常模型传来的这两个字段在执行前丢弃；
- 合法的 `approval/request` 自动返回 `allowed-once`；`ask_user_question` 不受影响；
- 保留 dsh 原生工具执行、结果、diff、取消、超时与 approval 审计事件。

关闭组件行开关（或整个套件 Bundle 开关）并重启 dsh 后，上述覆写整体退场，
原生权限服务与选择器恢复。插件追加的历史策略事件不会被原地改写，
恢复原生权限后需要重新选择一次原生预设。

## 安全

这是有意取消最后一道交互式执行边界：任何能驱动会话的模型输出，都可以用 dsh
进程用户权限执行命令、修改文件、读取凭据或安装软件。

> 固定 YOLO 生效期间权限选择器被隐藏，所有权限请求自动允许。默认停用是刻意的
> 安全姿态：需要用户在插件页显式打开行开关并重启 dsh 才会取消该边界，
> 关闭开关并重启即可恢复 dsh 原生权限保护。

Host/Origin 检查等外围防线仍然保留；它们不是 YOLO 的替代品。

## 验证

```powershell
pnpm --filter @dsh-kit/dsh-plugin-yolo-mode test
pnpm --filter @dsh-kit/dsh-plugin-yolo-mode typecheck
pnpm --filter @dsh-kit/dsh-plugin-yolo-mode build
node scripts/yolo-mode-check.mjs
```

`yolo-mode-check` 同时验证默认停用（原生权限选择器恢复下发）与显式启用
（固定 YOLO 全链路生效）两条路径。修改插件后必须重启 dsh，刷新页面不会重新加载 Host bundle。

## 分发与管理

本插件作为独立 Bundle 分发，并收进套件包统一安装。默认停用；
打开插件页「固定 YOLO」行开关并重启后生效，关闭行开关（或套件 Bundle 开关）并重启
即恢复原生权限审批。停用是降权操作，重新启用会提高执行权限。
后续升级以整个套件为单位并保留行开关状态，卸载后不会自动补回。
需要重装时，在 dsh「添加插件」中填写套件目录 `plugins/suite` 的绝对目录。
