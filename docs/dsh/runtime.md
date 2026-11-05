# 工具、权限与进程

基线见 [源码依据](../02-dsh-facts.md)。以下路径相对 dsh 仓库根，项目实现明确标注。

## 工具注册表

出处：`packages/core/tools/src/index.ts`、`packages/preset/agent-presets/src/mount.ts`。

| API | 语义 |
|---|---|
| schemas(scope) | 当前 scope 可见工具的 name、description、parameters 深拷贝 |
| get(name,scope) | 获取可见定义 |
| register | 注册定义并返回 disposer，scope 可覆盖祖先同名工具 |
| restrict | scoped allow/deny 交集，不能在全局调用 |
| guard | 单调拒绝，不改变可见性 |

preset 将工具挂在 Agent scope，查询必须传 ctx.agents.get(sessionId)，否则只得到全局层。
dsh 没有 registered/active 两级延迟加载；view(scope) 通过继承、restrict、shadow 与 PTC 呈现计算唯一可见集。
llm-pi-ai 的 deferredToolsMode:withhold 是协议兼容位，不是工具激活 API。
工具观察页只读，不能调用 register/restrict/guard 改变 Agent 行为。

## 原生子代理深度

出处：`packages/subagent/subagent/src/{index,depth}.ts`、`packages/subagent/tool-subagent/src/index.ts`；
已安装 `0.1.7-rc.1` 的对应 `lib/index.js` 中，服务 `Config.maxDepth` 默认 `1`（可热更新），
`resolveMaxDepth` 在工具没有显式 `maxDepth` 时读取该设置。`tool-subagent` 可显式指定数值覆盖，
或设为 `provider-managed` 将深度约束交给 provider；子代理的持久会话 header 深度不会因恢复而回退。
这些是 dsh 原生配置，不依赖项目插件。

## 持久历史与事件限制

出处：`packages/core/session/src/{index,types,known-event-types}.ts`、
`packages/session/session-persistence/src/coordinator.ts`、`packages/llm/llm/src/message.ts`。

tool/call 是持久事件，带 callId、name、原始 arguments JSON 字符串。
session.snapshotEvents 返回含继承前缀的不可变日志，ownEvents 只返回本会话部分。
工具调用统计回放整个日志；失败按 tool/result 的 source.callId 或 content[0].toolCallId 配对，无法配对则忽略。
tools/result 等运行时事件适合实时反应，但不是历史计数的唯一来源。

外部插件不能 append 自己定义的事件类型：持久化加载拒绝不在 KNOWN_SESSION_EVENT_TYPES 且无 ignorable 的事件，
而 Session.append 没有 ignorable 参数。写入会导致会话无法恢复。
可以读取、折叠 dsh 已有事件，不能把新事件名塞入日志。

插件可用的 Host→Client 状态推送是 session projection；浏览器 RPC 不提供 open 流。
服务和 PTY 不发布可折叠会话事件，因此面板使用有界轮询。

## 常驻服务

出处：`packages/jobs/jobs/src/types.ts`、`docs/subsystems/jobs.md`、`docs/subsystems/shell.md`。

dsh jobs 生命周期绑定 owner；Agent 销毁会取消并等待任务，无 owner 的任务也活不过 service disposal。
项目 services 的注册表与日志都以 `$DSH_HOME`（`@deepseek-ai/dsh-home-paths` 的 `resolveDshHome`，
默认 `~/.dsh`）为作用域：`$DSH_HOME/dsh-kit/services.json` 单文件记录全部存活服务，
`$DSH_HOME/dsh-kit/logs/<name>.log` 每名一份当前日志（每次启动截断）；
同一部署（同用户、同 home）的所有工作区共享可见性；隔离 home（D8 的 `~/.dsh-dev`）天然互不可见。
项目内 `.agents/services.json` 与 `.agents/logs/` 是 D17 前的存量：旧注册表在该工作区首次被
snapshot/start/logs 触达时惰性并入全局并删除（v1 记录补 root 字段，重名以全局为准）；
旧项目日志经注册表的 roots 索引（启动过服务的项目目录，读取时剔除已删除目录）回捞，
运行中旧服务的日志文件不搬（fd 打开中，Windows 锁定），下次 restart 自动落位 home。
服务名在部署内全局唯一，重名 start 拒绝并指认属主项目。
并发写入由注册表旁 lockfile（`O_EXCL` 创建、陈旧 10 秒打破、等待 5 秒接管）串行化；
两个窗口同时以同名启动时，写入方在锁内复核发现撞名后杀掉自己刚拉起的进程。
以 pid 和创建时间识别，避免复用 pid 时误杀。

身份探针的性能契约（2026-10-23）：Windows 读创建时间要 spawn 一个 PowerShell
（实测 ~0.4s/次），因此对账按批进行——`identifyBatch` 逐条 signal 0 现查存活（微秒级、
绝不缓存），存活 pid 的创建时间一次子进程全取（与记录数无关）；每条记录只判定一次，
判定结果随条目透传。展示路径（snapshot 轮询）允许 20 秒缓存窗口（`SNAPSHOT_IDENTITY_CACHE_MS`），
窗口内零 spawn；**stop/restart/start 的身份判定始终现查**——缓存命中无法排除 pid 回收窗口，
终止决策不能建立在缓存上。读日志（`logsOf`）只查注册表与 pid 存活，不做全量对账；
日志尾读取有 256KB 窗口（首个不完整行丢弃），长跑服务的大日志不拖慢读取。

直接 node:child_process.spawn 不经过沙箱，所以 service_start/restart 必须读取**调用方会话**的 sandbox mode。
danger-full-access 不额外提问；受限模式需 ctx.approval 且仅 allowed-once 放行——跨工作区发起
也不会绕过调用方自己的批准。缺会话或批准能力时 fail closed；面板不提供创建服务入口。
权限预设只写 mode/policy，不替自行 spawn 的插件做逐工具沙箱隔离。
`service_list` 默认本项目，`scope:"all"` 返回全部工作区（当前工作区排前）；
面板 list 恒为全局（面板是侧边栏「服务」全局面板，`main` keyed 槽 + `sidebar.panellist` 行，
见 [插件机制](plugins.md) 的「全局面板」；其 RPC `sessionId` 可选，作排序锚点与 restart 门控归属，
缺省时 Host 不排序、门控 fail closed）。stop/restart/logs 按全局唯一名称寻址，不要求会话有项目目录。

### PowerShell

出处：`packages/shell/pwsh-local/src/index.ts`、`packages/shell/pwsh-sandbox/src/index.ts`。
普通服务命令使用 -NoLogo -NoProfile -NonInteractive -Command，加入 UTF-8 前缀和 NO_COLOR/PAGER/GIT_PAGER。
不加载用户 profile，避免提示、启动噪音或错误匹配服务就绪日志。
受限模式的 pwsh-sandbox 在 Windows 使用 ACL restricted-token runner。

### Windows 进程树

dsh-kit 插件杀进程树统一用 taskkill /T /F；detached 只解除控制台，不清除记录的父 pid，单层 detached 会被一起枚举。
services 使用两级 Node 启动器：

```text
dsh → L1(detached，启动 L2 后退出) → L2(detached，常驻) → pwsh(普通子进程)
```

L1 退出后 L2 不再能从 dsh 的存活子树枚举；L2 为 pwsh 保持需要的控制台环境。
注册表记 L2 pid，经 sidecar 回传，停止 L2 进程树可清理 shell 及其后代。
这属于操作系统行为，必须以 services/tests/live.spec.ts 真实启动、杀父树和存活检查验证。

## 交互终端

出处：`packages/terminal/terminal`、`packages/terminal/terminal-bash`、`packages/terminal/tool-terminal`、
`packages/subprocess/subprocess-local`。

dsh 提供 PTY registry、bash/pwsh 后端、node-pty 和六个 terminal_* 实现，但标准 Web Bundle 不挂这些工具。
项目插件直接实例化 TerminalSessionService，backend 是 `TapTerminalBackend`：组合上游公开导出的
`BashTerminalBackend`（构造函数注入 spawnTerminal），在注入点把 `terminalType` 改写为 `xterm-256color`
（上游默认 `dumb`，会关掉程序输出彩色）并把句柄按 `spec.sessionId`（registry 先铸 id 再调 backend，
并发安全靠每 spawn 闭包捕获）登记进 tap registry——原始字节 tap、write、resize、terminate 都从
句柄直出；上游 `LocalPtySession` 的就绪探测、busy 等待、read 分页、signal、沙箱围栏原样保留。
wrapper 捕获上游 apply 的六次注册，模型只看见 interactive_terminal 的
start/write/read/list/interrupt/close，工具契约零改动。
start 合并创建与前台发送，write 向既有会话续发输入（submit=false 表示只敲字符不回车），
interrupt 固定 SIGINT，不暴露 raw send 或任意 signal。直接以 `ssh`/`ssh.exe` 开头的 start 命令
默认补 `ServerAliveInterval=15` 与 `ServerAliveCountMax=3`，显式值优先；`-vvv -E` 诊断日志只按需开启，
不默认持久记录连接元数据。命令首个可执行项不是 `ssh`/`ssh.exe`（例如经其他 shell 或脚本间接启动）时不做字符串改写。
上游 terminal_open 经 workingDirectory.ensure 解析会话目录；该服务由会话执行环境按会话提供
（dsh 生产代码不全局 provide），套件全局作用域拿不到——wrapper 的捕获 facade 在 ctx 链上
没有该服务时兜底进程 cwd，有则原样透传。

Windows 上实际 spawn 的可执行文件由两段决定：插件 `shellDialect` 默认 `auto`（win32 → `pwsh`），
插件只透传 `shellArgs` 不透传 `shellPath`；pwsh 路径解析与上游同源（`resolvePwshPath`，
`@deepseek-ai/dsh-pwsh-local` 已加进插件 devDependencies）——`%ProgramFiles%\PowerShell\7\pwsh.exe`
优先，其次 PATH 条目的 `pwsh.exe`（含 Store 安装），最后才兜底 Windows PowerShell 5.1 的
`powershell.exe`。装有 PowerShell 7 的机器命中的第一条候选就是 PS7 的 pwsh.exe。

严格用于预期必须让用户在可见终端直接输入的命令。普通命令、构建、Git、测试、长任务与持久 shell 状态
均使用 pwsh/bash；可改非交互的优先改非交互。持续服务使用 services。
等待用户输入完成时模型轮询 read 观察提示符恢复，不发 ask_user_question/审批弹窗确认输入
（弹窗接管 composer 席位；终端视图在右侧边栏 tab，两者并存，见 [Sidebar 扩展](sidebar.md)）。
模型用完终端应主动 close 并说明；终端被用户关闭后 list 里没有它，需要时 start 新的，不写旧 id。

Linux 个人用户部署允许一个窄范围例外：所有 sudo 命令都必须通过交互终端执行，即使缓存可能跳过密码提示；
已经因 sudo 人工认证而打开的交互终端，可以在同一管理员任务内复用系统的 sudo 凭据缓存执行后续明确命令。
这不等于允许用 interactive_terminal 承担普通持久 shell 工作。模型应先说明具体命令和影响，不主动运行 `sudo -i`、`sudo su`、`su root` 或等价的持续 root shell，
也不修改 sudoers、配置免密授权或用脚本维持 root 控制通道。密码只由用户在网页终端输入。

### Registry 契约

- owner 按对象同一性比较且必须是 live Agent，恢复出的新 Agent 不等于原 owner。
- 同一终端同时只允许一次模型发送，重复发送同步抛 SEND_ACTIVE；页面键盘直写走 tap 句柄
  `handle.write`，不受此门限制（真实终端语义：多人同时打字即穿插）。
- startSend 的 submit 只追加回车，text 原样写入，不转义控制字节。
- 页面通道（`/terminal` kit）端点：list、spawn（guide 入口新开终端，走同一条 backend 路径，
  沙箱围栏一致）、write、resize、close（杀进程树）。没有 read/send/interrupt：读屏与模型发送
  是模型工具的事，Ctrl+C/回车是真实按键。
- 上游 registry 无闲置回收：终端开着就一直开着，直到模型 close、用户关 chip（二次确认后）、
  所属会话卸载（Agent 销毁）或宿主退出（与官方原生终端一致，不跨宿主存活）。
- 模型 close 无需确认（工具调用即意图）；用户关 chip 走二次确认（close handler 抛错否决
  第一次 ×，居中确认弹窗内点「关闭终端」放行并杀，取消/Escape 撤回）。
- 终端被关闭后从 list 消失，tab 随关闭语义同步移除；插件侧 monitor（每 5 秒）只做
  「终端 → tab」视图收敛：没有 tab 的终端自动开出它的 tab，kill 失败的孤儿自愈重开。

### 页面渲染契约（xterm + 流式）

- 页面是 xterm.js（@xterm/xterm 6.0.0 + FitAddon，内联进 client bundle；官方 xterm.css 内嵌
  注入并用容器作用域覆盖 viewport 黑底），数据通道见 [插件机制](plugins.md) 的
  「kit 通道与流式响应」：`/api/terminal/stream` 流式响应先重放宿主 ring buffer（512KB 原始
  字节，整块丢弃最旧；spawn 就绪后裁到最后一个受控提示符 `dsh> `，pwsh 启动回显不进画面）
  再接实时帧；tab 隐藏断流、可见重连重放；进程退出发 exit 帧后流结束，
  tab 保留退出态（exit code + 新建终端按钮），不自动重启。tab chip 标题固定「AI交互终端」。
- 键盘直写：xterm onData → 16ms 微批 → `write` 端点；Ctrl+C、Tab、粘贴是真实按键；密码不回显
  是程序行为（sudo/REPL 关闭回显），UI 无遮罩表单。
- 尺寸：ResizeObserver → FitAddon → `resize` 端点 → ConPTY 重排；PTY 以 xterm-256color 宣告，
  程序输出 ANSI 彩色，模型 read 经上游 sanitizer 剥离转义拿到干净文本——原始彩色字节走 tap
  给浏览器，干净文本走模型，两路同源。
- 主题：底座四色（背景/前景/光标/选区）随 dsh 主题 token（`theme/change` 时重读应用）；
  16 色 ANSI 用 xterm 内置经典色板。
- 重连重放的限制：resize 之后的重放可能存在行宽错位残影（官方原生终端重连亦有类似限制）。

### Windows 就绪

PSReadLine 重绘会打乱私有提示符标记与可打印尾部顺序，还会记录 bootstrap 到用户历史。
项目在 pwsh 启动参数中移除 PSReadLine，保留 NoExit，bash 使用上游默认参数。
每次启动使用独立 20 秒超时、最多 3 次尝试，不以一次发送的 300 秒预算等待启动。
上游默认 rows:40、cols:160、scrollbackLines:10000、scrollbackMaxBytes:4MiB、maxReadBytes:256KiB；
页面 resize 上限对齐（cols ≤500、rows ≤200，单次键盘写入 ≤64KiB）。
真实交互由 terminal/tests/live.spec.ts 验证（tap 配对、直写、帧接收、send 互斥）。