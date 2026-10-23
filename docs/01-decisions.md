# 01 · 需求与决策

## 1. 产品目标

给官方 DeepSeek Harness（dsh）加一组个人体验优化插件：模型、会话、工作区与运行环境四个方向，
用一个套件包一条路径安装。dsh 仍是唯一宿主，负责 Agent、工具、会话与全部界面；
本项目只提供插件，不提供宿主、不提供远程访问，也不持有自己的运行时数据。

## 2. 已确认的决策

| 编号 | 决策 | 依据 |
|---|---|---|
| D1 | 使用官方 dsh 运行时，不修改或 fork dsh 源码 | 扩展通过官方插件机制完成，升级时核对上游契约（见 [源码依据](02-dsh-facts.md)） |
| D2 | 项目名 dsh-kit（用户文案「DSH 增强套件」），包 scope `@dsh-kit/*` | `kit` 描述「成套的增强插件」，不暗示宿主或远程能力；改名为一次性事件，不保留旧名的运行时迁移，旧套件卸载重装即可 |
| D3 | 分发只有套件单包 `@dsh-kit/dsh-plugin-suite`：官方「添加插件」输入一条路径安装/升级/卸载 | 免掉 launcher 式的外部安装与介质同步；套件自带物化依赖闭包，本地目录安装是 `link:` 语义也能自洽 |
| D4 | 组合包（model-enhancements、conversation-enhancements、development-tools）是安装与停用单位，组件保留独立稳定行 id 并可单独停用 | 与 dsh 官方组合 Bundle 约定一致；行 id 必须跨重组稳定，否则 Profile HMR 会把匿名行当新条目重复 import |
| D5 | models-catalog 与 model-capabilities 是一对运行时模型目录组件（共享 `modelsCatalogRuntime` 服务），不可只停一行 | model-capabilities 的协议覆盖依赖 sibling 提供的 runtime service；两者是同一目录能力的两半（D16 后不再有屏障行绑定） |
| D6 | 套件层永不覆写官方行（2026-10-14，与 D16 同源；生成逻辑只在 `scripts/build-suite.mjs`） | 见 D16 |
| D7 | 无项目专属数据目录、环境变量与 profile | 配置存在 dsh 自己的 profile 与 settings；插件卸载即无残留 |
| D8 | 开发栈与冒烟使用隔离环境：`~/.dsh-dev`、profile `dsh-kit-dev`、端口 3180 | 与日常实例互不影响；冒烟脚本从该 profile 复制隔离副本后启动真实 dsh |
| D9 | 所有直接依赖固定版本，不使用范围、dist-tag 或隐式升级 | `pnpm check:dependencies` 覆盖 `packages/` 与 `plugins/`；dsh 家族版本由根 `pnpm.overrides` 统一钉住 |
| D10 | 固定 YOLO：danger-full-access + ask，合法 approval 自动 allowed-once，用户提问不自动回答 | 取消模型执行前的交互式权限边界是明确选择，风险与替代防线见 [yolo-mode README](../plugins/yolo-mode/README.md) |
| D11 | 展示壳微包（model-bootstrap）承载裸包名行的中文元数据；模型屏障占位行已内嵌到套件包 `fallback/` 子路径 | 插件管理器只为裸包名行解析 locale meta；相对路径行会退化成完整文件 URL，官方包只有英文 |
| D12 | 远程访问能力已整体删除（2026-10-10）：relay/connector/protocol、remote-* 组件与相关脚本文档全部移除；简洁模式预设（concise-mode、preset-concise、run-code、prompt-filter）连同 run_code 程序工具已整体删除（2026-10-20，用户决策） | 远程能力实际使用频率低，项目收敛为纯插件套件；最后一次可用状态存档在 git tag `dsh-remote-final`，将来需要时重新评估而不是直接恢复旧代码。dsh 0.2.1 从工具注册表移除 both 混合呈现并拒绝该配置，run-code 失去上游依据，简洁模式随之下线 |
| D15 | 移除内置 DeepSeek（API 密钥）卡片 = 经官方 pluginManager 停用 base bundle 的 `llm-deepseek` 行；恢复入口放模型页底部 footer 槽 | `deepseek-official` 是整段供应商（settingsPath 为空），dsh 原生删除只覆盖用户层配置条目，卡片无法经设置消失；停用行是让路由与卡片消失的唯一官方途径（web-search-switch 同款机制，2026-10-13 用户确认）。恢复入口必须独立于被移除的卡片，footer 槽（models-catalog 先例）在行停用后仍渲染。不动 `DEEPSEEK_API_KEY` 凭据与 `llm-deepseek-account` 行：账号卡与官方网页搜索（独立注册搜索 provider）不受影响；目录采纳的第三方 `deepseek`（`llm-pi-ai` 行注册）与本开关无关 |
| D16 | 套件层（以及一切第三方 patch 层）永不覆写官方行；宿主半私有 RPC 统一走 `connection.fetch.register` 的 `/api` 精确路由（共享包 `@dsh-kit/plugin-rpc`）；yolo-mode v3 只剩插件 insert 行，生效面全部由插件代码承担 | 官方行覆写（旧 llm-pi-ai 屏障、connection webServer 注入、yolo 四行）在套件启停的 HMR 重组合中让该行 fiber 回退/重启，沿注入链级联（sandbox-policy → fs-sandbox → fs → session-controller；llm-pi-ai → llm → session-controller），命中 dsh 0.2.0 session-controller 的 file-upload Agent resolver 二次注册竞态：会话服务当场失败（`停用失败: 2 entries did not activate … Agent resolver is already registered`）、重新启用后 `session/follow` 报 `sessionController is unavailable`，重启 dsh 前不恢复（2026-10-14 用户实机复现，隔离冒烟三度复现并定位）。替代事实：`/api` 桥由官方 connection 插件经 `ctx.inject(['webServer'],…)` 自挂，fetch 路由注册不要求 connection 行注入 webServer（`packages/client/connection/src/rpc-host.ts` 的 `registerFetchRoute`）；pi-ai model map 是共享可变状态（`getBuiltinModels` 每次读取）、持久化模型是自包含 `providers.*.models` 条目，晚注册生效，启动屏障不必要；sandbox/approval 修复走会话级持久事件（`setSandboxMode`/`setApprovalPolicy` = `session.append`），agent/created 同步执行先于首个模型请求。代价：YOLO 激活期间原生权限选择器不再隐藏（选择只改部署级默认，会话 override 仍拉回 YOLO 值）。守护：`suite-patch.spec.mjs` 空覆写白名单 + `suite-toggle-check.mjs` 在线启停实机回归 |
| D17 | 常驻服务（services）跨工作区可见（2026-10-21 用户决策）：注册表从项目内 `.agents/services.json` 迁到 `$DSH_HOME/dsh-kit/services.json` 单文件，服务名部署内全局唯一；日志同住 home（`$DSH_HOME/dsh-kit/logs/<name>.log`，2026-10-22 用户决策「方案一」）；面板恒显示全局（当前工作区排前、外来源带项目徽标）；`service_list` 默认本项目、`scope:"all"` 看全局；stop/restart/logs 按名称跨工作区寻址，门控读调用方会话自己的沙箱模式 | 进程现实本来就是机器级（两级启动器让它活过 dsh 与工作区），可见性锁在启动工作区会造成看不见也停不掉的孤儿服务、端口冲突排查失明、多仓库工作流没有全局视角。「同一台电脑」精确为「同一 `$DSH_HOME`」：D8 的 `~/.dsh-dev` 隔离 home 天然不受污染，Windows 多用户各有 home；挂在 home 而非 profile，切 profile 不丢服务视图，且比往用户仓库写 `.agents/services.json` 更贴 D7（不在项目里留插件状态；agents-md 写 `DSH_HOME/AGENTS.md` 同一先例）。日志初版随 D17 留在原项目，公共基础服务（s3/minio 等）的场景暴露错位——日志挂在「碰巧第一个拉起它的项目」名下，该项目删除即失日志；而注册表全局化后「日志必须在 session 目录」的旧约束已不存在，遂改为与注册表同住 home：名称全局唯一使文件名天然不冲突，每次启动截断、每名一份使总量随服务数有界；项目内 `.agents/logs/` 与 roots 索引降级为旧版存量日志的回捞来源，运行中旧服务的日志文件不搬（fd 打开中，Windows 锁定），下次 restart 自动落位 home。并发：多窗口写同一文件，lockfile（`O_EXCL` + 陈旧打破）串行化 read-modify-write，同名竞态在锁内复核、后写入方杀掉自己刚拉起的进程；OS reconciliation 兜底自愈。迁移：旧项目注册表在工作区首次被触达时惰性并入并删除。降级不回写旧表（套件以整包升级为单位） |
| D18 | 常驻服务管理面迁到左侧栏「服务」全局面板（2026-10-23 用户决策）：浏览器半从 `conversation.input.dock`（session 域 dock 卡）迁出，改为 `main` keyed 槽（key = 包名后缀 `dsh-plugin-services`）注册主列页面 + `sidebar.panellist` 注册侧边栏行（order 20，排在插件 0、自动化任务 10 之后）；面板 RPC 的 `sessionId` 变可选（缺省 = 无锚点不排序、restart 门控 fail closed） | D17 把数据域升到部署级（home 注册表、跨工作区可见），UI 却仍挂在 session 域的会话输入区：每个会话挂一份、随会话切换重挂载重轮询，且 dock 的 sessionId 注入在 D17 后已是残留物（宿主按名称寻址）。官方侧边栏 `插件`/`自动化任务` 就是全局面板家族（ui-plugin-manager/ui-schedule 同款双注册：main keyed 页面 + sidebar.panellist 行），属设计内扩展点、无 DOM 注入；「当前工作区排前 + 外来源徽标」的锚点改由 `uiSession.adapter.current` 在每次轮询时现取（面板无会话绑定；选中面板时会话列卸载，但 mainView 保留由工作区导航层持有，当前会话仍可解析）。代价：聊天中瞥一眼状态要切一次主列（与看插件页同价）；页面恒显示，不再「无服务即隐藏」（空态说明替代）。契约记录在 [插件机制](dsh/plugins.md) 的「全局面板」一节 |

## 3. 术语

| 概念 | 用户可见名称 |
|---|---|
| 整个分发包 | 套件（`@dsh-kit/dsh-plugin-suite`） |
| 组合分发单位 | 组合包（模型增强、会话增强、开发工具） |
| 组合包内的单行插件 | 组件 |
| 关闭某个组件行 | 停用组件 |
| 取消某个组合包 | 停用/卸载 Bundle |
| dsh 的 Profile Bundle 机制 | 官方插件机制 |

代码标识符保持英文原名（`bundle`、`row`、`patch`、`pluginManager` 等），
中文文案只用于标题、说明与按钮。

## 4. 历史沿革

项目经历过三个阶段，细节见 [更新日志](changelog/)：

1. **独立工作站**：自带桌面壳、relay/connector 隧道、四端发行介质（已删除）。
2. **远程插件套件**：转为官方 dsh 的第三方套件，项目名 dsh-remote（2026-10-09）。
3. **纯增强套件**：删除全部远程能力，定名 dsh-kit（2026-10-10，本文件 D2、D12）。

旧阶段的数据目录（`~/.dsh-station`、`~/.dsh-remote`）与旧套件安装不提供迁移路径：
删掉目录、卸载旧套件、安装新套件即可。

## 5. 持续关注

- dsh 升级可能改变插件契约，按 [源码依据](02-dsh-facts.md) 与各插件检查脚本复核。
- 固定 YOLO 取消了执行前的交互式权限边界，请在理解风险的前提下使用。
- 插件界面与主题必须同时验收深浅主题；新样式经验回流到 `dsh-theme` skill。
