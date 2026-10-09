# DSH 工作站套件（station-suite）

dsh-station 的全量单一分发包：在官方 dsh（桌面版或 web 版）的插件管理页
「+ 添加插件」输入**一条路径**（本目录）即可安装或升级全部内容——
21 个功能组件、远程运行时（relay/connector 宿主内托管）、模型启动屏障与主题投影。
套件被停用或卸载时全部组件行一并禁用（组合包官方 disabled 表达式约定）。

## 安装（官方 dsh 桌面版）

1. 构建产物：仓库根执行 `pnpm plugins:build && node scripts/build-suite.mjs`
   （后者生成 `cordis.patch.yml` 并把组件与依赖闭包物化进本目录 `node_modules/`）。
2. 桌面版 → 插件 → 添加插件 → 输入本目录绝对路径 → 安装 → 启用 → 重启应用。
3. 升级：重新构建后卸载再安装（官方桌面暂不支持插件自动更新）。

本地目录安装是 pnpm `link:` 语义（不安装依赖），因此套件必须自带
`node_modules/`；GitHub 仓库地址安装时 pnpm 从克隆解析 `file:` 相对依赖，
物化内容被忽略——两种来源共用同一 package.json。
**git 地址安装尚未实测**（待仓库公开后验证 `file:./packages/...` 在 git
依赖语境的解析基准）。

## 组成

- `cordis.patch.yml`（生成物，勿手改）：
  - connection 行覆写：`[...ctx.dshRemoteTrust.authorities, ...ctx.webRuntime.trustedHosts]`
  - llm-pi-ai 启动屏障、模型屏障占位与主题投影（原壳级 overlay 内容）
  - 全部组件 insert 行（裸包名 + 套件 disabled 表达式）
- `node_modules/`（生成物）：组件包 + relay/connector/protocol + registry 依赖闭包

## 行为要点（实测于官方桌面 0.2.0-rc.2）

- remote-runtime 组件在宿主激活时：写 `~/.dsh-station/dsh-token`
  （`ctx.connection.authenticatedUrl()`），以两级分离启动器拉起 relay 与
  connector（日志在 `~/.dsh-station/logs/`，pid 注册表在 `processes/`）。
- relay 首访 401 时从 token 文件兜底发起一次 `?token=` 重定向
  （无 launcher 时代的帧上报替代路径）。
- 入口 authority 变化（更换远程入口）后需手动重启 dsh 应用新 trustedHosts；
  插件无法重启自己的宿主。
- `!!js` 是标量 tag：patch 内表达式必须加引号，裸 `[` 会被安装期校验拒绝。
