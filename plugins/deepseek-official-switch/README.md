# DeepSeek 官方 API 开关

移除设置 → 模型里的内置 DeepSeek（API 密钥）供应商卡片（显示名「DeepSeek」，路由
`deepseek-official`）。这张卡由 base bundle 的 `llm-deepseek` 行注册，属于整段供应商
（settingsPath 为空），dsh 原生删除只覆盖用户层配置条目，因此官方页面永远不会给它
「删除」按钮；本插件补上这个动作，并提供恢复入口。

## 使用

- 设置 → 模型 → 「DeepSeek」卡片右上角出现「删除」，点击并在确认弹窗中确认即移除。
  移除经 dsh 官方 `pluginManager` 服务把 `id: llm-deepseek` 行的停用写入 profile 用户层
  `cordis.patch.yml`，与 dsh 原生插件行开关同一机制；本插件不实现第二套插件管理。
- 需要重启时卡片下方提示「已写入配置，重启 dsh 后生效」，重启后卡片与
  `deepseek-official` 模型从模型页和模型选择器消失；热加载可用时立即生效。
- 恢复：删除确认后设置 → 模型底部立即出现恢复入口（待重启期间文案为
  「已提交移除，重启 dsh 后生效」，此时点「恢复」即撤回删除，卡片不会消失）；行已移除后
  文案为「内置 DeepSeek（API 密钥）供应商已移除」，点击恢复（通常热加载立即生效）。
  也可在 config 编辑器里删除 profile 补丁中 `llm-deepseek` 行的 `disabled`。

## 边界

- 只操作官方 `llm-deepseek` 一行；不写它的设置命名空间，不删已存的 `DEEPSEEK_API_KEY`
  凭据。「DeepSeek 账号」（`llm-deepseek-account` 行）与官方网页搜索
  （`web-search-deepseek` 行，独立注册搜索 provider）完全不受影响。
- 移除后基础配置里的默认模型 `deepseek-official/deepseek-flash` 不再可解析：已保存过
  模型选择的部署无感；从未选择过模型的新环境需要在设置 → 模型选择其他模型。
- 目录供应商里的第三方 `deepseek`（pi-ai 目录，`llm-pi-ai` 行注册）与本开关无关，
  移除内置卡后仍可正常添加使用；两者派生同一个 `DEEPSEEK_API_KEY` 凭据引用，密钥互通。
- 停用状态记录在 dsh 自己的 profile 补丁里：卸载本插件不会自动恢复内置卡片，恢复走
  上述入口或手动删除 `llm-deepseek` 行的 `disabled` 后重启。「待生效」标记是页面内存态：
  删除后未重启就刷新页面，恢复入口会暂时消失，重启后以 profile 实际状态为准必然可见。

## 分发与重装

随模型增强组合包（`@dsh-kit/dsh-plugin-model-enhancements`）分发，可在 Bundle 详情中
单独停用本组件；卸载后不自动补回。重装走官方「添加插件」，填入套件目录 `plugins/suite`
的绝对目录。

## 验证

```powershell
pnpm --filter @dsh-kit/dsh-plugin-deepseek-official-switch typecheck
pnpm --filter @dsh-kit/dsh-plugin-deepseek-official-switch test
pnpm --filter @dsh-kit/dsh-plugin-deepseek-official-switch build
node scripts/deepseek-official-switch-check.mjs
```

浏览器验收：设置 → 模型的「DeepSeek」卡片出现「删除」；确认后（重启 dsh）卡片消失、
模型页底部出现恢复入口；恢复并重启后卡片回来。深浅主题都要核对删除按钮、确认弹窗与
底部入口。
