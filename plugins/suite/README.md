# DSH 增强套件（suite）

dsh-kit 的唯一分发包：在官方 dsh（桌面版或 web 版）的插件管理页「+ 添加插件」
输入**一条路径**（本目录）即可安装或升级全部内容——18 个功能组件与模型启动屏障。
套件被停用或卸载时全部组件行一并禁用（组合包官方 disabled 表达式约定）。

## 安装

1. 构建产物：仓库根执行 `pnpm plugins:build && pnpm suite:build`
   （后者生成 `cordis.patch.yml` 并把组件与依赖闭包物化进本目录 `node_modules/`）。
2. 官方 dsh → 插件 → 添加插件 → 输入本目录绝对路径 → 安装 → 启用 → 重启应用。
   在安装前就启动的 dsh 里点「启用」，组件行会整包延迟到重启装载（行上的可解析性
   守卫避免 failed to import 报错）；个别机器上首次启用还可能报一条 session-controller
   的重挂载竞态（dsh 上游已知，见 [roadmap](../../docs/05-roadmap.md)），同样重启即恢复。
3. 升级：重新构建后卸载再安装（官方桌面暂不支持插件自动更新）。

本地目录安装是 pnpm `link:` 语义（不安装依赖），因此套件必须自带
`node_modules/`；GitHub 仓库地址安装时 pnpm 从克隆解析 `file:` 相对依赖，
物化内容被忽略——两种来源共用同一 package.json。
**git 地址安装尚未实测**（待仓库公开后验证 `file:./plugins/...` 在 git
依赖语境的解析基准）。

## 组成

- `cordis.patch.yml`（生成物，勿手改）：
  - llm-pi-ai 启动屏障与模型屏障占位行（保证模型组件在线启停不热重启 `llm-pi-ai`）
  - 全部组件 insert 行（裸包名 + 「套件成员 + 组件包可解析」双条件 disabled 表达式，
    首次在线启用时整包延迟到重启装载）
- `fallback/`：内嵌的模型屏障占位实现，行名用套件包子路径
  `@dsh-kit/dsh-plugin-suite/fallback`（package.json 的 exports 重映射到入口与 locale），
  冷启动、git 安装与运行中首次启用三种形态都可解析
- `node_modules/`（生成物）：组件包与 display 壳微包 + registry 依赖闭包

## 行为要点（实测于官方桌面 0.2.0-rc.2）

- 套件只有一条安装路径，不写项目专属数据目录，也不注入环境变量；
  配置全部存在 dsh 自己的 profile 与 settings 里。
- 组件行仍可单独停用（`plugins` 详情页的组件开关），停用事实写在 profile patch
  的 `disabled`；套件 Bundle 本身是安装/卸载/升级单位。
- 模型增强的两个屏障组件（models-catalog、model-capabilities）参与 `llm-pi-ai`
  启动屏障，不能只停一行。
- 宿主升级 dsh 后按 [源码依据](../../docs/02-dsh-facts.md) 的各主题检查脚本复核。
