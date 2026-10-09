# 网页搜索开关

为 dsh 官方「网页搜索」插件（宿主行 `web-search-deepseek`，包
`@deepseek-ai/dsh-web-search-deepseek`）补充停用与恢复开关。dsh 插件页「官方」
分组里的这一项只是一张配置卡片，官方没有提供启停开关。

## 使用

插件 → 已安装 → 网页搜索开关，点开卡片即见「官方网页搜索」开关。

- 开关经 dsh 官方 `pluginManager` 服务把停用/启用写入 `dsh-remote-web` profile
  的用户层 `cordis.patch.yml`（`id: web-search-deepseek` 行加 `disabled`），与 dsh
  原生插件行开关同一机制；本插件不实现第二套插件管理，也不持有自己的状态。
- 热加载可用时立即生效；需要重启时开关下方提示「已写入配置，重启 dsh 后生效」，
  退出工作站再重新打开即可，提示在生效后自动消失。
- 停用后 dsh 正常启动：`web` 行的 `searchProvider` 是惰性解析，只在真正发起网页
  搜索时才需要 provider；重启后插件页「官方」分组中的「网页搜索」卡片自动消失，
  重新启用后恢复。

## 边界

- 只操作官方 `web-search-deepseek` 一行；不改 `web` 行配置，也不触碰模型可用的
  `web_search` 工具（`tool-web` 行）与 `DSH_WEB_SEARCH_PROVIDER` 环境变量。
- 停用状态记录在 dsh 自己的 profile 补丁里：卸载本插件不会自动恢复官方网页
  搜索。需要恢复时先在本开关里重新启用，或删除该 profile `cordis.patch.yml` 中
  `id: web-search-deepseek` 的条目后重启。

## 分发与重装

独立第三方 Bundle（`@dsh-remote/dsh-plugin-web-search-switch`），随工作站默认
安装，配套升级自动安装；卸载后不自动补回。重装走官方「添加插件」：发行介质
`<解压目录>/plugins/web-search-switch`，源码开发用 `<仓库>/.dev/plugins/web-search-switch`。

## 验证

```powershell
pnpm --filter @dsh-remote/dsh-plugin-web-search-switch typecheck
pnpm --filter @dsh-remote/dsh-plugin-web-search-switch test
pnpm --filter @dsh-remote/dsh-plugin-web-search-switch build
node scripts/web-search-switch-check.mjs
```
