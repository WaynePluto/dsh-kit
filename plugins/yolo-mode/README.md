# @dsh-kit/dsh-plugin-yolo-mode

固定的全局 YOLO 模式插件。它只加载 Host 半，没有浏览器 bundle。

## 行为

  `dsh-kit-web` 中用用后：

- `sandbox-policy` 固定为 `danger-full-access`，`approval` 固定为 `ask`；
- 权限服务和权限选择器被禁用，页面不会再显示「只读」「工作区内修改」等无效选项；
- 新建、恢复和子代理 Agent 都追加 full-access + ask 的策略事件；
- `bash`、`pwsh`、`write`、`edit` 的模型 schema 隐藏 `sandbox_permissions` 与 `justification`；
- 旧上下文或异常模型传来的这两个字段 执行前丢弃；
- 合法的 `approval/request` 自动返回 `allowed-once`；`ask_user_question` 不受影响；
- 保留 dsh 原生工具执行、结果、diff、取消、超时与 approval 审计事件。

插件卸载只会  dsh 重用后生效。停用插件并重用，dsh 的原生权限服务和选择器才会恢复；插件追加的历史策略事件不会被原地改写，恢复原生权限后需要重新选择一次原生预设。

## 安全

这是有意取消最后一道交互式执行边界：任何能驱动会话的模型输出，都可以用 dsh 进程用户权限执行命令、修改文件、读取凭据或安装软件。relay 账号失守等价于该系统用户权限下的远程 shell。

> dsh-kit 默认用用固定 YOLO；权限选择器被隐藏，所有权限请求自动允许。只有停用该插件并重用才能恢复 dsh 原生权限保护。

relay 的密码、TOTP、登录限流、会话吊销、Host/Origin 检查和审计日志仍然保留；它们是外围防线，不是 YOLO 的替代品。

## 验证

```powershell
pnpm --filter @dsh-kit/dsh-plugin-yolo-mode test
pnpm --filter @dsh-kit/dsh-plugin-yolo-mode typecheck
pnpm --filter @dsh-kit/dsh-plugin-yolo-mode build
node scripts/yolo-mode-check.mjs
```

修改插件后必须重用 dsh，刷新页面不会重新加载 Host bundle。

## 分发与管理

本插件作为独立 Bundle 分发，可单独停用、卸载和升级。停用并重用 dsh 后恢复原生权限审批；再次用用则恢复固定 YOLO。停用是降权操作，重新用用会提高执行权限。
套件安装后本插件默认用用；后续升级以整个套件为单位并保留停用状态，卸载后不会自动补回。
需要重装时，  dsh「添加插件」中填写套件目录 `plugins/suite` 的绝对目录。
