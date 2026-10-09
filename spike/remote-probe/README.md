# remote-probe spike

2026-10-08 在官方 dsh 桌面版（0.2.0-rc.2，`D:\app\DeepSeek Harness`）与 scratch web profile
（dev-runtime 0.2.0-rc.2）实测通过的可行性探针。验证「dsh-station 转型为纯第三方插件套件」
的四条关键链路，包结构与两级启动器代码可作为正式迁移的种子。

## 验证结论（全部通过）

| # | 链路 | 结果 |
|---|---|---|
| 1 | 第三方 Bundle patch 覆写 connection 行 `trustedHosts`（官方表达式合并模式） | `/api` + 伪造 Host 由 403 → 401，桌面与 web 宿主均生效 |
| 2 | 插件内 `ctx.connection.authenticatedUrl()` 获取启动 token URL | 与宿主 stdout 打印的 token 一致；curl 之 → 303 + `Set-Cookie dsh-auth-*`（relay 一次性重定向的完整依赖链） |
| 3 | Electron 宿主内 `process.execPath + ELECTRON_RUN_AS_NODE=1` 拉起子进程 | 成功；scratch（纯 Node）与桌面（Electron exe）均通过 |
| 4 | 两级 detached 启动器跨宿主重启认领 | `taskkill /PID <main> /T /F` 杀整树后 L2 存活，新宿主按 pidfile 认领、不重复 spawn、心跳连续 |

## 文件

- `cordis.patch.yml` — connection 行覆写（官方注释的 `['x', ...ctx.webRuntime.trustedHosts]` 模式）+ 自有行 insert
- `dist/index.js` — 宿主半：inject `[connection, webServer]`，记 token URL，pidfile 认领，spawn L1
- `dist/heartbeat.mjs` — L1（spawn L2 后退出）/ L2（2 秒心跳）

## 实测踩坑（迁移必读）

1. **`!!js` 是标量 tag**：表达式必须引号包裹；`!!js [...`裸写会被安装期 YAML 校验拒绝
   （`unknown tag`），且安装失败会自动回滚 profile（行为良好）。
2. **CLI 对 `--profile desktop` 硬拒绝**（"managed exclusively by the Electron application"），
   桌面 profile 的插件安装/卸载只能走桌面插件管理页 UI；页面输入框官方支持
   npm 包名 / GitHub 地址 / 本地目录路径三种源。
3. **安装是两步**：安装只写 dependencies，「启用」才把包名写进 `dsh.profile.bundles`；
   刚装完立刻点启用可能不生效，稍候重试即可。卸载会把 bundles 与 dependencies 完整还原。
4. **官方自带 bundle 走 `plugin add` 不进 bundles 列表**（只处理树外包）；组装 scratch
   profile 时需手动维护 bundles（station launcher 正是这么做的）。
5. **pnpm 12 的 `allowBuilds`**：装官方闭包（koffi 等）会在 profile 的 pnpm-workspace.yaml
   写入 `koffi: set this to true or false` 占位并使后续安装硬失败；显式置 `false`（预编译产物）。
6. **单层 detached 会被 `taskkill /T` 树枚举杀掉**（即使父已退出）；两级 L1/L2 可逃逸
   `/PID /T`。但 `taskkill /IM` 按映像名匹配——用 `process.execPath` 拉起的子进程与宿主同名，
   会被误杀。正式实现里 relay/connector 应以 node.exe（或专属 exe）运行，不用宿主 exe 名。
7. **inject 未满足的插件只是 pending**，不杀宿主（优雅降级）。
8. 无 locale 元数据的包在插件管理页状态显示不正确（显示「启用」实际已装载）；正式包按
   0.1.7 约定带 `locale/{en,zh}.json`。
9. dsh CLI 启动形式：第一个位置参数是 profile 名（`dsh spike-web --port 3199 --no-open`），
   `dsh --profile X web` 会把 `web` 当 app 参数报错。
