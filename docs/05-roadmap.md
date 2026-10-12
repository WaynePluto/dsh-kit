# 05 · 当前进度

只记录当前能力和下一步任务。完成一项立即勾选；自动测试与用户实机验收分开记录。
本轮重构（2026-10-10，删除远程能力并更名 dsh-kit）前的历史记录见
[docs/changelog](changelog/) 与 git tag `dsh-remote-final`。

## 已实现

- [x] yolo-mode 默认停用契约（2026-10-12，v2）：安装后默认停用；行开关写入的流式启用行
  （`[ { id: yolo-mode, disabled: false } ]`）驱动五行整体生效/退场。v1 暴露两个缺陷并已修复：
  套件里 permission/ui-permission 硬编码 disabled（行开关与套件开关都无法恢复原生选择器），
  以及对 sandbox-policy/approval 用行 disabled（覆写行 disabled 会连官方基础行一起整行禁用，
  服务消失导致 8 项 pending 级联）、未识别流式覆写行形态。v2 改为 sandbox-policy/approval 的
  config 条件回退官方默认 + 镜像行/插件行 disabled 表达式。yolo-mode-check 覆盖独立 Bundle 与
  套件两种形态的启用/默认停用实机启动（含服务健康探针；probe overlay 补齐 dsh 0.2.0
  connection 行 webServer 注入覆写）。
- [x] 运行中首次启用整包不再报 failed to import（2026-10-12，套件侧修复）：组件 insert 行的
  disabled 表达式加可解析性守卫（与 loader 同一 baseUrl 的 createRequire 探测组件包；dsh 的
  runtime resolution 表随进程冻结，安装前启动的进程里在线启用只能看到
  `<profile>/node_modules` 一层），探测不到的行整行禁用、延迟到重启装载；模型屏障占位行
  改用套件包子路径 `@dsh-kit/dsh-plugin-suite/fallback`（实现内嵌套件包 `fallback/`，
  三种安装形态都可解析），首次启用当场给 `llm-pi-ai` 屏障注入供服务。守卫契约由
  `plugins/suite/tests/suite-patch.spec.mjs` 守护；`scripts/suite-first-enable-check.mjs`
  用隔离 home + junction-only profile 跑真实 dsh 在线启用冒烟（含冷重启后全量装载断言）。
- [x] 套件单包分发（2026-10-10）：`@dsh-kit/dsh-plugin-suite` 经官方「添加插件」一条路径
  安装/启用/卸载；`scripts/build-suite.mjs` 生成聚合 patch（`llm-pi-ai` 屏障 + 模型屏障占位 +
  全部组件行）并把组件与 registry 依赖闭包物化进 `plugins/suite/node_modules/`。
  官方桌面 0.2.0-rc.2 实测装载通过。
- [x] 18 个功能组件，按 3 个组合包与 9 个独立包分发（见 [插件索引](plugins.md)）；
  组合包内的组件保留独立行，可单独停用（模型组两个屏障组件除外）。
- [x] 插件目录扁平化（2026-10-10）：`packages/plugins/*` → `plugins/*`；
  `packages/` 只保留 `plugin-build`（tsdown 配置工厂）与 `plugin-ui`（浏览器半共享 UI）。
- [x] 全仓更名 dsh-kit（2026-10-10）：包 scope `@dsh-kit/*`、插件 `name` 字段、locale 文案、
  依赖版本统一为 `0.1.0`、`check:dependencies` 覆盖 `plugins/`。
- [x] 开发与冒烟链收敛：开发入口 `pnpm dev`（`~/.dsh-dev` + profile `dsh-kit-dev` + 端口 3180，
  自动构建套件并安装）；冒烟脚本从该 profile 复制隔离副本；`concise-mode-check` 改为安装套件并
  停用/启用整个套件 Bundle；`verify-suite-client.mjs` 期望 16 个浏览器行。
- [x] 插件内清理：删除 notify 的桌面壳回环通道（只保留 Windows toast），各包 README 的
  分发与重装说明改指套件路径。
- [x] 文档重建：README（中英）、AGENTS.md 铁律、ARCHITECTURE.md、docs 01/02/03/05 与插件索引；
  删除远程专属文档（安全、传输、联调验收、启动基准、旧计划）。
- [x] run_code 工具插件取代简洁 PTC（2026-10-10）：简洁预设内嵌 run-code 行
  （`presentAs('both')` + SDK 后指引 section），原生工具与 run_code 并存、模型自主选择；
  执行链、SDK、审批与子调用全部复用 dsh。
- [x] 套件组件清单元数据统一中文（2026-10-09）：插件管理器只为裸包名行解析 locale meta，
  因此新增 display 壳微包（preset-concise、model-bootstrap）承载中文标题与描述。
- [x] 官方桌面「正在加载设置」卡死修复（2026-10-09，两个组件随后随远程能力删除）：
  根因是 browser-compat 的旧 WebKit 全局垫片垫坏官方桌面 Chromium 连接层，
  以及 remote-settings 的静态 `__DSH_TRANSPORT__={ownsHost:true}` 违反 dsh 契约。
- [x] files 增强 DOM 级重写（2026-10-10 实机验证）：放弃 `sidebar.right.pane.tab` 座位影子，
  改为 MutationObserver 发现原生树根后挂捕获事件；右键菜单宿主改零尺寸 fixed 定位，
  消除侧栏抖动。
- [x] favorite-models 菜单磨砂材质修复（2026-10-10 实机验证）：改用官方 MenuSurface 组件
  与 MenuGroup，删掉自绘背景与组头样式，计算值与官方账号菜单逐项一致。
- [x] dsh 0.2.0-rc.2 升级（2026-09-29）：传输/认证/插件契约核对无破坏；根 overrides 全表
  钉 0.2.0-rc.2；pi-ai 0.85.1→0.87.1 对齐；16 项冒烟 check 与全仓检查通过。

## 实机验收

以下保留用户确认项，不因实现或单元测试完成而自动勾选。修改插件后先重启 dsh。

- [x] chat-scroll：消息开头与返回底部均有滚动动效，历史会话首击、底部状态和自动跟随已由用户实机确认。
- [x] files：原生增强基本使用已由用户验收通过；图片缩放、临时预览页签与手机/边界矩阵仍单独待确认。

| 插件 | 待确认 |
|---|---|
| 套件生命周期 | 停用/启用整个套件后重启仍保持；组件级停用保持；卸载后不自动补回，重装仍走「添加插件」；深浅主题与中英文界面 |
| 首次在线启用 | 安装完成弹窗点「立即启用」不再报整包 failed to import（组件行延迟到重启装载）；重启后全部组件装载、yolo 保持默认停用 |
| copilot-auth | 设备码登录成功，凭据持久化，账号模型可使用 |
| proxy | 跟随环境（默认）、使用插件代理地址、强制直连三态：测试 URL、原生 fetch 模型请求和官方网页抓取按所选策略出网；不以子进程或独立网络库作验收前提 |
| models-catalog | 检查、选择、应用与重启持久化已实机通过；撤销与其余新增模型仍待实机确认 |
| favorite-models | 输入框筛选、全部失效回退、当前模型不跳转，/model 目录完整 |
| model-capabilities | 协议覆盖生效；图片支持后向实际端点发送图片 |
| turn-retry | 失败重试、停止继续、错误详情；有排队消息时不发送或修改队列；详情弹窗全屏（含深色主题）待实机确认 |
| services | 启动、就绪、日志、停止；重启 dsh 后服务存活并能认领；dock 单行省略与日志弹窗全屏（含深浅主题）待实机确认 |
| terminal | 人类直接输入，默认密码遮罩；忙碌时保留草稿，中断有效；Linux sudo 任务复用系统缓存待实机确认 |
| files | 图片缩放与 Space + 鼠标左键拖动平移、临时预览/双击保留、当前分栏关闭其他/全部方案待实机确认 |
| notify | Windows 通知实际弹出、点击只有关闭、专注助手与权限设置提示正确 |
| tools-inspector | 工具清单与历史调用、失败次数统计与只读性 |
| skills-inspector | 技能来源与会话加载历史、无宿主机桌面时的降级提示 |
| user-message-fork | 子会话只继承前置历史，草稿可编辑，原会话不变 |
| concise-mode | 简洁会话可直呼工具，也可写 run_code 程序批量/组合调用（both，模型自主选择）；run_code 调用卡片与子调用展示正常 |
| yolo-mode | 安装后默认停用、原生权限选择器可见；打开行开关并重启后用户提问正常、常驻服务可启动；关闭行开关并重启后原生权限控制恢复 |
| web-search-switch | 开关热加载即时生效并落盘，重启 dsh 后保持；官方「网页搜索」卡片随之消失/恢复 |
| agents-md | 设置页编辑、保存与 dsh 加载器反向认领一致 |

## 后续任务

- [ ] 组件停用/启用后的浏览器半回归：每个组件的行开关在真实宿主里生效，
  且不影响其他组件的槽位与服务。
- [ ] 套件在线停用/启用的上游竞态观察：dsh 0.2.0 仍存在 session-controller 重挂载竞态
  （file-upload Agent resolver 二次注册失败），套件整包启停时会经过这条路径；
  命中时记录签名并在检查脚本里按精确签名豁免，等上游修复后移除豁免。
  2026-10-12 定位触发链：重组合中套件的 `llm-pi-ai` 覆写行加 inject → `llm` provider 重启 →
  注入 llm 的 session-controller 随之重挂载，其内嵌 file-upload 在旧注册未释放时二次注册
  （覆写行的 disabled 会连官方基础行一起整行禁用，kit 侧无法规避）。
  `scripts/suite-first-enable-check.mjs` 已按精确签名豁免这一条并会在上游修复后提示移除；
  套件侧的 19 项 failed to import 已由可解析性守卫消除（见已实现），首次启用残留的这一条
  报错与暂时的会话不可用需要重启 dsh 恢复。
- [ ] 仓库公开后实测「添加插件」用 Git 地址安装（`file:` 相对依赖在 git 依赖语境的解析基准）。
- [ ] 按 [dsh-upgrade skill](../.agents/skills/dsh-upgrade/SKILL.md) 跟进官方 dsh 新版本，
  完成后回写 [源码依据](02-dsh-facts.md) 的适配基线。
- [ ] 新增插件前先更新 [决策](01-decisions.md) 与 `plugin-catalog.json`，并在
  [插件索引](plugins.md)、组合包 README 与组件 README 同步登记。
