# 05 · 当前进度

只记录当前能力和下一步任务。完成一项立即勾选；自动测试与用户实机验收分开记录。
本轮重构（2026-10-10，删除远程能力并更名 dsh-kit）前的历史记录见
[docs/changelog](changelog/) 与 git tag `dsh-remote-final`。

## 已实现

- [x] 一键收起工作区（workspace-collapse，2026-10-22）：侧栏「工作区」标题栏（搜索按钮
  左侧）新增收起按钮，点击折叠下方全部工作区分组（含未分组桶与当前会话所在分组，重启后
  保持）。section header 是 ui-workspace 私有界面、无插件槽位，展开状态在其私有 view
  store（persist `dsh.workspace.view.v5`），组件按 DOM 注入工作：从工作区行
  `[data-row-key^="workspace:"]` 向上找带 sectionHeader 直接子节点的祖先定位头部，按钮插
  在搜索槽（searchSlot）之前（原生动作簇 max-width 60px 只装两钮，不可内插；searchSlot 的
  `margin-left:auto` 会把注入项顶到标题旁，容器以同名 auto margin 接管剩余空间并把该
  margin 归零）；点击对全部 `[aria-expanded="true"]` 分组行按文档逆序（树形模式先子后父）
  合成 click，走原生 onToggle 写回 store 并持久化。分组视图未展示（flat/搜索/空态/rail）
  时无工作区行，按钮一并隐藏；搜索展开时经 `:has(~ …headerActionsHidden)` 随原生动作簇
  同节奏退场。样式复刻原生 iconButton 28px 契约，图标为两条原生 chevron 字形纵向叠放的
  上下挤压记号（下箭头在上、上箭头在下），原生 Tooltip。纯浏览器半、无宿主服务（组件总数
  23，浏览器行 22）；随 conversation-enhancements 组合包分发。
- [x] 通知静默用户手动停止的轮次（notify，2026-10-22）：settle 判定新增 `isUserStopped`——
  turn/end 记录 `aborted` 且取消原因为 `user`（停止按钮/Esc 统一经 `session.cancel` →
  `agent.cancel({ kind: 'user' })`，出处 `packages/api/session-controller/src/commands.ts`）时
  不再弹「这一轮停了」；hook 中断、生命周期回收（disposed）、崩溃恢复（interrupted）等
  其他截断仍照常通知。纯宿主半行为，无设置与界面变化（组件总数 22）。
- [x] 复制工作区路径（workspace-path，2026-10-22）：侧栏工作区标题行 hover 出现的 `···`
  菜单（原生只有重命名/删除，无插件槽位——会话行菜单才有 `sidebar.workspaces.session.menu.item`）
  注入「复制路径」项：捕获工作区行 `[data-row-key="workspace:<id>"]` 点击归因 → Menu portal
  （`[role=menu]`，body 直挂）出现后在其 viewport 挂 `MenuItemButton`（external 复用页面样式，
  自动加入 Menu 的 DOM 键盘走查），插在删除（危险项收尾）之前，悬停可见完整路径；
  路径取官方 `workspaces` 服务 `WorkspaceView.path`（与原生 hover 卡片复制同源），复制走
  `writeClipboard`，关闭用合成 Escape（注入项拿不到 owner 的 onSelect 关闭路径）。
  纯浏览器半、无宿主服务（组件总数 22）；随 conversation-enhancements 组合包分发。
- [x] 常驻服务跨工作区可见（2026-10-21，D17）：注册表从项目内 `.agents/services.json` 迁到
  `$DSH_HOME/dsh-kit/services.json`（v2：记录带 root、文档带 roots 索引），同一 home 所有工作区共享；
  日志同住 home（`$DSH_HOME/dsh-kit/logs/<name>.log`，2026-10-22「方案一」：公共基础服务的日志
  不应挂在碰巧拉起它的项目名下，名称全局唯一使文件名不冲突、每次启动截断使总量有界）；
  项目内 `.agents/logs/` 与 roots 索引降级为旧版存量日志的回捞来源，运行中旧服务的日志文件
  不搬（fd 锁定），下次 restart 自动落位 home。服务名部署内全局唯一（重名拒绝并指认属主）；
  面板恒显示全局（当前工作区排前、外来源行首带项目徽标）；`service_list` 默认本项目、
  `scope:"all"` 看全局；stop/restart/logs 按名称寻址不要求会话目录，门控仍读调用方会话沙箱。
  并发由 lockfile（O_EXCL、陈旧 10s 打破、等待 5s 接管）串行化，同名竞态在锁内复核、后写入方
  终止自己刚拉起的进程；旧项目注册表在工作区首次被触达时惰性并入并删除。
  live 测试新增跨工作区可见/停止、跨工作区重名拒绝、v1 真实进程认领与旧日志回捞场景。
- [x] 会话重命名（session-rename，2026-10-19）：dsh 原生重命名入口只在侧栏（行双击/
  右键/Cmd+Alt+G），顶栏会话标题是纯文本。本组件双击顶栏当前会话标题弹出
  「重命名会话」弹窗：document 捕获态 dblclick + 结构识别（`header[data-window-drag]`
  内 `crumbCurrent` 类后缀；面包屑无 data 钩子，类名后缀变更会静默失效，升级需复核）；
  当前会话取 `ctx.uiSession.adapter.current`，空白会话不响应、种子草稿用持久 title
  （不取回落目录名的 displayTitle），与原生行双击同口径。重命名走原生
  `sessions.using(... binding.session.rename)`，成功后 title 投影立即结算；弹窗在
  `shell.overlay` 条目内按原生 RenameSession 逐条复刻（Modal + 回车/IME 守卫 + 错误行），
  原生弹窗状态是 ui-workspace 私有 store、无法直接触发。纯浏览器半、无宿主服务
  （组件总数 21，浏览器行 20）；随 conversation-enhancements 组合包分发。
- [x] 模型提供商标签（model-provider，2026-10-19）：聊天输入框的模型选择按钮左侧显示当前模型
  所属提供商的名称。dsh 原生触发器只显示模型名，供应商组名只在下拉菜单组头出现；本组件占用
  `conversation.input.right` list 槽（官方当前无占用者，渲染位置即模型座位左侧），从
  `ctx.modelDirectories.directoryFor(sessionId)` 的共享目录 store 订阅当前选择（与模型座位、
  /model 弹窗同一状态，任一入口切换实时跟随），显示名与原生菜单组头一致（组 `name`，
  `deepseek-account` 特判「DeepSeek 账号」），目录未装载回退原始 provider id；无选择或寻址
  subagent 会话不渲染。纯浏览器半、无宿主服务（组件总数 21，浏览器行 19）；
  随 model-enhancements 组合包分发。
- [x] 会话统计小时档（stats-hours，2026-10-14）：dsh 会话统计弹窗的 `formatDuration`
  只有两档（`62分5秒`/`62m5s`），而 turn-tail 用时的 `formatRunDuration` 本就三档全显
  （`duration.hourUnit`）。新组件经 body 级 MutationObserver 跟随弹窗 DOM
  （`dl[data-session-stats-details]` 测试钩子，契约见 [会话](dsh/conversation.md)），
  把 ≥1 小时的模型用时/工具调用用时/TTFT 文本整节点改写成与 `formatRunDuration`
  同款三档（中文「1小时2分5秒」、英文「1h 2m 5s」）；整串识别保证改写结果不再命中、
  无循环，上游原生补档后停用组件即还原。纯浏览器半、无 inject 服务；
  随 conversation-enhancements 组合包分发（组件总数 20，浏览器行 17）。
- [x] 修复套件在线停用/启用的 session-controller 竞态（2026-10-14）：用户实机报错
  「停用失败：2 entries did not activate … Agent resolver is already registered」+
  重新启用后「历史加载失败：sessionController is unavailable」。隔离冒烟三度复现并定位：
  套件层对官方行的任何覆写（llm-pi-ai 屏障、connection webServer 注入、yolo 四行）都会让
  套件启停的重组合重启该行 fiber，沿注入链（sandbox-policy → fs-sandbox → fs →
  session-controller；llm-pi-ai → llm → session-controller）级联，其内嵌 file-upload 在旧
  注册未释放时二次注册，会话服务当场失败且重启前不恢复。修复（D16）：套件层与 yolo-mode
  patch 层全部官方行覆写移除——宿主半私有 RPC 统一迁移到官方 `connection.fetch.register`
  的 `/api` 精确路由（新共享包 `@dsh-kit/plugin-rpc`，11 个组件宿主半 + 浏览器半 + 8 个
  check 脚本），模型晚注册生效无需启动屏障（删除 fallback 占位行与 BOOTSTRAP 服务），
  yolo v3 生效面全部由插件代码承担（会话级策略修复 + answerer + 工具 shadow）。
  新增 `scripts/suite-toggle-check.mjs`（在线停用/启用全程官方行 ACTIVE、零报错签名），
  `suite-first-enable-check` / `yolo-mode-check` / 8 个组件 check 全绿。顺带修复
  favorite-models-check 的陈旧菜单面断言（要求已删除的自绘 `--dsw-specific-menu` 背景；
  0.2.0 起材质由官方 MenuSurface 提供，断言改为 MenuSurface + 抬升阴影 token，见已实现
  2026-10-14 修复条目）。
- [x] files Git 变更面板（2026-10-14）：文件右键「查看 Git 变更」打开 `dsh-resource://files-git-review/session/<sessionId>`
  资源页签，面板按原生 changes-review（`ui-deliverables`）的结构与样式在插件内复刻（原生组件不可 import，见
  [工作区](dsh/workspace.md)），内容为工作区对 HEAD 的变更清单 + 单文件 diff；私有通道新增只读
  `review`/`diff` 端点（numstat/patch 无 shell 有界，未跟踪与空仓库按有界读取合成整文件新增）；
  `dsh-client-store` 经页面冻结模块表作为 external 复用；顺带修复 files 插件样式里的陈旧 `--dsh-alias-*`
  token（0.2.0 已全部更名 `--dsw-alias-*`）与 files-check.mjs 的扁平化前旧路径及 DOM 契约断言口径。
- [x] 修复「2 entries did not activate … failed to import」（2026-10-13）：套件物化目录被中断的
  `build-suite.mjs` 清空（rmSync 后复制前退出）时，未登记根 devDependencies 的组件
  恰好因此失去最后的解析兜底，用户层行开关覆写（`disabled: false` 字面量）又绕过了可解析性守卫，
  强制激活的行在导入失败时报警。修复：组件补登根依赖；`build-suite.mjs` 改用
  整体改名换代物化目录（中断不再留空目录）并新增根 junction 完整性响亮检查
  （漏登组件在构建时即失败，不等 dsh 报错）。
- [x] DeepSeek 官方 API 开关（deepseek-official-switch，2026-10-13）：设置 → 模型的内置
  「DeepSeek」（`deepseek-official`）卡片补「删除」——经官方 `pluginManager` 停用 base bundle
  的 `llm-deepseek` 行（整段供应商 settingsPath 为空，原生删除永远不出现，见
  [模型](dsh/models.md)），重启后卡片与路由消失；`settings.models.footer` 槽提供恢复入口，
  经控制器共享的「待生效」状态在删除确认后立即出现（待重启期间可点恢复直接撤回）。
  不触碰 `DEEPSEEK_API_KEY` 凭据、`llm-deepseek-account` 行与官方网页搜索；卡片操作区按钮经
  provider-card keyed 槽（key = `llm-deepseek`）+ 隐藏锚点 MutationObserver + portal 注入，
  复刻原生 rowActions 紧凑危险按钮 token。随 model-enhancements 组合包分发（组件总数 19）。
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
  自动构建套件并安装）；冒烟脚本从该 profile 复制隔离副本后启动真实 dsh 断言；
  `verify-suite-client.mjs` 期望浏览器行随套件清单核对。
- [x] 插件内清理：删除 notify 的桌面壳回环通道（只保留 Windows toast），各包 README 的
  分发与重装说明改指套件路径。
- [x] 文档重建：README（中英）、AGENTS.md 铁律、ARCHITECTURE.md、docs 01/02/03/05 与插件索引；
  删除远程专属文档（安全、传输、联调验收、启动基准、旧计划）。
- [x] 套件组件清单元数据统一中文（2026-10-09）：插件管理器只为裸包名行解析 locale meta，
  因此新增 display 壳微包（model-bootstrap）承载中文标题与描述。
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
| deepseek-official-switch | 删除按钮出现且确认后卡片经重启消失；底部恢复入口可恢复；删除/恢复对「DeepSeek 账号」卡、网页搜索与已存密钥无影响；深浅主题与中英文界面 |
| favorite-models | 输入框筛选、全部失效回退、当前模型不跳转，/model 目录完整 |
| model-capabilities | 协议覆盖生效；图片支持后向实际端点发送图片 |
| turn-retry | 失败重试、停止继续、错误详情；有排队消息时不发送或修改队列；详情弹窗全屏（含深色主题）待实机确认 |
| stats-hours | 会话统计弹窗超过一小时的模型用时/工具调用用时显示「小时」档（中英文界面），不足一小时与 Token 用量弹窗保持原生；停用组件后恢复原生两档 |
| session-rename | 双击顶栏会话标题弹出重命名弹窗（回车提交、IME 不误提交、错误就地显示）；重命名后顶栏与侧栏同步、标题固定不再自动生成；空白会话与祖先 crumb 双击不响应；停用组件后顶栏双击无反应、侧栏原生入口不受影响；深浅主题与中英文界面 |
| model-provider | 模型选择按钮左侧显示当前提供商名（切换模型实时跟随、目录未装载回退 provider id）；行宽不足紧凑模式下随模型文字一起隐藏；停用组件后恢复原生；深浅主题与中英文界面 |
| workspace-path | 工作区 `···` 菜单出现「复制路径」，点击后剪贴板为该工作区完整路径；悬停显示路径；方向键可到达并回车触发；停用组件后菜单恢复原生两项；深浅主题与中英文界面 |
| workspace-collapse | 工作区标题栏搜索按钮左侧出现收起按钮；点击后全部分组收起（含未分组桶与当前会话分组），重启后保持；单个分组可再展开；flat 列表、搜索态与 rail 下按钮不出现，搜索框展开时按钮随原生动作簇退场；停用组件后按钮消失；深浅主题与中英文界面 |
| services | 启动、就绪、日志、停止；重启 dsh 后服务存活并能认领；跨工作区：另一工作区面板可见并可停止/读日志（带来源徽标、当前工作区排前），`service_list scope:"all"` 与全局重名拒绝；日志在 DSH_HOME/dsh-kit/logs（项目目录零落盘），旧项目注册表与旧日志首次触达时自动认领/回捞；dock 单行省略与日志弹窗全屏（含深浅主题）待实机确认 |
| terminal | 人类直接输入，默认密码遮罩；忙碌时保留草稿，中断有效；Linux sudo 任务复用系统缓存待实机确认 |
| files | 图片缩放与 Space + 鼠标左键拖动平移、临时预览/双击保留、当前分栏关闭其他/全部方案待实机确认；Git 变更面板（右键入口、清单与 diff、左右对比/换行、深浅主题与中英文）待实机确认 |
| notify | Windows 通知实际弹出、点击卡片把官方桌面版带到前台（未装桌面版时退化为仅关闭）、关闭按钮仍只关闭、专注助手与权限设置提示正确；任务运行中手动停止后不弹通知，失败等其他结束仍弹出。设置页开关写入在 CLI 冒烟形态被上游 0.2.0-rc.2 缺陷阻塞（见 [插件机制](dsh/plugins.md) 设置写入一节），官方桌面不受影响 |
| tools-inspector | 工具清单与历史调用、失败次数统计与只读性 |
| skills-inspector | 技能来源与会话加载历史、无宿主机桌面时的降级提示 |
| user-message-fork | 首轮消息点击后新建同工作区会话并回填这条消息；其余消息子会话只继承前置历史，草稿可编辑，原会话不变 |
| yolo-mode | 安装后默认停用、原生权限选择器可见；打开行开关并重启后用户提问正常、常驻服务可启动；关闭行开关并重启后原生权限控制恢复 |
| web-search-switch | 开关热加载即时生效并落盘，重启 dsh 后保持；官方「网页搜索」卡片随之消失/恢复 |
| agents-md | 设置页编辑、保存与 dsh 加载器反向认领一致 |

## 后续任务

- [ ] 组件停用/启用后的浏览器半回归：每个组件的行开关在真实宿主里生效，
  且不影响其他组件的槽位与服务。
- [ ] 仓库公开后实测「添加插件」用 Git 地址安装（`file:` 相对依赖在 git 依赖语境的解析基准）。
- [ ] 按 [dsh-upgrade skill](../.agents/skills/dsh-upgrade/SKILL.md) 跟进官方 dsh 新版本，
  完成后回写 [源码依据](02-dsh-facts.md) 的适配基线。
- [ ] 新增插件前先更新 [决策](01-decisions.md) 与 `plugin-catalog.json`，并在
  [插件索引](plugins.md)、组合包 README 与组件 README 同步登记。
