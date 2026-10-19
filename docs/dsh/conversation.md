# 会话、消息与通知

基线见 [源码依据](../02-dsh-facts.md)。以下路径相对 dsh 仓库根，项目实现明确标注。

## 会话起始目录

出处：`packages/api/session-controller/src/index.ts`、`packages/api/session-controller/src/commands.ts`。

session.create 不带 workspaceId / cwd 时，新会话的 cwd 取 controller 构造时的
defaultCwd，即 dsh 进程的 `process.cwd()`。dsh-kit 不介入 dsh 的启动，因此新会话起始目录
就是启动 dsh 时的 cwd；需要固定工作区时从启动命令的 cwd 或新建会话时指定的目录决定。

## 失败与重试

出处：`packages/core/agent-loop/src/agent.ts`、`packages/core/agent/src/runtime-types.ts`、
`packages/llm/llm-retry/src/index.ts`、`packages/llm/llm/src/retry-policy.ts`。

模型请求失败时先进入 agent/request-error waterfall；返回 kind:retry 可在同一 turn/step 继续。
llm-retry 默认最多 5 次、初始 500ms、上限 10 秒，可重试码包括 EMPTY_RESPONSE、RATE_LIMIT、SERVER、TIMEOUT、TRANSPORT。
放弃时调用 next；mode:always 会先 next 再无限退避，不能靠下游监听次数判断预算是否耗尽。
最终抛错会写 turn/end，失败后已有 nextTurn 队列可能被搁置。

turn-retry 以持久化 turn/end 为依据：

| 结局 | 动作 |
|---|---|
| error | 重试 |
| aborted:user、disposed、legacy；interrupted | 继续 |
| aborted:hook、parent | 不提供恢复动作 |
| completed、blocked、max-tokens | 正常收尾，不显示重试 |

agent/error 是运行时事件且早于 turn/end，不适合作为持久 UI 状态源。
Agent 的 send/followup/steer/inject 都要求 UserMessage，inject 不唤醒；空消息不会发模型请求。
agents.resume 只恢复活 Agent，不执行新推理。

因此事后重试必须追加一条消息，项目使用 plugin 溯源、form:notice 的短通知，显示为折叠 context 行。
原 prompt 不重发。错误投影限 2000 字，给模型的通知限 300 字，详情在弹窗查看。

followup 会追加 nextTurn 并唤醒，driver 会先消费已有排队消息。
项目在 nextTurn 非空时返回 pending-input，不调用 followup、不改队列、不生成 turn。
nextStep 保持 dsh 原生语义。入口只有输入框上方的重试栏。
队列出处：`packages/core/agent/src/inbox.ts`、`packages/api/session-controller/src/commands.ts`。

## Session Projection

出处：`packages/session/session-projection/src/index.ts`、
`packages/api/session-controller/src/control.ts`、`src/client/sessions/projection-store.ts`。

宿主注册 key、stateVersion、stateSchema、init、apply、wire，纯同步折叠会话事件。
Session Controller 推送所有注册 wire key 的变化，客户端 useProjection 按 key 读取，不需另注册协议。
apply 对无关事件必须返回同一个引用，框架以 Object.is 判断是否推送。
形状改变才调整 stateVersion；类型合并使用 session-projection/types 纯类型出口。

外部插件不能 append 自定义会话事件，原因见 [工具与进程](runtime.md)。

## 原生工作步骤展示

出处：`packages/client/ui-chat/src/client/conversation-nodes/{turn-process,process-groups,process-activity}.ts`、
`chat/{ChatNodeSeat,ChatGroupSeat}.tsx`、`presentation-policy.ts`。
本节原生行为核对于已安装的 `@deepseek-ai/dsh-client-ui-chat@0.1.7-rc.1/lib/client.js`；
源码路径对应产物中的模块，不以版本不同的本地源码 checkout 推断当前行为。

- `processWindowReady` 根据本轮的 start/closed 证据与展示策略判断，不依赖 `historyIncomplete`；
  未加载的内容不呈现。
- `process-groups` 按助手回复、用户输入/steering、重试和错误等边界切段；
  助手推理与正文通过 `groupPart:reasoning/response` 分开渲染，正文不进局部过程组。
- 设置 → 通用设置 → 工作步骤展示：简洁/标准将运行中的过程组也默认折叠；标准是默认值，
  显示实时活动及详情。详细模式展开运行轮次的组，完全展开模式同时取消整轮折叠。
- 过程组展开后使用 `max-height:min(400px,50vh)` 的内部滚动区及独立跟随。
- 外层整轮折叠会让符合条件的已完成轮次只保留最终答案，先前中间回复可能一起收起。
  运行中、停止/错误及含中途输入的轮次保持外层展开，不妨碍局部过程组折叠。
- 结束组摘要显示活动类别。

## 会话统计弹窗

出处：`packages/client/ui-chat/src/client/chat/{StatsPills.tsx,stat-dialog.ts}`、`locale.ts`。

输入框下方的时间 pill 打开「会话统计」弹窗（portal 到 document.body）：
模型用时、工具调用用时与首 token 平均都走 `formatDuration`，只有两档——
`duration.compactSeconds`（`3.8秒`）与 `duration.compactMinutes`（`62分5秒`/`62m5s`），
超过一小时不会进位。弹窗明细 `dl` 带 `data-session-stats-details` 测试钩子
（Token 用量弹窗是 `data-session-stats-usage`），这是插件改写显示的版本受控 seam。
对照：消息行用时与运行指示的 `formatRunDuration`（`chat/message-chrome.ts`）
本就三档全显（`1小时0分0秒`/`1h 0m 0s`，单位来自 `duration.hourUnit/minuteUnit/secondUnit`，
英文小时与分钟单位带尾随空格）。stats-hours 插件按 body 级 MutationObserver
跟随弹窗 DOM，把 ≥1 小时的两档文本整节点改写成 `formatRunDuration` 同款三档；
识别整串匹配，改写结果不再命中模式，无循环。上游原生补上小时档后停用该组件即还原。

## 会话滚动导航

出处：`packages/client/ui-chat/src/client/chat/{ChatNodeSeat.tsx,ChatView.tsx,ChatView.module.css}`。

每行有 data-chat-flow-key、anchor-key、kind、turn。

- 从祖先实际 overflow 查找滚动容器；不能写死 .scroll，因为布局可把滚动交给祖先。
- `scrollTop` 会被浏览器钳制到 `scrollHeight - clientHeight`；最后一条回复较短时，它的开头在自然底部仍可能低于阅读线。需要严格顶对齐的插件必须临时补足尾部滚动空间，不能只重复调用 `scrollTo`。
- ChatView 的 `onScrollRef` 以当前 scrollTop 与 observedTop 判断读者移动；历史会话首次定位时，原生 smooth scroll 尚未移动的 scroll 事件可能触发 `toBottom`，写回底部并取消动画。ResizeObserver 的跟随也可能覆盖定位；目标 DOM 已存在不代表滚动成功。
- chat-scroll 用 requestAnimationFrame 逐帧推进消息开头定位，按帧复核真实落点；消息行等待上限 3 秒，动画/落点等待上限 1.8 秒，超时不闪线。减少动态效果同样瞬时定位后复核下一帧，读者输入或 sessionId/messageKey 变化取消待定位动作，不需要加载更早的历史。
- chat-scroll 对原生返回底部按钮只做局部 capture：动画先停在 dsh 24px 底部跟随阈值之外，再重放仍连接的原生 click，让 ChatView 自己清理 pending jump/分页锚点并恢复跟随；按钮识别、会话/滚动容器变化或交接失败时不伪造 React 状态。
- 原生返回底部按钮直接内联在 `ChatView.tsx` 的 `!atBottom` 分支，无独立 slot 或滚动 action；`chatScroll.save/read` 只保存阅读位置。`toBottom` 还清理 pending jump/分页锚点、更新 observedTop 并恢复跟随，不能只替换几何写入。接近底部（当前 24px 阈值 + 1px 容差）会使按钮卸载，不能假定 scrollend 后仍能点击它。
chat-scroll 现已实现双向导航；行为与验证入口见 [插件 README](../../plugins/chat-scroll/README.md)。
- 不搬动 React 拥有的 sibling rows 来套内部滚动容器。

## 原生分叉节点约束

出处：`packages/client/ui-chat/src/client/chat/TurnTailNodeView.tsx`、`conversation-nodes/common.ts`。

审批与用户提问位于 composer，turn-tail 是独立行。
原生分叉要求 turn-tail 是该 turn 最后一个 Chat Node，组件返回 null 不会从 Location 索引删除节点。
真实后续工具或 steering 仍应阻止原生分叉。

## 用户消息分叉

出处：`packages/api/session-controller/src/commands.ts`、`src/client/sessions/service.ts`、
`packages/client/ui-conversation/src/client/contract/input.ts`、`packages/client/ui-chat/src/client/chat/MessageItem.tsx`。

fork(sessionId,atSeq) 找 atSeq 后的完整 turn/end 前缀，创建带 parentSession 的子会话，源会话不变。
要从用户消息之前重做，传该 turn 之前最后一个已完成 turn/end 的 seq，不能传用户消息自身 seq。
子会话通过 scoped SessionInput.setDraft 回填文本，标题由 increaseTitle 递增。
客户端导航：0.1.6 起 ISessions 不再有 open/openSubagent（导航归 view owner），打开子会话用 ctx.uiWorkspace.openSession(id)。
没有普通 user-actions 子槽，项目以 user keyed renderer 影子覆盖并保留复制/时间操作。
首轮消息之前没有已完成 turn/end，不能 fork：项目改为 sessions.create（同工作区，未归组时用相同 cwd）
新建普通会话、回填同一条文本，再按 view owner 规则导航；空文本、附件或未知内容块仍禁用，历史不全先分页补齐。
dsh 只为已 retain 的会话物化 client scope：fork()/create() 只登记目录行，ISessions.scope() 此时是 undefined，
input.for(scope) 也拒绝没有 retained binding 的 scope，所以回填草稿必须放在 openSession 之后。
fork 子会话继承源会话的 agent preset（presetForObservation），sessions.create 的新会话按 Host 默认预设组合，与「新会话」按钮一致。

## 会话重命名

出处：`packages/session/session-title/src/{index,normalize}.ts`、
`packages/api/session-controller/src/{commands,index}.ts`（`rename` Remote）、
`packages/api/session-controller/src/client/sessions/session.ts`（client `rename`）、
`packages/client/ui-workspace/src/client/{rows/Rows,shortcuts,session-actions/RenameSession}.tsx`、
`packages/client/ui-conversation/src/client/skeleton/{ConversationHeader,ConversationSession}.tsx`、
`packages/client/ui-session/src/client/index.ts`（`uiSession.adapter.current`）。

- rename 是官方命令链：宿主 `session.rename` → `sessionTitle.rename` 规整后
  append `session/title` 事件（source `user`）；用户显式重命名会 **pin** 标题，
  在途自动生成被取代、后续用户消息不再调度。规整剥控制/方向控制符并压缩空白，
  规整后为空抛 `SessionTitleInvalidError`（wire 错误 `session/title-invalid`），
  并按 `maxTitleBytes` 截断。客户端 `binding.session.rename(title)` 成功后立即用
  响应 `{title, seq}` 结算 `title` 投影（高 seq 胜），顶栏 crumb 与侧栏行同帧更新。
- 原生入口只在侧栏：行双击（`onDoubleClick`，空白行不响应）、右键菜单与
  `Cmd/Ctrl+Alt+G`；弹窗（`shell.overlay` 的 `workspace.session-rename`）由
  ui-workspace 私有 shortcutControls store 驱动，第三方无法触发。
  session-rename 组件以同一契约自建：`shell.overlay` 条目 + 请求 store +
  `sessions.using(id, {source}, ref => ref.binding.session.rename(title))`。
  弹窗结构：Modal + 输入框（44px、border-l4、无焦点描边——原生如此）+
  右下角 outline 取消 / primary 重命名；回车提交（IME 组合中的回车不提交）、
  提交中禁用、错误行 role=alert。空白会话不响应、种子草稿用持久 `title`
  （不是回落目录名的 `displayTitle`），与原生行双击同口径。
- 顶栏标题 DOM：`ConversationSessionHeader` 的当前会话 crumb 是纯文本 span
  （刻意非 button：darwin 标题区是窗口拖拽区），带 CSS module 类
  `<hash>_crumbCurrent`（哈希随构建、后缀随版本）；祖先 crumb 是 button
  （只有 `_crumb`）。面包屑没有专用 data 钩子；稳定锚点是 header 的
  `data-window-drag`。session-rename 的双击识别 = `header[data-window-drag]`
  内 `[class*="crumbCurrent"]`；上游类名后缀变更时静默失效，升级需复核。
  当前会话身份用 `ctx.uiSession.adapter.current.getSnapshot().key`
  （SessionId；无选择时 undefined）。darwin 上双击拖拽区可能同时触发系统
  窗口缩放，属平台行为。

## 任务通知

出处：`packages/core/agent/src/runtime-types.ts`、`packages/core/agent-loop/src/agent.ts`、
`packages/interaction/user-approval/src/types.ts`、`packages/interaction/user-questions/src/types.ts`。

dsh 页面内完成标记不是系统通知。notify 插件观察 agent/status:idle，不能用 turn/end 替代：
一轮结束后 inbox 可能继续运行，idle 下一行也可能同步重新唤醒 driver。
因此延迟 700ms，并再次确认 agent.status。

approval/request 与 user-questions/request 是 waterfall，观察者必须 prepend:true 并原样 next。
被认领的应答者不继续 next，排其后无法观察。事件也不代表卡片实际等待，
用 3 秒计时判断请求是否仍悬挂；asked/decided 审计事件不能用来判断用户正在等待。

会话 cwd 在 session.header，标题来自 title projection，首次完成时标题可能尚未生成。
Windows toast 使用 reminder 场景并有关闭 action；AUMID 不可用时 API 可能成功但不显示，必须保留测试通知按钮。
点击卡片唤起桌面版：脚本发送前现查桌面协议注册（`HKCU/HKLM …Classes\dsh\shell\open\command`），
已注册才声明 `launch="dsh://open"` + `activationType="protocol"`——点击由 Shell 直接执行协议 URL，
与发送进程存活无关（出处：`apps/desktop/src/main.ts` 的 `setAsDefaultProtocolClient`、
`open-url` 对 `dsh://open` 精确匹配 `focusPrimaryWindow`，Windows 协议激活经
`second-instance` 走同一函数，见 [官方桌面应用](desktop-app.md)）。
未注册时不声明 launch，点击退化为关闭，避免系统的「如何打开此链接」错误。
文案经环境变量传入固定 PowerShell 脚本，XML 用 CreateTextNode，不拼接可执行文本。
这是目标机器的 Windows 桌面通知，不是手机 Web Push。