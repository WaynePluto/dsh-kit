# @dsh-kit/dsh-plugin-model-provider

「模型提供商」是 dsh-kit 的正式静态插件：

- 在聊天输入框的模型选择按钮左侧显示当前模型所属提供商的名称（如 `Z.ai GLM-5.3-Flash Max`）；
- 数据来自与原生模型选择器、`/model` 弹窗共享的 per-session 模型目录（`ctx.modelDirectories`），
  在任一入口切换模型都实时跟随，不重复请求目录；
- 显示名与原生模型菜单的供应商组头一致：目录组 `name`，`deepseek-account` 特判为
  「DeepSeek 账号/DeepSeek Account」；目录未装载（组缺失）时回退原始 provider id；
- 当前无选择（加载中/未选）或寻址 subagent 会话（无模型选择面）时不显示；
- 纯浏览器半、无宿主半服务、无设置项；行宽不足进入紧凑模式时随模型文字一起隐藏
  （复用 composer 的 `--dsh-composer-model-text-display` 显示变量）；
- 只占用 `conversation.input.right` list 槽的一个条目，不触碰模型座位本身：
  常用模型（favorite-models）停用与否都不影响本组件，反之亦然。

## 构建

```powershell
pnpm --filter @dsh-kit/dsh-plugin-model-provider typecheck
pnpm --filter @dsh-kit/dsh-plugin-model-provider test
pnpm --filter @dsh-kit/dsh-plugin-model-provider build
```

本插件作为模型增强 Bundle 的组件装载。当前 `dsh-kit-web` profile 没有 HMR；修改插件后必须重新构建并重启 dsh，单纯刷新页面不会加载新产物。

## 分发与管理

本包不作为独立安装项分发，而是 `@dsh-kit/dsh-plugin-model-enhancements`（模型增强 Bundle）的组件。停用后，提供商标签消失，模型选择器回到原生形态。
可在该 Bundle 详情中单独停用或重新启用本组件；安装、卸载和升级以整个模型增强 Bundle 为单位。
套件安装后本组件默认启用；后续升级以整个套件为单位，并保留 Bundle 与组件的停用状态；卸载后不会自动补回。
需要重装时，在 dsh「添加插件」中填写套件目录 `plugins/suite` 的绝对目录。
