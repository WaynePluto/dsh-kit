# 05 · 当前进度

只记录当前能力和下一步任务。完成一项立即勾选；自动测试与用户实机验收分开记录。
本轮重构（2026-10-10，删除远程能力并更名 dsh-kit）前的历史记录见
[docs/changelog](changelog/) 与 git tag `dsh-remote-final`。

## 已实现

- [x] chat-scroll 落点改锚「本轮 turn 头部」并贴顶（2026-11-10 第四轮，用户报长回复定位错，
  截图实测：视口顶边 y132、首行被裁半、26px 落点把上一条消息的尾巴留在顶部）：① 锚点不再
  要求与消息行邻接，永远取本轮 turn 头部——多步轮次（长回复）也回到这一轮的开头，正好落在
  原生分割线上，原生线高亮因此几乎总能用上；整轮折叠使头部零高时退回消息行锚点；② 落点
  inset 26px → 0：任何正 inset 都会在顶部留下被裁半的上一行，呼吸位由头部/行内边距提供。
  删除 `dividerAdjacentToRow`/`DIVIDER_ADJACENCY_TOLERANCE_PX` 死代码；46 项单测、lint/
  typecheck 全绿。实机复验后用户反馈「贴顶太挤」，inset 恢复 26px（锚点仍为本轮 turn 头部，
  顶部保留一行左右的呼吸位），随后再微调为 24px；46 项单测按最终 24px 几何更新、lint/
  typecheck 全绿。桌面实机复验（长回复落 turn 头部并点亮分割线、短回复、折叠轮次回退）待用户执行。

- [x] favorite-models 推理档位默认值（2026-11-10，用户提出「切模型后出现 Default 很困惑，
  期望默认 high，没有 high 就取 high 以下最高档」）：核实 `Default` 是原生行为而非插件发明
  （`ui-model-selection/src/client/locales.ts` 的 `effort.providerDefault`，`ModelSelect.tsx`
  只在模型没有 `defaultEffort` 时插入该行），语义是「不传 reasoning 参数、由端点决定」，
  因此保留该行、文案与原生一致（用户确认：触发器里模型名是英文，混中文更怪）。真正改动是换模型时显式提交档位：
  模型 `defaultEffort` 优先（与原生一致，也保住用户配置的路由默认），没有则取
  high → high 以下最高档 → 只有更强档位时的最低可用档（不选 off）；模型无档位时不指定。
  纯函数 `src/effort.ts` + 5 项单测、2 项组件测试（31 项全绿），lint/typecheck 全绿。
  未采用「给路由写 `reasoning: high`」：路由级默认对不支持的模型会在请求路径抛
  `UNSUPPORTED_REASONING_EFFORT`（adapter 只对描述静默丢弃），混合档位路由会硬失败。
  桌面实机复验（切到无默认档位模型后显示具体档位、`Default` 行保持原生文案）待用户执行。

- [x] chat-scroll「回到消息开头」落点改为 26px（2026-11-10 第三轮，用户报「需要滚动的提示线
  定位错误」，截图红框标出顶部半行残留 + 提示线落在空白带）：落点 inset 由 dsh Turn 导航的
  24px 改为 26px（约一行行高）——24px 小于正文行高，会把上一条消息的最后一行裁掉半个字，
  视觉上就是「没滚到位」；26px 让那一行完整露出并留呼吸位（先试过 0px 贴顶，用户选定 26px）。
  `READING_LINE_INSET_PX` 改名 `LANDING_INSET_PX`，`messageReachedReadingLine` 改名
  `messageReachedLanding`；45 项单测按新几何更新、lint/typecheck 全绿。实机复验（长消息落点、
  头部整行可见、短回复仍就地闪线）待用户执行。

- [x] chat-scroll「回到消息开头」跳过条件修正（2026-11-10 第二轮，用户实机报「定位不对」，
  截图显示闪线落在消息开头所在屏幕中部、视图完全没动）：上一轮为修「短页垫出大片空白」把
  跳过条件放宽成「开头已在可视区内」，结果长会话里消息开头可见但下方仍有大量内容时也不滚动。
  改为「对齐阅读线必须垫尾部空白（目标 > scrollHeight − clientHeight，即无滚动条短页或
  最后一条）且开头已可见」才跳过，否则照常滚动到阅读线；锚点仍是原生分割线头部。
  45 项单测（新增 2 项：可见开头仍滚动、可见头部仍滚动）、lint/typecheck 全绿。
  实机复验（长会话中部消息、短回复、展开过程组回退）待用户执行。

- [x] chat-scroll「回到消息开头」改锚原生分割线（2026-11-10，用户提出高亮提示线不要自绘、
  直接高亮 dsh 里「已完成，用时 X秒」下方的原生分割线，并要求滚动也直接滚到这条线上）：
  ① 锚点从消息行改为同轮 turn-process 头部——按行的 `data-chat-turn` 沿祖先 flow 层查
  `button[data-turn-process]`，几何邻接校验（分割线距行上沿 ≤24px，覆盖无组 16px/隐藏组
  12px 两种布局）通过才认定它是这条消息的开头；头部上沿对齐 24px 阅读线，头部整行可见，
  分割线落在其下方（用户选定语义）。② 到达提示优先点亮原生线：注入按
  `[data-chat-flow-kind="turn-process"] button[data-turn-process=N]` 属性选择的自有 CSS 规则
  （border-bottom 变 business-primary + ::after 2px 光带复用现有 keyframes，720ms/reduced-motion
  240ms 后定时移除），不向 React 拥有的节点写任何 class/属性/内联样式；头部滚出视口、多
  step/交错输入轮次、过程组展开、上游 seam 变化时回退旧自绘 overlay。衬垫/落点守护/输入让位
  机制保留，prepare 改收与动画同源的 target。43 项单测（新增 8 项）、lint/typecheck 全绿。
  桌面实机验收（普通轮次原生线点亮、深浅主题、reduced-motion、过程组展开回退、多 step 轮次）
  待用户执行。

- [x] chat-scroll「回到消息开头」二轮修复（2026-11-09 晚，用户报两点：开头已可见仍滚动并垫出
  大片空白（截图红框）；部分长内容落点差几行、需手动再上滚）：① 开头已在可视区内（无滚动条
  短页或开头可见，可视下界取 composer 座位上沿，与上游 capturePosition 同口径）不滚动不加
  衬垫直接闪线——替代上一轮仅判无滚动条的跳过（真实会话 composer 座位占 scrollHeight，
  无滚动条几乎不成立）；② 带工具调用的消息首个 part 常被折叠在过程分组里（hidden/零高，
  rect 全零），旧 findAssistantMessageRow 直接返回该行，目标被算成「当前位 −视口上沿 −24」
  恰好差几行——改为按同一 data-chat-node-key 的全部 part 行取第一条可测量的行，整条折叠时
  等待；③ 守护窗口 2.5s→5s，行瞬时零高耐心等待 40 帧而非立即退出，写回被滚动底钳制时
  重新执行 prepare 补足尾部空间（上游 reclaimBelow 可能回收底部余量使目标暂时不可达）。
  35 项单测（新增 6 项）、lint/typecheck/build/check:dependencies 全绿；dev 实例（0.2.2-rc.1）
  三场景实测通过：开头可见点击零位移且闪线、底部点击精确落阅读线（306=期望）、落点后注入
  拉回底部被守护拉回阅读线。suite tar 重打（同版本号覆盖）。桌面实机复验（截图场景 +
  带工具调用会话落点）待用户执行。

- [x] chat-scroll「回到消息开头」0.2.2-rc.1 适配修复（2026-11-09，用户报告「定位异常，
  落点不是正确位置」并要求短页不再强制滚顶）：dsh 0.2.2-rc.1 整套替换会话滚动视口
  （use-chat-viewport/reading/flow-motion，折叠批次 + 底部 spacer + 阅读采样），当时适配
  仅修 quick-commands 与 files，chat-scroll 被假定不受影响。实机复现确认：落点计算与
  动画本身精确命中阅读线，但落点后上游机制（折叠批次/回底跟随一类非输入写入）会把视图
  拉走，落点守护缺失导致「回到错误位置」；另外无滚动条的短页会被 cushion 强制滚顶，
  用户确认该行为多余。修复三件：① 落点后 2.5s 守护循环——按帧复核阅读线并写回非输入
  漂移，行所属 document 捕获层的任何 pointerdown/wheel/keydown 立即让位（覆盖原生 Turn
  导航等滚动宿主外入口），行卸载/隐藏即停，超时路径改为守护收敛稳定后才补闪（不产生
  虚假到达）；② 短页 `scrollHeight <= clientHeight` 直接在行顶闪线，不滚动不加衬垫；
  ③ README/文档回写（[会话滚动导航](dsh/conversation.md) 补 0.2.2 视口契约段）。30 项
  单测（新增守护 6 项 + 短页跳过）、lint/typecheck/build/check:dependencies 全绿，
  suite tar 重打（同版本号覆盖）。桌面实机验收（正常会话/冷启动旧会话/短回复/返回底部/
  深浅主题中英文）待用户执行；上游拉回写入者的调用栈因窗口遮挡（Chrome hidden 时 rAF
  冻结）未能抓取，守护按「非输入漂移一律校正」设计不依赖具体触发者。

- [x] 分叉会话置顶（2026-11-05，用户反馈「分叉后在会话列表里找不到」）：fork 子会话的
  summary.updatedAt 继承 seed 前缀的旧时间戳，工作区按 recency 排序时落在末尾，会话多时
  不可见。fork/create 成功后调用官方 `ctx.uiWorkspace.pinSession(childId)` 置顶到分组
  第一位（pin 在排序里优先于手动顺序与 recency；用户可随时手动取消置顶）。21 项单测与
  专项冒烟全绿，suite tar 重打。
- [x] 交互终端原生级重写（2026-11-05，用户决策「与 dsh 自带终端一致的体验」）：在 2026-11-05
  第一次 tab 化（dock → 聚合 tab + screen 文本轮询）实机验收后，用户提出四点优化（遮罩开关/
  宽度自适应/中断按钮语义/用户关闭），评估后整体升级为原生级形态，取代第一次实现：
  - **PTY 所有权**：`TapTerminalBackend` 组合上游公开构造的 `BashTerminalBackend`，在
    `spawnTerminal` 注入点拦截——`terminalType` 改写 `xterm-256color`（上游默认 dumb 关彩色）
    + 句柄按 `spec.sessionId`（registry 先铸 id，每 spawn 闭包捕获，并发安全）登记 tap。
    模型工具链、就绪探测、busy 等待、read 分页、沙箱围栏全部上游原样，零改动。
  - **页面**：xterm.js（@xterm/xterm 6.0.0 + FitAddon 内联 bundle 704KB/gzip 150KB；官方
    xterm.css 内嵌注入 + 容器作用域覆盖 viewport 黑底），一个终端一个 chip（multiple: true），
    guide 入口 spawn 全新终端（与模型同一条 backend 路径，围栏一致）；键盘 onData → 16ms 微批
    直写 PTY（密码不回显归程序，UI 无遮罩表单）；ResizeObserver → FitAddon → resize（ConPTY
    重排自适应）；关 chip = 杀进程树（第一次 × 抛错否决进入 4 秒确认态；模型 close 无需确认）。
  - **数据通道**：`/api/terminal/stream` 流式响应（官方桥对响应体增量写入 + 背压，免轮询）：
    attach 重放宿主 ring buffer（512KB，整块丢弃最旧）→ 实时帧 → exit 帧；tab 隐藏断流、
    可见重连重放；布局恢复经 localStorage bindings（(sessionId, contentId) → terminalId，
    `multiple` page 每次 open 铸新 uuid contentId 且永不 dedup）。底座四色随 dsh 主题 token +
    ANSI 经典 16 色板；模型 read 经上游 sanitizer 拿干净文本（彩色字节走 tap、纯文本走模型）。
  - **保活边界**（与官方原生终端一致）：浏览器关闭/刷新/切会话存活（进程在宿主）；宿主重启/
    插件停用/会话卸载死亡；上游 registry 无闲置回收。多会话完全隔离（owner Agent 记账）。
  - Config 删 sendWaitMs；guidance 补「用完主动 close 并说明、终端消失先 list 再开新的」。
  - 51 项单测（含 live 真实 PTY：tap 配对/直写/帧接收/SEND_ACTIVE 互斥）、lint/typecheck/
    两半产物/`terminal-check.mjs`（真实 dsh 冷启动 + 新通道面 + xterm bundle 断言）全绿，
    suite tar 重打。新契约回写：流式响应（[插件机制](dsh/plugins.md) D16 段）、sidebar tab
    （[Sidebar 扩展](dsh/sidebar.md)，自 plugins.md 拆分）、页面渲染与生命周期
    （[工具与进程](dsh/runtime.md)）。桌面实机验收（四点体验 + 彩色输出 + 保活）待用户执行。实机首轮报
  「no PTY backend registered for shell」：backend 注册写在 apply 顶层，`ctx.get('terminals')`
  在服务 fiber 未起时返回 undefined 被可选链吞掉——改为 `ctx.inject(['terminals'])` 内注册
  （实例仍绑宿主根 ctx，inject 派生 scope 无 sandboxPolicy 执行环境）；套件已重打。二轮实机又修三处：serveStream 按 sessionId 查 tap（应按 terminalId）致流式 attach 恒 404（missing 态）——请求改双 id 并加跨会话归属校验；tap 在就绪探测后才登记丢失启动期输出（guide 终端空白）——改 spawnTerminal 注入点立即登记（闭包持外层 spec.sessionId）；monitor 只认导航 params 识别已绑定 tab（guide 壳 tab 无 params）致重复开 tab——openTabs contentId 经 bindings 回退。画面几何：流式帧序改 size→ring→live→data/exit，客户端按 PTY 原几何重放、live 后才 fit+resize（消除 160 列字节错位重放），重连先 reset 全量重放。三轮实机（2026-11-08，用户报「首开后/变宽后命令重复自动输入、chip 末字截半、开始页叫新终端」）：先用简化栈（工作区 node-pty 1.2.0-beta.15）字节捕获得出「ConPTY 每次 resize 都全屏重绘」并据此清屏+几何前移（resize 端点成功后 tap 几何前移——这条保留，size 帧不再停留 spawn 值），**但实机复验推翻重绘前提（真实栈=dsh 宿主自带 node-pty，resize 不重绘，清屏即永久白屏）**，清屏回退。随后在真实栈（cordis + subprocess-local + sandbox-policy + 本插件 backend）复刻完整链路捕获 PTY 输入侧，**抓到真凶：pwsh/conhost 发 DSR/DA 查询（`\e[6n`/`\e[c`），上游会话 headless 模拟器应答之外，浏览器 xterm 也经 onData 自动应答写回 PTY——双重应答进输入行，pwsh 按行读应答时吞掉后续回车，命令文本残留输入行**（复现用户全部症状：直接回车显示 `Clear-Host`、命令执行后被自动重输）。修法：tap 加 `TerminalQueryStripper`（跨 chunk 状态机，剥 `\e[6n` 与 DA 族查询，OSC/DCS 字符串态负载不误伤），浏览器侧不再应答；上游模拟器不经 tap，应答通道不变。真实栈实验复验：直接回车干净、命令单次执行、resize 画面保留。chip 末字截半是 dockkit 标题遮罩（激活态末 30→14px 渐变 mask）吃掉恰好占满 chip 的末个 CJK 字形——title span 尾部留白 30px；开始页文案 guideTitle 改「AI交互终端」。61 项单测、lint/typecheck/两半产物/suite tar 全绿，client=2026-11-08.2；桌面实机复验（Console 核对 client 版本 + 首开/变宽输入 + 直接回车 + chip 末字 + 开始页文案）待用户执行。四轮实机（2026-11-09，用户报「AI 开终端进 REPL 等输入时，点击后光标不在提示符处、输入叠进上一行」）：真实栈复刻模型 startSend python → 客户端重放 + 窄面板 fit 复现——**竞态**：xterm write 异步解析，ring 重放后同 tick resize（live 与 ring 同一 HTTP chunk），排队字节按新窄宽解析、长 banner 提前 reflow，而 ConPTY 变窄不重排内部缓冲（`\e[4;5H` 光标定位实证 `>>>` 仍在原行），两边行数分叉一行、逐键回显整体错行。修法两件：① ring/data 帧写入带解析回调计数，fitNow 写队列未排干时挂起、排干后续跑（实例消亡随清理归零）；② 宿主在 size 帧附 Windows 内部版本号（`os.release()` 末段），客户端设 xterm `windowsPty`（conpty 档位，build < 21376 禁 reflow）——xterm 与 ConPTY 都不重排旧行，行数不叉（VS Code 同款兼容开关）。真实栈实验复验：REPL `>>>` 后输入 `1+1` 精确落在提示符后、执行出 `2`、光标就位。63 项单测、lint/typecheck/全仓测试/两半产物/suite tar 全绿，client=2026-11-09.1；桌面实机复验（AI 开终端进 REPL 后点击/输入 + 变宽后输入）待用户执行。
- [x] 交互终端迁右侧边栏 tab（2026-11-05，已被上方原生级重写取代）：提问/审批卡片接管 composer 席位时旧
  dock 面板（`conversation.input.dock` 在 chain fallback 内）被整体 `display:none`，用户无法在
  提问期间输入密码。改为右侧边栏自有 tab 类型（kind `dsh-kit-terminal`，`sidebarRightTabs` +
  `sidebar.right.pane.tab` 两段式注册，`keepMounted: true`，guide 入口卡片）：composer 接管与
  sidebar 互不影响，边看提问边输入。宿主半零改动（PTY、工具契约、/terminal RPC 原样）；
  浏览器半复用 panel/polling hook，`tab.visible` 驱动 screen 轮询暂停与草稿清理；会话级
  monitor 每 5 秒收敛视图（0→1 自动 `openTabIn`，用户手动关闭按基线抑制重开、模型开出更多
  终端才重开，终端清零收掉空 tab）；关 tab 不杀进程（不注册 close handler）。guidance 补
  「等待用户输入轮询 read、不发提问弹窗」。91 项单测、lint/typecheck/两半产物/suite tar 全绿，
  `terminal-check.mjs`（真实 dsh 冷启动 + PTY + 通道）全过；桌面实机核心场景
  （模型 start + ask_user_question 弹出时在 tab 输入密码后点选项，AI 接管）待用户验收。
  sidebarRight tab 契约（openTabIn 跨会话、close 仅前台、openTabs 清单、useTabInfo 自动绑定、
  关闭语义）回写 [Sidebar 扩展](dsh/sidebar.md)。
- [x] quick-commands 弹窗闪退修复（2026-11-05，用户报告）：dsh 0.2.2-rc.1 起 composer 座位
  `will-change: transform`（`ConversationRoot.module.css`）成为 fixed 后代包含块，契约要求
  composer 内 fixed 浮层一律 portal 到 body（[会话](dsh/conversation.md) 已记录）；面板此前
  误用非 portal 的 `QuickCommandsPanel` 内联渲染（违背 D25 自身的 portal 声明），fixed 坐标
  被按 composer 座位解释而闪退。改用 `QuickCommandsPortal` 后恢复；chat-scroll 的 fixed 元素
  在消息区（非 composer 后代），不受影响。35 项单测绿。
- [x] favorite-models 选择器对齐原生并吸收三项能力（2026-11-05，用户确认）：按
  dsh 0.2.2-rc.1 `ui-model-selection/ModelSelect.module.css` 重译样式（行密度 34px/13px/400、
  勾号 14×14、图标族 Regular、radius token、business-primary 焦点圈 + `data-selection-focus`
  抑制、composer 紧凑模式变量与数据图标、固定 360px 上限）；并吸收官方能力：①收藏条目 >4 个
  时搜索框（`rankByName` 子序列匹配、↑↓ 高亮 + Enter 接受、清除按钮，作用于收藏过滤后列表）
  ②选中提交期间 StateDot 进度点（触发器 chevron 位 + 对应行勾号位，`state.pending` 驱动）
  ③打开时 `scrollIntoView` 定位当前选中项、无当前模型直达列表 pane、Escape 二段式返回。
  未吸收（清单已过用户评估）：badge、focus-follows-mouse、Tab 语义、provider 排序、移动端
  适配、结构化错误。24 项单测与全仓检查绿；测试基建教训（MenuSurface mock 须 forwardRef、
  jsdom 缺 scrollIntoView 需 polyfill）已并入 dsh-theme skill。
- [x] 任务看板三项增强（2026-11-04，用户需求）：① **卡片图片**——回形针按钮多选或卡片聚焦时
  粘贴截图，缩略图行支持官方 ImageLightbox 预览与悬停移除；仅 PNG/JPEG/WebP/GIF（dsh
  `isImageMediaType` 白名单）、单图 4 MiB、单卡 8 张、整板 data URL 24 MB，图片以自包含
  data URL 随 `task-board.json` 落盘，无独立图片文件；`isBoardDocument` 严格校验 MIME/前缀/
  base64 字符/总量，`normalizeBoard` 逐张丢坏图并兼容旧版无图文档。② **填入新对话带图**——
  官方 `ctx.get('conversation').createDrafts(sessionId, files)` + `SessionInput.addAttachments(ids)`
  （0.2.1-rc.5 源码核实）把图片登记成新会话的图片草稿附件，原生附件栏显示缩略图、发送由
  dsh 自己编码；`addAttachments` 返回 false 时 `releaseDraftAttachments` 兜底。③ **最后一列
  「清空所有卡片」**（用户确认「需要确认弹窗」）与**卡片标题行**（用户确认放在顶部按钮行与
  正文之间）：标题可点击自由编辑、字号 15px > 正文 13px、纯展示且不填入新对话。数据模型
  `BoardCard.title?/images?` 向后兼容，56 项单测、lint/typecheck/构建两半产物全绿。
  上游契约回写 [会话](dsh/conversation.md) 的「程序化图片草稿附件」。

- [x] models-catalog 官方跟随对齐（2026-11-03，用户决策「文案重定位 + 功能识别」）：官方
  API-key 路由（deepseek-official）原生跟随 `GET /models` 期间，组件按上游同一判定
  （端点 origin + `isBuiltInCatalog`，新增运行时依赖 `@deepseek-ai/dsh-llm-deepseek`，
  `@deepseek-ai/*` 仍由宿主树解析）识别跟随状态，对 pi-ai `deepseek` 路由抑制 models.dev
  建议、面板提示「官方路由正在原生跟随」；已写入条目原样保留、撤销照常；官方行被停用、
  端点改指网关或目录被自定义后建议恢复。面板 intro 与 README/meta 文案重定位为「第三方
  网关与其他供应商」。dev 工作区以根 devDependencies 补 transport 包的静态 peers
  （`autoInstallPeers: false` 前提，宿主树运行时本就提供）。60 项单测、实机装载层启停、
  浏览器行 28/28 与模型 check 全绿；面板提示与文案已经桌面套件升级实机确认（2026-11-03）。

- [x] dsh 0.2.1-rc.5 适配（2026-11-03）：基线自 0.2.1-rc.3 推进至 npm latest `0.2.1-rc.5`
  （alpha 轨道 0.2.2-alpha.2 高风险未跟）。rc.4/rc.5 上游仅三处实质改动——推理展示预处理
  （`reasoningText()` 剥离 `<signature>` 块、`conversation.chat.reasoning.body` 槽 owner props
  新增 `rawText` 且 `text` 改为展示文本，见 [会话](dsh/conversation.md)）、View 页签 tooltip
  溢出估算、ACP/MCP stdout 日志治理——套件组件零占用，契约核对零适配。机器侧三处同步
  rc.5，删 lockfile 与全部 node_modules 重装后全树无多版本共存；全量静态检查 + 17 项检查表
  脚本全绿（live dev 实例浏览器行 28/28）。顺带两项：dev-runtime 首建路径修复——fingerprint
  换代新建 runtime 时 pnpmCli 在安装前探测、回落到不存在的 `pnpm.cjs` 使 dev-suite 的 shim
  失效，改为安装后重探；proxy-check 的写入成功断言按 notify-check 同款精确签名豁免已知
  CLI web 持久化缺陷（后续任务④）。

- [x] 交互终端 SSH 默认保活（2026-11-03）：`interactive_terminal start` 的命令首个可执行项为
  `ssh`/`ssh.exe` 时，自动补 `ServerAliveInterval=15` 与 `ServerAliveCountMax=3`，命令显式值优先；
  `-vvv -E` 详细日志因包含连接元数据只在排障时按需开启。经其他 shell 或脚本间接启动的 SSH
  不做字符串改写。新增默认补齐、显式覆盖与非直接 SSH 保持不变的回归测试。

- [x] 快捷指令（quick-commands，2026-11-02，D25）：composer 工具排左侧组新组件——官方
  `conversation.input.left` list 槽（session 作用域，[+] 与 permission/plan 之后，0.2.1-rc.3
  源码核实的公开座位）注册一枚复刻原生 `.add` 样式的圆形按钮（IconListPenOutlineMedium
  14px），点开 MenuSurface 悬浮面板管理自定义快捷指令：行内增删改（新增框回车提交、
  行尾 hover 出编辑/删除钮、IME 守卫、上限 100 条 × 2000 字符），点击指令经 session
  标准 prop `inputActions.captureInsertion()/insertText()`（上游斜杠菜单同款公开插入
  契约）在输入框**光标位置**插入文本并关面板，只插入不发送；插入失败自动重取光标重试
  一次，仍失败 Toast 提示且面板不关；点击输入框本体（放置光标）不关闭面板——「先把
  光标点到正文中间再点指令」是核心流程，面板与 composer 卡片之外的外点才关闭。数据
  整份 JSON 存 `$DSH_HOME/dsh-kit/quick-commands.json`（D17/D23 同族），宿主半
  `/quick-commands` get/put RPC（缺文件回空文档零播种、put 全量校验），浏览器半乐观
  更新 + 每次提交立即整份写回（提交粒度有界，无防抖），写失败亮错误保留本地。组件总数
  28（口径与 plugin-catalog.json 对齐）；随 conversation-enhancements 分发；上游契约
  （input.left 槽位 + inputActions 插入面）回写 docs/dsh/plugins.md。2026-11-08 修：面板
  打开时首行接受程序化 focus（方向键/Enter 即刻可用），`:focus-within` 让首行的编辑/
  删除钮常显而其它行 hover 才显——动作簇显隐改 `:has(:focus-visible)`（鼠标打开的程序
  化 focus 不匹配，行为与其它行一致；键盘导航焦点仍显现，Tab 可达）。

- [x] 切屏停靠扩展·面板停靠（session-park，2026-11-02，D24）：点击侧栏面板菜单项
  （插件/自动化任务/服务/任务看板与「更多」菜单项）把 main 视图换成面板页且当前
  会话运行中时，立即停靠（官方 `uiWorkspace.startSession()` 同路径，无去抖——
  点击菜单是明确导航意图），并在停靠 reveal 的同一次同步通知里把面板选回
  （`layout.selectPanel(prev)`，React 提交渲染前、面板页不重挂无闪烁）。触发源是
  订阅 `layout.panelInfo`（0.2.1-rc.5 核实的公开契约，零 DOM、覆盖侧栏行/更多
  菜单/程序化 selectPanel 全部路径；layout store sync flush 同步派发）；「我们的
  停靠落地」判据 main 已是 blank——用户自己回会话（点行/panel-toggle/新建）main
  非 blank 不恢复，且其 selectPanel 会 abort 在途停靠，互不纠缠。设置 shell/modal
  不经 selectPanel、不在范围。浏览器半新增 `panel-park.ts` 状态机 + 11 项测试；
  inject 增加 `layout`（devDependencies 补 `@deepseek-ai/dsh-client-ui-layout`
  0.2.1-rc.3）。上游契约回写 docs/dsh/plugins.md「全局面板」。

- [x] 任务看板（task-board，2026-10-29，D23）：侧边栏「任务看板」全局面板（`main`
  keyed 页面 + `sidebar.panellist` 行 order 30，services 同款双注册，行 toggle 由
  panel-toggle 提供）。本地 Trello 式看板：卡片跨列拖动（onDragOver 实时换列、
  其余卡片由 dnd-kit transform/transition 平滑滑开让位，DragOverlay 抬升影卡）、
  列横向拖拽调序、拖到看板/列边缘时 dnd-kit 内建 autoScroll 自动滚动、点击卡片或
  列标题原位编辑（textarea 替换、Escape 取消、失焦/Ctrl+Enter 提交、IME 守卫）、
  列/卡片增删（列删除为官方 Modal 确认弹窗）；卡片左上角工作区 chip（官方 Menu 选择，缺省
  「默认工作区」= dsh 新会话默认落点）、右上角复制（writeClipboard，成功短暂变勾）、
  第一列卡片右下角发送按钮——`sessions.create({workspaceId})` →
  `uiWorkspace.openSession()`（reveal 顺带把面板切回会话）→ conversation scope
  `setDraft + submit('queue')`，与 user-message-fork 同款官方路径。数据整份 JSON 存
  `$DSH_HOME/dsh-kit/task-board.json`（D17 同族；get 缺文件按界面语言播种四列，
  put 全量校验有界上限：16 列/单列 200 卡/全板 2000 卡/文本 8000 字符）；浏览器半
  乐观更新 + 400ms 防抖写回、卸载兜底 flush，失败亮错误不回滚。拖拽引擎 dnd-kit
  （core 6.3.1/sortable 10.0.0/utilities 3.2.2，MIT，devDependencies 固定版本、
  构建时内联进 client.js，react-dom 显式进浏览器模块表）。组件总数 27（口径与
  plugin-catalog.json 对齐）；随 development-tools 分发。
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

- [x] favorite-models 选择器样式与能力已在官方桌面 0.2.2-rc.1 完成（2026-11-05，用户确认）：
  与原生并排视觉一致；搜索框（>4 条收藏出现、↑↓/Enter/清除）、选中进度点、打开定位与
  无当前模型直达 pane、触发器紧凑模式、深浅主题均通过。
- [x] quick-commands 弹窗已在官方桌面 0.2.2-rc.1 完成（2026-11-05，用户确认）：面板正常
  打开不再闪退，插入/编辑/增删与点外部关闭正常。
- [x] 全套件实机验收已在官方桌面 0.2.1-rc.5 完成（2026-11-03，用户确认）：桌面宿主验证、
  套件浏览器行图、套件升级覆盖、各组件核心场景、性能整改观察与深浅主题/中英文界面均无问题；
  chat-scroll 与 files 的原生增强此前已单独确认。新增组件时在此逐项补验收项并保留至用户确认。

## 后续任务

- [ ] 上游缺陷盯梢（修复后回写本文并移除对应豁免）：
  - CLI web 宿主 `settings/mutate` 持久化缺陷（dual app-boot 实例致 bootstrapIncludes
    miss，0.2.0-rc.2 起已知，见 [插件机制](dsh/plugins.md) 设置写入一节）：rc.2/rc.3/rc.5/
    0.2.2-rc.1 复核均未修复，桌面宿主不受影响；notify-check 与 proxy-check 的写入断言按
    精确签名豁免；
  - ~~套件在线启停的 session-controller file-upload 二次注册竞态~~（0.2.2-rc.1 上游已修复，
    commit 67a4ab78be：resolver 存普通 holder，dispose→再注册正常；suite-toggle-check 的
    FAILURE_SIGNATURES 保留为哨兵，命中仍响亮报错）；
  - pnpm ≤10.17 在 Windows 把 `link:<盘符绝对路径>` 当相对路径生成坏符号链接：
    dev 栈已固定 pnpm 12.11.2 规避，官方桌面安装不受影响，仅影响 pnpm ≤10.17 用户经
    「添加插件」装本地路径套件。
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
  「版本号仅在明确指定发新版本时更新，否则同版本号重发覆盖」，发布资产与本地构建清单级一致；
  2026-11-02 第四次重发：27 组件（面板停靠，见已实现条目），同 tag 强移暴露
  release.yml 的 `gh release create` 对已存在 Release 直接失败，改为 create 失败回退
  `upload --clobber` 覆盖资产（重发路径幂等），CI 产物与本地构建条目级一致）；
  2026-11-03 桌面实机验收通过（用户确认）：旧 0.0.1 资产升级覆盖、同 tag 地址重复输入
  预期拒为 already-installed、CLI `dsh plugin --profile desktop add <地址>` 兜底重启生效。
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
