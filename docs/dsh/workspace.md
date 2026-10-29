# 技能、提示词与工作区文件

基线见 [源码依据](../02-dsh-facts.md)。以下路径相对 dsh 仓库根，项目实现明确标注。

## 技能目录

出处：`packages/skill/skill/src/index.ts`、`packages/skill/skill-filesystem/src/index.ts`。

| 方法 | 内容 |
|---|---|
| list(options) | SkillSummary 列表 |
| snapshot(options) | 列表与 complete，provider 失败时为 false |
| get(name,options) | 含 content、path 的完整 SkillDefinition |

options 必须带会话 cwd 与 ctx.agents.get(sessionId) 的 scope，否则只能看到全局层。
观察页使用 snapshot，不能把 provider 失败呈现为技能凭空消失。
list 的 summary 只有 resourceBase 目录，没有精确文件路径；get 会同时读正文，因此仅点击展开时 locate。

SkillSummary.source 是开放联合，必须保留未知来源兜底：

| 来源 | 根 |
|---|---|
| project-dsh | projectRoot/.dsh/skills |
| project-agents | projectRoot/.agents/skills |
| custom | 显式配置目录 |
| user-dsh | dshHome/skills |
| user-agents | agentsHome/skills |
| bundled | 内置技能 |
| runtime | 插件注册 |

## 已加载历史

出处：`packages/skill/tool-skill/src/index.ts`、`packages/core/session/src/types.ts`。

两条正文注入路径都持久化：模型 skill 工具对应 tool/call.arguments；用户 /技能名对应
user/message 的 source.kind:skill-invocation 和 source.name。

- 回放 session.snapshotEvents，覆盖整个会话含继承历史，重启不归零。
- arguments 是模型原始 JSON 字符串，JSON.parse 必须 try/catch，畸形记录不能使整页失败。
- 配对 tool/result 带 error 的加载不计；尚未配对的 call 暂计，避免正在加载时闪烁。
- 这是“历史上曾注入”的口径，不保证压缩后正文仍完整保留在当前上下文。
- 技能页只读，不注册技能/来源/工具、不 restrict/guard，也不提供加载按钮。

## 打开本机文件

出处：`packages/client/ui-open-in-app/src/client/{OpenInAppAction.tsx,controller.ts}`、
`packages/host/open-in-app/src/{catalog.ts,index.ts,resolver.ts}`、`packages/api/session-controller/src/index.ts`。

- 对话顶部「在本地打开」不是 session Remote：原生浏览器调用 open-in-app 的 HTTP 路由，传 app id 与当前会话 cwd；
  宿主先做 connection trust/auth、绝对路径和真实目录检查。其它文件动作仍可使用
  `remote.session.canOpenWorkspacePath/openWorkspacePath`（0.1.7 起 Session Remote 提供打开/揭示与应用列表）。
- dsh 0.1.7 的 Windows 原生 opener 直接调 `explorer.exe` + 单一 file URI 参数（无 shell、无 PowerShell 中转），
  Explorer 交接退出码 1 视为成功；`Visible:false` 问题不再存在。原生实现等待交接应答，且不做窗口激活。
  dsh-kit 不接管此项：插件不再 shadow `conversation.session.header.utilities` 的 `open-in-app`，
  保持原生路由与行为；需要置前或立即返回时再评估（原来为远程访问加的私有通道已随远程能力删除）。
- 动作发生在运行 dsh 的本机桌面；插件不按 Host 判断同机，也不假定用户在别处。

## Agent 预设

dsh 0.1.7 起 Agent 预设改为 profile YAML 声明（上游 `d1e22a7e24`，包 `@deepseek-ai/dsh-agent-preset-registry`），
`settings/openAgentPresetDirectory` RPC、`agentPresets.resolve` 的 path/trust 概念均已移除；本项目原先针对
0.1.6-alpha.2 隐藏 PowerShell opener 的预设目录接管已随之删除。预设的创建、编辑与默认选择全部走原生 UI；
上游 Windows opener 行为见上节。

## 全局提示词

出处：`packages/context/agent-instructions/src/{files,render,config,index}.ts`。

discoverBaselineInstructionFiles 先收集 dshHome/AGENTS.md，再收集项目根到 cwd 的项目文件。
文件缺失是正常状态。显示路径为 ~/.dsh/AGENTS.md 或 $DSH_HOME/AGENTS.md。
USER_GLOBAL_FILE 定义在内部 render.ts，不在公开入口，插件只能保留对应常量。

项目 agents-md 只编辑这一份全局文件，不注册额外 agent-instructions 行、不把正文存入设置 namespace。
按 UTF-8 字节校验默认 1 MiB 上限，超过 maxSourceBytes 的文件会被 dsh 静默跳过。
两半共享 documentFault，临时文件加 rename 原子保存，失败保留草稿。

升级验证不能只测自己的常量：写入标记后调用 dsh 导出的 discoverBaselineInstructionFiles，
确认真实加载器认领了该文件，见 scripts/agents-md-check.mjs。

## 原生文件树与文档预览

出处：`packages/client/ui-sidebar-files/src/client/{index.ts,FilesBody.tsx,face.ts,store.ts}`、
`packages/client/ui-sidebar-documentpreview/src/client/{index.ts,TextPreview.tsx,document/contract.ts}`、
`packages/api/workspace-files/src/index.ts`。以下为当前基线的原生契约，项目增强范围见下一节。

- 原生树属于 `ui-sidebar-files`（页面 kind `files`），不是 `ui-sidebar-documentpreview`。
  树按层调用 `remote.workspaceFiles.list`，目录优先、自然排序，默认显示 dotfiles；
  点击文件通过当前 tab 的 `actions.openResource` 导航，默认落在该 tab 所在 pane。
- 原生树的 `Entry`/`Level` 是包内组件，没有行装饰子槽或自定义 onOpen prop。
  DOM 提供 `data-files-entry`、`data-files-path`，但这不等同于稳定的 Git 装饰 API。
- 文档预览为资源 tab（kind `text`），原生负责加载、渲染器切换、换行、刷新、变更提示与行号导航；
  提供纯文本、代码、Markdown、HTML、图片、PDF。它是预览，不提供编辑/保存。
- `sidebar.right.tab.document` 子槽用于注册正文渲染器，内容由原生 owner 准备，
  不是外部任意容器可直接调用的完整预览组件。两包 client 入口没有 FilesBody/TextPreview 值导出。
- `workspaceFiles` 的目录列举限制在 Session 工作区内；文件读取/stat/readRelated 接受
  绝对或相对路径，允许读取组合文件系统授权的工作区外文件。末端 lstat/普通文件检查
  不等同于项目 files 的逐段拒绝 symlink、读取前后身份复核。
- 原生 scope 从 live Session header 或持久层 header-only stat 解析，缺 cwd 时用 sandboxPolicy 根，
  不要求 live Agent。项目 Git 端点的 live Agent/cwd 边界不能因此被默认放宽。
- 默认文本页最多 2 MiB / 5000 行，完整字节读取最多 32 MiB，目录响应最多 2000 项；
  `list` 先 listDir 再截断响应，不保证目录枚举工作量有界。文本可继续分页，没有旧 files 的 1 MiB 整文件门槛。
- 文件变更来自 `fs/observed` 而非 OS watcher，不覆盖 shell/Git/外部编辑器的改动；
  不能用该流宣称 Git 状态实时准确。HTML 预览会在隔离 iframe 中执行脚本，并可请求外部资源。

### 原生图片缩放与项目增强

出处：`packages/client/ui-sidebar-documentpreview/src/client/{zoom/ZoomViewport.tsx,zoom/ZoomControls.tsx,image/ImageBody.tsx,image/ImageBody.module.css}`、
`src/client/document/contract.ts`（`src/client` 均属于同包）；已安装 `0.2.0-rc.2` 的 `lib/client.js`
包含 `ZoomViewport` / `ImageBody`。项目实现见 `plugins/files/src/client/imageZoomOverlay.tsx`、`imagePan.ts`。

- 原生 `ImageBody` 使用共享 `ZoomViewport`，每个 tab 单独保存缩放偏好，默认「适应宽度」（仅缩小宽于视口的图片）；
  原生工具栏提供适应宽度和固定档位（25%、50%、100%、150%、200%），增减按钮及 Ctrl+滚轮可在 25%～400% 范围缩放；`scrollportRef` 报告其滚动容器。
  原生没有「适应窗口」（同时按宽高缩放）或 Space+鼠标拖动平移。
- 图片登记在 `sidebar.right.tab.document`，key 为 `@deepseek-ai/dsh-client-ui-sidebar-documentpreview/image`；
  该登记是 TextPreview entry 声明的 child slot。root `ctx.slots.entries` 不能直接重声明这个 child：重复声明 owner
  会失败，不能把它当作普通全局 slot shadow。
- child owner 提供 `content`（原生已读取的完整 bytes）、`resourceAddress`、`wrap`、`scrollportRef`，
  并提供 `useTabInfo`。`scrollportRef` 可报告 renderer 自有滚动容器，传 null 退回共享正文滚动面；项目不接管这个 child owner。
- 原生图片内部负责 Blob URL 创建/回收和加载/失败状态，DOM 标记为 `data-image-preview`；SVG 仅作为
  img Blob URL 显示，不内联为活动 SVG。项目在原生 title slot 生成附加 portal 控件，提供「适应窗口」、
  Ctrl/⌘+滚轮及按住 Space 再按鼠标左键拖动原生滚动容器平移；通过当前版本
  `data-textpreview-*`、`data-image-preview`、`data-document-zoom-scrollport` 定位原生已渲染元素，
  对原生 image frame 叠加 CSS zoom，不重读文件、复制字节缓存或改变 Blob/SVG 隔离。
- 该定位是版本受控局部契约；深浅主题、不同尺寸图片、resize/卸载及原生缩放交互仍需矩阵验收。
  如果上游改变这些 data 属性，应让检查失败而不是深层 import 或复制 ImageBody。

## 工作区列表与 ··· 菜单

出处：`packages/client/ui-workspace/src/client/rows/Rows.tsx`、`contract/slots.ts`、
`packages/client/ui-primitives/src/Menu.tsx`、`packages/api/workspace-controller/src/types.ts`。

- 工作区行 `data-row-key="workspace:<workspaceId>"`（会话行 `session:<id>`、溢出行 `overflow:`、
  未分组桶无 `···` 菜单）；行 hover 卡片原生带 cwd 复制按钮（`copyText`，约 800ms 延迟）。
- 工作区行 `···` 菜单是 ui-workspace 私有的 rename/delete 两行，**没有插件槽位**；只有会话行
  菜单有 `sidebar.workspaces.session.menu.item`（pin 100/rename 200/fork 300/archive 400/
  session-id 450，order 插入，`useMenuOpenState` 关菜单）。
- Menu portal 直接挂 `document.body`（`MenuSurface[role=menu] > div[role=presentation]`）；
  方向键走查读 DOM（`querySelectorAll('button:not(:disabled)')`），DOM 注入的
  `button[role=menuitem]` 自动加入导航；Escape 在 document 捕获层关闭并归还锚点焦点，
  注入项拿不到 owner onSelect，可用合成 Escape keydown 代偿关闭。
  工作区行菜单传 `closeOnPointerLeave`：wrapper `onPointerLeave` armClose（200ms 宽限，
  `packages/client/ui-primitives/src/pointer-grace.ts`），取消只靠 wrapper `onPointerEnter`
  （React 从 pointerover 推导）——独立 React 根的注入行必须自建补偿：跨根 over/out 过渡
  无共同祖先，React 把离开侧整条祖先链派发 leave，且 `pointerout`（离开原生行）与
  `pointerover`（进入注入行）**各 arm 一次**；容器 `pointerenter` 立即合成 viewport 上的
  `pointerover`（bubbles、relatedTarget null）取消第一拍，`pointerover` 里 `setTimeout(0)`
  再补一次覆盖第二拍（首版只补 pointerenter 被第二拍覆盖，实机两度复现）；
  `pointerout`（relatedTarget 不在 viewport 内，即直接移出菜单）再补一次 viewport 上的
  `pointerout` 让宿主正常延迟关闭（2026-10-22 实机复现并修复）。
- 工作区路径：浏览器半 `workspaces` 服务（`@deepseek-ai/dsh-api-workspace-controller/client`
  声明合并，`ctx.workspaces.list.getSnapshot().items`）给出 `WorkspaceView.path`
  （canonical host 目录）；页面冻结模块表不含 workspace API，只能经 Context service 读。
- workspace-path 组件按 deepseek-official-switch 卡片操作区同款结构化注入：捕获工作区行点击
  归因（600ms 窗口、一次性、非行菜单不消费）→ 认领随后出现的菜单 viewport →
  `MenuItemButton` 插在危险项（删除）之前；`data-row-key` 前缀或 Menu 结构变化会静默失效。

### 工作区标题栏与分组折叠

出处：`packages/client/ui-workspace/src/client/rows/{WorkspaceBrowser.tsx,Rows.tsx}`、
`stores.ts`（view store persist `dsh.workspace.view.v5`）。

- section header（标题 + 搜索 + 视图选项 + 新增工作区）**没有插件槽位**；展开状态存在
  ui-workspace apply 内私有铸造的 view store 实例，插件拿不到写入句柄。
- 分组头行是真实 DOM：`div[data-row-key^="workspace:"]`（未分组桶 key 为空串即
  `workspace:`）、`aria-expanded` 反映展开态、**整行 onClick 即折叠开关**（onToggle 里
  `setGroupExpanded(key, !expanded)` 写回 store 并持久化）；折叠当前会话所在分组后不会被
  自动展开——自动展开只在 `groupExpansion` 无该 key 条目时触发，显式写入的 `false` 保留。
- 树形模式下祖先行在前、后代行在后；折叠祖先会卸载后代行 DOM。对该行合成 click 走
  React 委托监听，与用户点击完全同路径。
- **行的 DOM 归属结构（0.2.1-rc.3 核实）**：每个分组是 `div.groupSection`（CSS module
  哈希类），直接子节点依次为 HoverCard 包装 span（内含分组头行）、可选的
  `div[role=group]`（装子分组 section）、自己的会话行（各行也有 HoverCard 包装 span）、
  溢出/展开更多区。会话行到所属分组、分组到自有会话的 DOM 判定都以
  「行向上两级 = section 根 + `div[role=group]` 边界」为据；包装层变化时判定需退化为
  无操作。
- **会话行状态点**：会话行状态由 `sessionStatuses` 决定（`Rows.tsx`），主状态经
  `SessionStatusDots` 渲染为原生 `StateDot`，DOM 信号是行内 `[data-state]`（行内唯一）：
  `ongoing` = 运行中（含子代理）、`warning` = 待用户操作（审批/计划确认/提问）、
  `done` = 完成未读（打开会话清除）；`idle` 不渲染状态点（leading 槽让给插件）。行尾
  时间格在有待操作时改显紧凑文案（`trailingLabel`）。归档行状态点槽保持空白。
- workspace-collapse 组件的注入契约：从任一工作区行向上找第一个带 sectionHeader 直接
  子节点的祖先（浏览器根），按钮容器插在 `searchSlot` 之前。头部动作簇 `headerActions`
  是 max-width 60px 的定宽簇（装不下第三个按钮），不能内插；**searchSlot 自带
  `margin-left:auto`**，flex:1 被 max-width 钳住后由 auto margin 吸收剩余空间（优先级高于
  justify-content），会把注入项顶到标题旁——容器需同样 `margin-left:auto` 接住剩余空间，
  并以 `~ [class*="searchSlot"]` 兄弟选择器把该 auto margin 归零（组件移除后覆写随之失效）。
  容器装两枚按钮（收起/展开 + 聚焦提醒），max-width 按钮数预留、`gap: 2px`。
  按钮显隐由「是否存在工作区行」驱动（flat 列表、搜索结果、空状态、rail 收起态都无工作区
  行）；搜索展开时原生给动作簇挂 `headerActionsHidden` 类，注入按钮经 CSS `:has(~ …)` 随其
  同节奏退场。构建产物 CSS module 类名是 `<hash>_<原名>`，定位用后缀匹配，哈希前缀变化会
  静默失效，升级需复核。
- 聚焦提醒动作（2026-10-27）：先按文档顺序多轮点开「自有会话带提醒状态点」的收起分组
  （父分组展开后新挂载的子分组下一轮补点），再按文档逆序收起「section 子树无提醒点」的
  展开分组；子树含提醒的祖先链保留展开。收起中分组的后代不可见（未渲染），DOM 判定
  看不到藏在里面的提醒，不会为其展开祖先——这是 DOM 注入形态的已知边界。
- 聚焦后的活动置前重排（2026-10-29）：分组顺序不归 view store——分组恒按宿主工作区
  清单顺序渲染（`deriveGroups` → `groupByWorkspace` 按 `useWorkspaces().items` 顺序，
  `orderBy` 只影响组内会话排序），重排只能走官方 `workspaces` 客户端服务的
  `insertBefore(workspaceId, beforeWorkspaceId?)`（`packages/api/workspace-controller/
  src/client/service.ts` 的 `IWorkspaces`，原生拖拽排序 `commitWorkspaceDrag` 同路径，
  宿主权威并持久化）。插件从幸存展开行的 `data-row-key` 取 id，按「活动分组显示标题
  字母序置前、其余保持相对顺序」的最小移动计划逐条执行，任一步拒绝即停止；未分组桶
  不是工作区、恒渲染在末尾，不参与。树形模式下顺序作用于宿主清单、呈现按父子嵌套
  投影（活动分组不会跳出自己的父分组）。

## 项目 files 增强层

出处：`plugins/files/src/{index.ts,git.ts,gitReview.ts,shared.ts}`、
`plugins/files/src/client/{nativeFilesAdapter.tsx,paneNavigation.ts,previewTabs.ts,previewTabTitle.tsx,imageZoomOverlay.tsx,tabContextActions.tsx,gitDecorations.ts,FileContextMenu.tsx,gitReviewTab.tsx,treePath.ts}`；
原生改动面板结构出处 `packages/client/ui-deliverables/src/client/{ReviewTab.tsx,FileDiff.tsx,review-definition.ts,review-store.ts,changes.ts}`。

项目插件不再注册 `conversation.view`，不再提供目录/list/read 私有文件服务，也不再复制原生树或预览。
它通过 `sidebar.right.pane.tab` 的 priority shadow 包装 dsh `ui-sidebar-files` 登记项，保留原生
component、store、inject、locale 和原生 `files` guide；文件正文由 `ui-sidebar-documentpreview`
及 `workspaceFiles` 负责。插件不接管 `sidebar.right.tab.guide`，不注册 sentinel 或第二个用户可见文件入口；
「开始」页的工作区文件、新建终端与浏览器入口仍由 dsh 按实际注册的页面类型显示。

- 原生树行的 `data-files-entry` / `data-files-path` 仅用于当前版本的局部增强契约：插件写入 Git
  data marker、aria-label/title，并通过外层事件委托提供右键菜单；不插入或移动原生行 DOM。
- 首次文件点击通过 `sidebarRight.split` 建立目标 pane，再以 `tab.actions.openResource` 打开原生资源；
  单击由 `previewTabs` 维护每个 session + pane 一个斜体临时 tab，下一次单击通过原生 `replaceTab` 替换；
  双击文件或 title slot 使 tab 保留。若空间、用户布局或 pane 生命周期不允许，回退原生打开行为。
- 图片预览保留原生每 tab 的适应宽度/固定档位/Ctrl+滚轮。项目在原生 text title slot 生成
  document.body portal 附加控件，对当前选中 image preview 的 frame 叠加 CSS zoom，提供适应窗口与 Space+鼠标平移；
  不增加图片 RPC。title menu 通过 `sidebar.right.tab.menu.item` 追加「关闭其他」「关闭全部」，先按目标 tab
  的 dockkit DOM 只读核对分栏，只关闭该 pane 的快照，不影响另一个 pane。
- `/files/snapshot` 只接收经过长度/NUL 校验的 sessionId，根来自 live
  `ctx.agents.get(sessionId)?.session.header.cwd`，没有 live Agent 时返回 session-not-found；
  绝不回退 process.cwd。
- Git 使用无 shell 的 `status --porcelain=v2 -z --untracked-files=all -- .`，带
  `-c core.fsmonitor=false`、`--no-optional-locks`、`-C cwd`，并以 `rev-parse --show-prefix`
  把仓库根路径转换回 Session cwd。总预算为 3 秒、status stdout 1 MiB、最多投影 2000 项。
- Git 失败、超时、非仓库或截断只降级 Git 展示，不影响原生树、原生预览或复制路径菜单；Git 状态不承诺实时。
- 右键菜单：目录行只复制绝对路径和工作区相对 slash 路径；文件行额外提供「查看 Git 变更」，打开 Git 变更面板。
  不提供任何写入或 Git 修改动作。
- Git 变更面板（`gitReviewTab.tsx`）：文件行右键 → `dsh-resource://files-git-review/session/<sessionId>` 资源页签
  （每会话一个，右键路径经 `params.path` 预选，复用原生按 (kind, contentId) 的去重与导航 revision）。面板按原生
  changes-review 的结构与样式在插件内复刻——原生组件不可 import（`ui-deliverables` 发布物外层只有 `apply`/`inject`，
  `files` 列表不含 `src`；0.2.0 起 shadow 包装 body 条目也会因 children/renderSlot 抛错）——复用的是官方公开面：
  `sidebarRightTabs.register`（extension 优先级新 kind）、`sidebar.right.pane.tab` keyed 座位（key = definition id）、
  `SidebarRightResourceParamsMap` 声明合并、primitives 的 Menu/Tooltip/PathLabel/`useCodeHighlighter` 与
  `dsh-client-store`（页面冻结模块表成员，独占 store 按会话铸造），CSS 按原生 FileDiff/ReviewTab 模块规则以
  `dsh-files-gr` 前缀复刻，diff token 用 `--dsw-alias-file-diff-*`。
- 数据口径：`/files/review`（status 清单 + `git diff --numstat -z --no-renames HEAD` 计数，未跟踪/空仓库经有界单文件读
  取计数，最多 200 个）与 `/files/diff`（`git diff --unified=3 --no-color --no-renames HEAD -- <path>`；未跟踪与无 HEAD
  时按整文件新增合成；输出超 1 MiB 降级 oversized）。每次右键导航与 Sidebar 刷新命令重新采集；不挂 watcher。
- 原生读取边界、文件工作区外授权、文本/字节预算、HTML iframe 隔离和非事务性行为跟随上游，
  不能继续宣称旧插件的逐段 symlink 拒绝、工作区 containment 或读取前后身份复核。

## 预览组件

出处：`packages/client/ui-primitives/src/index.ts`、`ReadBlock.tsx`、
`markdown/MarkdownText.tsx`、`markdown/highlight.ts`、`packages/client/web/src/platform.ts`。

ReadBlock 提供行号、窗口提示与复制；MarkdownText 禁止原始 HTML 和不安全协议。
Shiki core 使用 JS regex engine，不带 Oniguruma WASM；部分常用 grammar 预载，其他按需加载，未知语言回退纯文本。
插件 external @deepseek-ai/dsh-client-ui-primitives，复用页面单例，不引入第二套编辑器或高亮库。