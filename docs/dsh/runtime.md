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
项目插件直接实例化 TerminalSessionService，backend 用 ctx.plugin，wrapper 捕获上游 apply 的六次注册。
缺少、重复或未知注册均整组失败；模型只看见 interactive_terminal 的 start/write/read/list/interrupt/close。
start 合并创建与前台发送，write 向既有会话续发输入（submit=false 表示只敲字符不回车），
interrupt 固定 SIGINT，不暴露 raw send 或任意 signal。
上游 0.2.1 的 terminal_open 经 workingDirectory.ensure 解析会话目录；wrapper 的捕获 facade 在
宿主未提供该服务（旧版 dsh）时兜底进程 cwd，宿主有该服务时原样透传。

严格用于预期必须让用户在可见终端直接输入的命令。普通命令、构建、Git、测试、长任务与持久 shell 状态
均使用 pwsh/bash；可改非交互的优先改非交互。持续服务使用 services。

Linux 个人用户部署允许一个窄范围例外：所有 sudo 命令都必须通过交互终端执行，即使缓存可能跳过密码提示；
已经因 sudo 人工认证而打开的交互终端，可以在同一管理员任务内复用系统的 sudo 凭据缓存执行后续明确命令。
这不等于允许用 interactive_terminal 承担普通持久 shell 工作。模型应先说明具体命令和影响，不主动运行 `sudo -i`、`sudo su`、`su root` 或等价的持续 root shell，
也不修改 sudoers、配置免密授权或用脚本维持 root 控制通道。密码只由用户在网页终端输入。

### Registry 契约

- owner 按对象同一性比较且必须是 live Agent，恢复出的新 Agent 不等于原 owner。
- 同一终端同时只允许一次发送，重复发送同步抛 SEND_ACTIVE。
- startSend 的 submit 只追加回车，text 原样写入，不转义控制字节。
- 面板只有 list/read/send/interrupt，不能创建或关闭终端。
- backend 在非 danger-full-access 下调用 ctx.sandbox.confine，插件不自己 spawn 终端。
- sendWaitMs 默认 10 秒，等待后仍忙返回 busy:true，页面必须保留草稿。
- 短暂 unavailable 不等于终端已关闭，轮询失败不能立即卸载面板丢草稿。
- 浏览器输入框默认使用密码遮罩，关闭拼写检查、自动纠正、自动大写和自动填充提示；切换 conversation 或 terminal
  时清除草稿，收起 panel 也清除不可见草稿，过时请求不能清空新 terminal 的输入。输入未作为模型工具参数保存，但目标程序回显时仍可能进入输出。

### Windows 就绪与轮询

PSReadLine 重绘会打乱私有提示符标记与可打印尾部顺序，还会记录 bootstrap 到用户历史。
项目在 pwsh 启动参数中移除 PSReadLine，保留 NoExit，bash 使用上游默认参数。
每次启动使用独立 20 秒超时、最多 3 次尝试，不以一次发送的 300 秒预算等待启动。

终端列表每 5 秒轮询，展开画面每 1.5 秒，发送后 4 秒内加快到 400ms。
画面按 revision 返回变化，页面隐藏时停止轮询。真实交互由 terminal/tests/live.spec.ts 验证。
上游默认 rows:40、cols:160、scrollbackLines:10000、scrollbackMaxBytes:4MiB、maxReadBytes:256KiB；
read 的 offset 从最新行向前计数，count 默认 500。