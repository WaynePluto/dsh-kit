# 05 · 当前进度

只记录当前能力和下一步任务。完成一项立即勾选；自动测试与用户实机验收分开记录。
本轮重构（2026-10-10，删除远程能力并更名 dsh-kit）前的历史记录见
[docs/changelog](changelog/) 与 git tag `dsh-remote-final`。

## 已实现

- [x] 切屏停靠（session-park，2026-10-29，D22）：窗口失焦/隐藏（blur + visibilitychange
  双信号，alt-tab 只触发 blur、最小化两者都触发）持续 3 秒且到点复查「仍离开且当前 main
  会话仍在运行」时，经官方 `uiWorkspace.startSession()`（与原生「新建会话」同路径，复用
  当前工作区 blank）把 mainView 让给空白会话——上游 `completionUnread` 只在会话结束时
  「不在 mainView」才记（isMain 判定，面板页挡住时同样不清 retain），停留的运行中会话
  结束因此从来没有绿点；本组件在「人已离开」时满足该判定的前提。纯浏览器半、全程公开
  Context service（sessions/uiSession/uiWorkspace）、零 DOM 注入、无设置项（组件总数 26，
  全部带浏览器半，计数口径与 plugin-catalog.json 对齐）；每个离开周期最多停靠一次、不
  自动切回；warning/ongoing 状态点不做 isMain 过滤，停靠不影响。顺带补登 panel-toggle
  上次提交漏掉的四处登记：plugin-catalog.json 条目（suite-toggle/upgrade/tarball 等
  实机检查的期望行清单从 catalog 派生，漏登会让检查跳过该行）、verify-suite-client.mjs
  期望清单、docs/plugins.md 分发组合行、conversation-enhancements README 与 locale 描述；
  并按 D21 单资产口径修正 docs/03-architecture.md 的 suite:pack 产物行。
- [x] 聚焦/折叠工作区单钮化（workspace-collapse，2026-10-29）：去掉「收起/展开全部」
  按钮（展开全部实用价值低），保留的聚焦按钮改为双态——有展开分组时是「折叠所有工作区」
  （组合字形 chevron 翻转指向彼此，点击一键折叠全部），全部收起后是「仅展开活动的工作区」
  （chevron 指向外侧，点击聚焦展开活动分组并置前）；方向仍由行内 `aria-expanded` 实时
  跟随，文案「收起全部」改「折叠所有」。容器从双钮宽改单钮 28px，删除双 chevron 叠放
  字形与对应 CSS。
- [x] 体验批量修正四项（2026-10-27）：① workspace-collapse 新增第二枚「聚焦有提醒的
  工作区」按钮（原生 IconSlidersTwoOutlineMedium 字形，与收起/展开钮同容器）：按会话行
  原生状态点（`StateDot` 的 `data-state`：ongoing=运行中、warning=待用户操作、done=完成
  未读）判定提醒，先多轮展开有提醒的收起分组、再逆序收起子树无提醒的分组；归属按上游
  renderGroup 的 section 结构（`groupSection > HoverCard span > 行` + `div[role=group]`
  包子分组），结构不符时退化为无操作，收起中分组的隐藏后代提醒不追溯（DOM 边界）。
  ② terminal dock 终端画面 11px→13px、输入框 12px→13px（dsh 正文字号，实机反馈看不清）。
  ③ tools-inspector 展开条目的详情区新增「复制工具名」按钮（primitives writeClipboard，
  成功短暂显示「已复制」）。④ services 列表行首来源徽标恒显示（原依赖当前会话锚点，
  无锚点时整列徽标消失；ServiceRow 不再读 sessionCwd，快照 cwd 字段仍供宿主排序）。
- [x] 会话工作区显示（session-workspace，2026-10-27，D19）：输入框下方统计栏（原生
  StatsPills）最左新增工作区 pill——文件夹图标 + 当前会话 cwd 的末级目录名，悬停 title
  显示完整路径，点击复制完整路径并短暂显示「已复制」（剪贴板被拒时不变标签，title 常在）。
  走官方 `conversation.composer.dock` list 槽位（session 作用域，原生注释明示插件可按 id
  新增 pill），`order: -1` 排在原生 activity/usage 之前，不覆写官方行；cwd 取浏览器半
  sessions 标准服务 `byId[sessionId].cwd`（与原生工作区悬停卡同源），无 cwd 不渲染、切会话
  随槽位作用域刷新。样式逐条复刻原生 pill 契约（12px 次级字号、1px 8px 圆角、tertiary
  静息色、hover interactive-bg-hover）。纯浏览器半、无宿主服务（组件总数 23，全部带
  浏览器半，计数口径与 plugin-catalog.json 对齐）；随 conversation-enhancements 组合包
  分发。显示形态与「新建组件不并入既有组件」均为用户当次确认。
- [x] 插件性能整改·第二轮（2026-10-23，services 修复后的全套件审查）：修复 11 个组件
  的 13 项确证性能问题（3 高 6 中 4 低），核心病灶是浏览器半「常驻无过滤全量」——
  与 services 当初的宿主半同步探针同性质，只是发生在 DOM 层：
  - body 级 MutationObserver 泛滥（流式输出每批 DOM 变更都做全文档扫描）：stats-hours
    含 characterData，回调改为按 records 判定弹窗子树相关性后才全 body 扫描（弹窗
    绝大多数时间不存在）；workspace-collapse 按 records 判定工作区行挂载/卸载与行内
    aria-expanded 后才全文档查询；files 发现树根按 records 判定 `[data-files-state]`
    挂载/卸载后才扫描绑定表；workspace-path 观察范围从 subtree 收窄为 body 直接
    子节点（portal 菜单本就 body 直挂，删除「被包一层」防御形态）。
  - chat-scroll（高）：每条已完成助手消息的操作按钮各挂 useChat selector 线性扫全
    order，流式期间每次 store 通知 O(轮数×节点数)；改按 snapshot 建一次
    messageId→key 反查索引（WeakMap，每次通知 O(order+按钮数)）。
  - user-message-fork：previousCompletedTurnEnd 改按 timeline 建一次前缀索引；
    UserMessageForkNodeView 与官方 UserMessageNodeView 一致地包 memo。
  - models-catalog（宿主半，唯一阻塞宿主事件循环的问题）：modelFamily 解析结果缓存
    + nearestNativeModel 按 route 缓存候选分组（runtime 注册只增 runtime 模型、原生
    候选集不变，缓存无需失效）；planRoute 内按 id 缓存 API/推理档位派生值并把
    ownedModels 循环内线性查找换 Map；status/preview 无写入时复用同一次 route facts
    读取（写入后仍重读）。打开模型设置页不再对每个新增模型 × 每个候选做全表重解析
    （openrouter 401 模型时原为 10⁵–10⁶ 次字符串解析）。
  - files：树内重装饰经 rAF 合并 + 快照级 status 缓存（重复装饰跳过 2000 条 Git 条目
    线性扫描）；图片预览 overlay 坐标未变返回同引用（滚动/缩放 tick 不再触发重渲染
    与 style.zoom 自激发循环）、滚动回调用已认领的 view 就地重算并 rAF 合并；diff
    行投影（wrapped-split/unified）移入 useMemo（split 不换列原已 memo）。
  - agents-md：编辑器每击键一次全量 UTF-8 编码（原两次，encoder 复用单例；上限 1MiB）。
  - terminal：screen 轮询 unchanged 分支同引用 bail out（仅首帧或 running 翻转发
    新对象），面板打开期间不再每周期重渲染 + scrollHeight 强制布局读。
  - favorite-models：selected/staleFavorites 按 input memo（搜索击键不再全目录重建
    favoriteKey Set）。
  - model-capabilities：select 样式改引用计数共享一份（原每个展开的模型行 portal
    一份 `<style>`）；Panel 的 models 按 snapshot.value memo，修复 groups useMemo
    因新数组引用恒失效。
  nav-glyph 共享观察器（notify/agents-md）本就有 className 过滤 + rAF 合并，不动。
  回归锁：chat-scroll locate（同 snapshot 单次遍历）、workspace-collapse（无关变更
  与行外 aria-expanded 不查询）、stats-hours install（无关变更不扫描、弹窗覆写仍
  改写、卸载停改写）、files adapter（rAF 合并装饰新行 + 无关 body 变更不扫描）、
  user-message-fork（同 timeline 单次遍历）。
- [x] 常驻服务面板性能修复（2026-10-23）：页面慢的根因是每次 list/logs 前的全量对账做了
  2N 次同步 PowerShell 身份探针（每条记录判两遍 × ~0.4s/次，3 服务实测 ~2.4s，且 spawnSync
  阻塞宿主事件循环）。修复：`identifyBatch` 逐条 signal 0 现查存活 + 一次子进程批量取创建
  时间，判定结果随条目透传不再二次询问；展示轮询带 20s 缓存窗口（实测冷 ~380ms、窗口内
  1–2ms、零 spawn）；stop/restart/start 始终现查（缓存不能作终止依据）；`logsOf` 改为只查
  注册表 + pid 存活（毫秒级），`tailFile` 限 256KB 尾窗；页面加「正在读取服务…」加载态，
  轮询加防重入。回归锁：refresh 单条只判一次、identifyBatch 一次探测表、tailFile 有界窗口、
  logsOf 不对账。
- [x] 常驻服务迁移「服务」全局面板（2026-10-23，D18）：浏览器半从 `conversation.input.dock`
  （session 域 dock 卡）迁到侧边栏全局面板——`main` keyed 槽（key = `dsh-plugin-services`）注册
  主列页面 + `sidebar.panellist` 注册侧边栏行（order 20，排在插件 0、自动化任务 10 之后），
  D17 的部署级数据配部署级 UI；两者都是官方扩展点（ui-plugin-manager/ui-schedule 同款双注册），
  无 DOM 注入。页面恒显示（空态说明替代 dock 的“无服务即隐藏”），「当前工作区排前 + 外来源
  徽标」的锚点每次轮询经 `uiSession.adapter.current` 现取（面板无会话绑定；选中面板时会话列
  卸载，但 mainView 保留由工作区导航层持有，当前会话仍可解析）；RPC 契约 `sessionId` 变可选
  （缺省 = 无锚点不排序、restart 门控 fail closed）。日志弹窗、名称/事实中省略、5 秒轮询与
  可见性门控原样保留；页面版式按官方一级页翻译（960px 内容列、28px 标题上距、darwin 顶栏补偿）。
  侧边栏行图标用 IconApiOutlineRegular（行座位 16/18px 字形族）。services-check 断言改为
  两座位 + key/id 一致 + order 20 + anchorless list；浏览器契约记录在
  [插件机制](dsh/plugins.md) 的「全局面板」一节。
- [x] 一键收起/展开工作区（workspace-collapse，2026-10-22）：侧栏「工作区」标题栏（搜索按钮
  左侧）新增动作按钮——只要还有展开中的分组就是「收起全部工作区」，点击折叠下方全部工作
  区分组（含未分组桶与当前会话所在分组，重启后保持）；全部分组收起后就地变「展开全部工作
  区」，用户手动逐个折叠/展开时文案与字形实时跟随。section header 是 ui-workspace 私有界
  面、无插件槽位，展开状态在其私有 view store（persist `dsh.workspace.view.v5`），组件按
  DOM 注入工作：从工作区行 `[data-row-key^="workspace:"]` 向上找带 sectionHeader 直接子节
  点的祖先定位头部，按钮插在搜索槽（searchSlot）之前（原生动作簇 max-width 60px 只装两钮，
  不可内插；searchSlot 的 `margin-left:auto` 会把注入项顶到标题旁，容器以同名 auto margin
  接管剩余空间并把该 margin 归零）；收起对全部 `[aria-expanded="true"]` 分组行按文档逆序
  （树形模式先子后父）合成 click，展开按文档顺序多轮点击（上游只在父分组展开时渲染子分组
  行，每轮之间等渲染落 DOM、每行只点一次），都走原生 onToggle 写回 store 并持久化；方向
  跟随靠观察器监听行内 `aria-expanded` 属性变化（叶子分组折叠/展开只改属性、无 childList）。
  分组视图未展示（flat/搜索/空态/rail）时无工作区行，按钮一并隐藏；搜索展开时经
  `:has(~ …headerActionsHidden)` 随原生动作簇同节奏退场。样式复刻原生 iconButton 28px 契约，
  图标为两条原生 chevron 字形纵向叠放的挤压记号（收起方向两箭头指向彼此，展开方向指向外
  侧），原生 Tooltip。纯浏览器半、无宿主服务（组件总数 23，浏览器行 22）；随
  conversation-enhancements 组合包分发。
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
  套件层对官方行的任何覆写（llm-pi-ai 屏障、connection webServer 注入）都会让
  套件启停的重组合重启该行 fiber，沿注入链（sandbox-policy → fs-sandbox → fs →
  session-controller；llm-pi-ai → llm → session-controller）级联，其内嵌 file-upload 在旧
  注册未释放时二次注册，会话服务当场失败且重启前不恢复。修复（D16）：套件层全部官方行
  覆写移除——宿主半私有 RPC 统一迁移到官方 `connection.fetch.register`
  的 `/api` 精确路由（新共享包 `@dsh-kit/plugin-rpc`，11 个组件宿主半 + 浏览器半 + 8 个
  check 脚本），模型晚注册生效无需启动屏障（删除 fallback 占位行与 BOOTSTRAP 服务）。
  新增 `scripts/suite-toggle-check.mjs`（在线停用/启用全程官方行 ACTIVE、零报错签名），
  `suite-first-enable-check` / 8 个组件 check 全绿。顺带修复
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
| 首次在线启用 | 安装完成弹窗点「立即启用」不再报整包 failed to import（组件行延迟到重启装载）；重启后全部组件装载 |
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
| workspace-collapse | 工作区标题栏搜索按钮左侧出现一枚双态动作按钮；有分组展开时显示「折叠所有工作区」（chevron 指向彼此），点击后全部分组折叠（含未分组桶与当前会话分组），重启后保持；全部收起后就地变「仅展开活动的工作区」（chevron 指向外侧），点击逐层展开全部分组（含嵌套子分组）后收起无提醒会话的工作区；聚焦后活动工作区按字母序置前；手动逐个折叠/展开时按钮文案与字形实时跟随；flat 列表、搜索态与 rail 下按钮不出现，搜索框展开时按钮随原生动作簇退场；停用组件后按钮消失；深浅主题与中英文界面 |
| services | 启动、就绪、日志、停止；重启 dsh 后服务存活并能认领；跨工作区：另一工作区面板可见并可停止/读日志（每行恒带来源项目徽标、当前工作区排前），`service_list scope:"all"` 与全局重名拒绝；日志在 DSH_HOME/dsh-kit/logs（项目目录零落盘），旧项目注册表与旧日志首次触达时自动认领/回捞；侧边栏「服务」行（order 20、rail 收起态图标）、页面空态与刷新、单行省略与日志弹窗全屏、无当前会话时重启被拒（含深浅主题与中英文）待实机确认 |
| terminal | 人类直接输入，默认密码遮罩；忙碌时保留草稿，中断有效；Linux sudo 任务复用系统缓存待实机确认 |
| files | 图片缩放与 Space + 鼠标左键拖动平移、临时预览/双击保留、当前分栏关闭其他/全部方案待实机确认；Git 变更面板（右键入口、清单与 diff、左右对比/换行、深浅主题与中英文）待实机确认 |
| notify | Windows 通知实际弹出、点击卡片把官方桌面版带到前台（未装桌面版时退化为仅关闭）、关闭按钮仍只关闭、专注助手与权限设置提示正确；任务运行中手动停止后不弹通知，失败等其他结束仍弹出。设置页开关写入在 CLI 冒烟形态被上游 0.2.0-rc.2 缺陷阻塞（见 [插件机制](dsh/plugins.md) 设置写入一节），官方桌面不受影响 |
| panel-toggle | 面板页（插件/自动化任务/服务）选中时再点一次该侧栏行回到当前会话；未选中行、气泡菜单选中项与「更多」不受影响；停用组件后恢复原生无效重选 |
| session-park | 停留在运行中的会话切屏离开，约 3 秒后回来：主视图停在当前工作区空白会话；原会话结束后侧栏行亮「完成未读」绿点，点击回原会话绿点清除、草稿仍在；快速 alt-tab（3 秒内回来）不动作；面板页挡住会话时切屏同样停靠；待操作黄点与运行中蓝点不受影响；停用组件后切屏不再停靠；深浅主题与中英文界面（组件清单名称） |
| tools-inspector | 工具清单与历史调用、失败次数统计与只读性；展开条目的「复制工具名」按钮复制成功并短暂显示「已复制」 |
| skills-inspector | 技能来源与会话加载历史、无宿主机桌面时的降级提示 |
| user-message-fork | 首轮消息点击后新建同工作区会话并回填这条消息；其余消息子会话只继承前置历史，草稿可编辑，原会话不变 |
| web-search-switch | 开关热加载即时生效并落盘，重启 dsh 后保持；官方「网页搜索」卡片随之消失/恢复 |
| agents-md | 设置页编辑、保存与 dsh 加载器反向认领一致 |

## 后续任务

- [ ] 0.2.1-rc.3 适配遗留（2026-10-25）：① 官方桌面实机验证待跑（重启桌面 →
  `node scripts/verify-suite-client.mjs --token <宿主打印的 token>` → 按 02-dsh-facts
  检查表点检，含 rc.3 新「更多」菜单与入口收起场景、深浅主题）；
  ② **已修复**：pnpm 10.17.0 在 Windows 把 `link:<盘符绝对路径>` 当相对路径生成坏符号
  链接——dev 栈改为 dsh 固定使用运行时自带的 pnpm（dev-runtime 钉 12.11.2，dev-suite
  生成 .dev/pnpm-shim 前置到 PATH；pnpm ≥11 包内是原生二进制布局，--ignore-scripts
  安装后须走自建 shim）；`pnpm dev` 包装层前置的 node 目录里恰是 10.17.0，是其绕不开
  的原因。官方桌面安装不受影响（GUI 环境无此 PATH 前置），仅 pnpm ≤10.17 的 Windows
  用户经「添加插件」装本地路径套件时可能命中，待上游 pnpm/dsh 修复；
  ③ **已修复**：suite-first-enable-check 的守卫断言改为「要么守卫延迟、要么完整装载」，
  排除中间/失败态（组件包从套件自身 node_modules 解析时立即装载属合法结局）；
  ④ CLI web 宿主 `settings/mutate` 持久化缺陷（dual app-boot 实例致 bootstrapIncludes
  miss，0.2.0-rc.2 起已知，见 docs/dsh/plugins.md）：rc.2/rc.3 复核均未修复，桌面 rc.3
  实测正常；notify-check 按精确签名豁免，上游修复后移除豁免并复核。
- [ ] files-check 修复（2026-10-25，随 rc.3 适配发现并已修复）：宿主 mock 从 D16 前的
  `connection.rpc.handle` 对齐为 `connection.fetch.register` 精确路由，未认证断言改打
  同一 `/api/files` 路由（401 契约在 rc.3 完好）。
- [ ] models-catalog 与官方 0.2.1-rc.3「DeepSeek 官方端点跟随 GET /models」部分重叠：
  官方端点、未自定义 models 的用户不再需要本组件发现 DeepSeek 新模型；自定义目录后
  停止跟随、非官方端点/其他路由仍是本组件独有价值（详见 README 三条硬规则）。保留
  待用户决策是否精简文案或补 `isBuiltInCatalog` 对齐清理逻辑。
- [ ] 插件性能整改实机验收：长会话流式输出期间主线程占用下降（chat-scroll/
  workspace-collapse/stats-hours/agent-md 四个常驻观察器组件）；models-catalog 打开
  模型设置页在大路由（openrouter）下的首屏不再数百 ms 卡顿；files 图片预览滚动/缩放
  与 Git 面板交互流畅；其余小项随日常使用回归。
- [ ] 组件停用/启用后的浏览器半回归：每个组件的行开关在真实宿主里生效，
  且不影响其他组件的槽位与服务。
- [x] 「添加插件」Git 地址安装实测（2026-10-27）：不可行，三层原因——
  1. 仓库根包 `dsh-kit-root` 带 `prepare: husky`，pnpm 11+ 对 git 宿主包的生命周期脚本是
     致命门禁（`ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`，需消费方工作区 allowBuilds 放行），
     dsh 非交互安装直接失败；且根包没有 `dsh` 插件声明，放行也装不出插件。
  2. 子目录形态 `https://<host>/<repo>#path:plugins/suite` 能绕过门禁（套件无生命周期脚本），
     但套件的 `file:../<组件>` 依赖被 pnpm 按**消费方工作区目录**解析而非 git 检出树
     （pnpm 12 实测报 `Could not install from "<cwd>/../agents-md"`），解析必然失败。
  3. 即便解析可过，git 提交树不含 `dist/` 与套件物化 `node_modules/`（.gitignore 排除），
     装上也没有可装载产物。
  结论：Git 直装要成立，必须把套件做成自包含远程产物（组件 dist 与依赖闭包进包、
  依赖不指向包外，配 release 分支或 tarball 资产）；这属新的分发决策，待用户确认。
  上游可改进项：dsh plugin-manager 的失败分类器（`packages/boot/plugin-manager/src/install-failure.ts`）
  未覆盖 `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`，该错误显示为原始文案。
  现行分发仍是本地绝对路径（clone 后装 `plugins/suite` 不受影响）。
- [x] 远程分发实施（2026-10-27，D20）：套件改为自包含产物——package.json 零
  dependencies、24 个组件声明为 peerDependencies（精确版本，`build-suite.mjs` 校验
  覆盖与版本一致），依赖闭包照旧物化在套件内 `node_modules/`；安装地址三形态统一
  （本地目录 link:、本地 tarball、GitHub Release 资产 `…/releases/latest/download/dsh-kit.tar.gz`
  latest 永久链接）。裸仓库地址不可用的实测结论保留在上方条目（pnpm 对 git 形态 URL
  走 npm-packlist 剥 node_modules + prepare 门禁）；普通 tarball 不做 packlist 不跑
  prepare，包内物化内容原样落地。发布走 `release.yml`（push v* 标签 CI 自动构建打包
  上传固定资产名），本地 `pnpm suite:pack` 同路径打包。守护：`suite-tarball-check.mjs`
  （不可达 registry 安装 tarball + 真实 dsh 冷启动，断言 23 组件行 ACTIVE、客户端图
  23/23、零 registry 解析）与 suite-toggle / first-enable（junction 形态）三检查在
  peers 形态下全部通过。推仓库与首版标签已完成（2026-10-28 首发并重发 v0.0.1，D21 单资产形式；
  2026-10-29 同版本号第三次重发：26 组件，新增切屏停靠并补登 panel-toggle 登记，用户决策
  「版本号仅在明确指定发新版本时更新，否则同版本号重发覆盖」，发布资产与本地构建清单级一致）；
  待办：真实 Release URL 升级的桌面实机验收（用户桌面从旧 0.0.1 升级覆盖）。
- [x] 带 tag 单资产原地升级（2026-10-28，D21；同日由双资产修订为单链接形式）：
  官方「添加插件」对已装包的拒绝只在 spec 能预先反查出包名时发生——同地址重复输入
  命中拒绝（D20 的「升级 = 卸载重装」由此），输入**字符串不同的新版本地址**则放行，
  pnpm 原地替换同包名依赖后 HMR 热装载（查证记录见 [插件机制](dsh/plugins.md)
  「覆盖安装与升级语义」；官方「更新」按钮只给官方目录包，第三方无）。实施：
  `release.yml` 单资产上传（每个 Release 一个 `dsh-kit.tar.gz`，地址带 tag）、
  `pack-suite.mjs` 产物落 `release/v<版本>/`、安装/升级地址统一为
  `releases/download/<tag>/dsh-kit.tar.gz`（README 下载链接随发版更新 tag）、
  suite-updates 组件（套件详情页「检查更新」：GitHub latest 查询 + 升级地址复制，
  安装仍走官方「添加插件」）。守护：`suite-upgrade-check.mjs`（旧版 tarball 冷启动
  24 行 ACTIVE → 在线 installBundle 新地址 → applied 热生效、24 行重新 ACTIVE、
  核心行稳定、依赖值换新、同 spec 重装被拒 already-installed）与
  `suite-updates-check.mjs`（check 端点真实查询 GitHub、URL 形态、未知端点拒绝），
  2026-10-28 本机全通过；CLI `dsh plugin --profile desktop add <spec>`（裸 pnpm、
  无拒绝、重启生效）为兜底路径。
- [ ] 按 [dsh-upgrade skill](../.agents/skills/dsh-upgrade/SKILL.md) 跟进官方 dsh 新版本，
  完成后回写 [源码依据](02-dsh-facts.md) 的适配基线。
- [ ] 新增插件前先更新 [决策](01-decisions.md) 与 `plugin-catalog.json`，并在
  [插件索引](plugins.md)、组合包 README 与组件 README 同步登记。
