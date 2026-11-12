# 会话、消息与通知

基线见 [源码依据](../02-dsh-facts.md)。以下路径相对 dsh 仓库根，项目实现明确标注。
除另有标注外，本页结论核对于 dsh `0.2.2-rc.1`。

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
Agent 的 send/followup/steer/inject 都要求 UserMessage，inject 不唤醒。
0.2.2-rc.2 起 RPC `session.prompt` 的空 content 是合法的「续跑」请求：仅 queue 模式、
`conversationContinuation` 投影非空（admitted 用户输入 + 可续失败的 turn/end）、inbox
nextTurn 空、nextStep 无 user 源输入时放行，走 `agent.followup(createUserMessage({content: []}))`
发新 turn，并把消息源记为 `kind: 'retry'`（`'retry-rpc'` 事件）。UI 侧原生 composer 在
`conversationContinuation` 非空且草稿为空时把发送键变成重试键（`ui-conversation` 的
`InputHub.retry`）。旧口径「空消息不会发模型请求」自该版本起不再成立
（`packages/api/session-controller/src/{index.ts,commands.ts,continuation.ts}`）。
agents.resume 只恢复活 Agent，不执行新推理。

`TurnEndReasonMap` 键集合相对 0.2.1 未变；`error` 结局的 `error.code` 新增
`TOOL_ACTIVATION_FAILED`（工具条件激活失败）取值，非 LlmError 的其余错误仍折叠为
`UNKNOWN`（`packages/core/session/src/types.ts`）。按上表处理结局的插件无需改动，
该取值落在 error 行。

因此事后重试必须追加一条消息，项目使用 plugin 溯源、form:notice 的短通知，显示为折叠 context 行。
原 prompt 不重发。错误投影限 2000 字，给模型的通知限 300 字，详情在弹窗查看。

followup 会追加 nextTurn 并唤醒，driver 会先消费已有排队消息。
项目在 nextTurn 非空时返回 pending-input，不调用 followup、不改队列、不生成 turn
（与 rc.2 原生续跑守卫同口径）。
nextStep 保持 dsh 原生语义。入口只有输入框上方的重试栏。
队列出处：`packages/core/agent/src/inbox.ts`、`packages/api/session-controller/src/commands.ts`。

**root agent 判定（0.2.2-rc.2 破坏性变化）**：`ctx.agents.roots()`、`isOwnedBy()` 与
`CreateAgentOptions.parentAgent` 随运行时 owner 概念一并删除（`packages/core/agent/src/index.ts`），
registry 只剩 `get(id)`/`list()`。需要「只驱动顶层会话」的插件改用
`ctx.agents.get(agent.id) === agent && agent.session.header.origin !== 'subagent'`
（`origin` 是 `'subagent' | undefined`，见 `packages/core/session/src/types.ts`）。
实例：notify 的完成通知与等待提醒、turn-retry 的可驱动判定。

## Session Projection

出处：`packages/session/session-projection/src/index.ts`、`src/types.ts`、
`packages/api/session-controller/src/control.ts`、`src/client/sessions/projection-store.ts`（0.2.2-rc.1）。

- 宿主 `sessionProjections.register(definition)` 返回 `Promise<ProjectionHandle<S>>`
  （`stateOf(session)`、`readerFor(session)`、`dispose()`）；调用方必须 await 注册完成再发布
  消费方。旧的可调用返回值与 registry 级 `stateOf(session, key)` 均弃用（仍可用，registry
  形态一次性 warn）。类型表只剩 `SessionProjectionMap`（`SessionProjectionStateMap` 已删除），
  经 session-projection/types 纯类型出口声明合并。
- apply 纯同步折叠会话事件，对无关事件必须返回同一引用，框架以 Object.is 判断是否推送；
  形状改变才调整 stateVersion。
- wire 帧按提交事件发：每帧 `{type:'projection', sessionId, seq, changes:[{key,val}…]}`，
  只在该事件至少改了一个 client-visible 视图时发送；changes 按注册序、无重复键。
  控制流一代仍以一次 `{type:'baseline'}` 开头（`session-controller/src/control.ts`）。
- 注册可声明 `summary: false`，类型侧用 `SessionProjectionSummaryExcluded<T>` 标记该键不进
  会话 summary 载荷（列表行等汇总读取）；标记是纯类型，运行时事实只有注册上的
  `summary: false`（`session-projection/src/types.ts`）。
- released unit 仍可读：handle 的 `stateOf` 以原 unit 继续折叠并推进 `checkpoint(session)`
  服务的 released cell，直到该 key 重新注册。

外部插件不能 append 自定义会话事件，原因见 [工具与进程](runtime.md)；0.2.2 起
store-owned Session 的 append 另有生命周期门控（`core/session/src/index.ts` 的
`publicationEntry`）：store 外 append、`session/created` 完成前 append、append 重入
均直接抛错——铁律不变且更严。

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

### 推理文本展示（0.2.1-rc.4 起）

出处：`packages/client/ui-chat/src/client/{reasoning-text.ts,chat/ReasoningRow.tsx,contract/slots.ts}`（0.2.1-rc.5 源码核对）。

- 原生渲染前经 `reasoningText()` 预处理：剥离模型输出里的 `<signature>…</signature>` 块
  及其后换行；剥离后无可显示内容的推理行整行隐藏。实时活动详情取同函数处理后的文本。
- `conversation.chat.reasoning.body` 槽 owner props 为 `{ rawText, text, running }`：
  `rawText` 是原始模型输出，`text` 是处理后的展示文本；Content Factory 入参
  `ReasoningContentInput` 只接 `{ text, running, labels? }`，不再继承 owner props。
  套件组件当前未占用该槽位。

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
- 0.2.2 起 turn 头部（「已完成，用时 X秒」，kind `turn-process`）下沿是消息开头的原生
  分割线：头部按钮 border-bottom `0.5px solid var(--dsw-alias-border-l2)`
  （`packages/client/ui-chat/src/client/chat/TurnProcessNodeView.module.css`，每个已闭合
  turn 一个，纯问答轮次也有）；头部 flow item 挂 `data-chat-flow-kind/data-chat-turn`，
  按钮挂 `data-turn-process`（`ChatNodeSeat.tsx`/`TurnProcessNodeView.tsx`）。头部与下方
  可见行隔 16px（`ChatView.module.css` 的 `--dsh-chat-flow-gap`）；中间隔着已隐藏过程组时
  邻接选择器不命中、响应行按自身 12px。过程组展开或多 step/交错输入轮次里头部不紧贴目标
  行，须经几何邻接校验（间距 ≤24px）才能当作这条消息的开头。这些属性是内部 seam 而非公开
  插件契约，上游改动会静默失效，升级需复核。
- `scrollTop` 会被浏览器钳制到 `scrollHeight - clientHeight`；最后一条回复较短时，它的开头在自然底部仍可能低于阅读线。需要严格顶对齐的插件必须临时补足尾部滚动空间，不能只重复调用 `scrollTo`。
- ChatView 的 `onScrollRef` 以当前 scrollTop 与 observedTop 判断读者移动；历史会话首次定位时，原生 smooth scroll 尚未移动的 scroll 事件可能触发 `toBottom`，写回底部并取消动画。ResizeObserver 的跟随也可能覆盖定位；目标 DOM 已存在不代表滚动成功。
- chat-scroll 用 requestAnimationFrame 逐帧推进消息开头定位，按帧复核真实落点；消息行等待上限 3 秒，动画/落点等待上限 1.8 秒，超时不闪线。减少动态效果同样瞬时定位后复核下一帧，读者输入或 sessionId/messageKey 变化取消待定位动作，不需要加载更早的历史。
- chat-scroll 对原生返回底部按钮只做局部 capture：动画先停在 dsh 24px 底部跟随阈值之外，再重放仍连接的原生 click，让 ChatView 自己清理 pending jump/分页锚点并恢复跟随；按钮识别、会话/滚动容器变化或交接失败时不伪造 React 状态。
- 原生返回底部按钮直接内联在 `ChatView.tsx` 的 `!atBottom` 分支，无独立 slot 或滚动 action；`chatScroll.save/read` 只保存阅读位置。`toBottom` 还清理 pending jump/分页锚点、更新 observedTop 并恢复跟随，不能只替换几何写入。接近底部（当前 24px 阈值 + 1px 容差）会使按钮卸载，不能假定 scrollend 后仍能点击它。
- 0.2.2 起 `use-chat-scroll` 新增 `submissionSteers`：最新可见提交以 steer 并入运行中轮次时，
  输入回显 instant 落尾（不做平滑动画，避免运行中轮次在回显上方继续增长把回显推下去）；
  另有 `keepAboveClosing` 折叠保持测量（延迟折叠下收起行时维持阅读位置）。插件跟随判定
  与原生 instant 落尾叠加时，注意动画取消窗口变窄。
- 0.2.2-rc.1 起会话滚动整套换新（`use-chat-viewport.ts`/`use-chat-reading.ts`/`flow-motion.ts`）：
  ChatViewport 持有 `[data-chat-turn-spacer]` 折叠余量元素（style.height 由上游写），
  ResizeObserver 观察列/滚动/composer 并触发 `keepAboveClosing`/`reclaimBelow`；
  阅读策略用 500ms 采样定时器（`flushSample`）结算读者移动并写回 `chatScroll` 存储，
  原生跟随动画（`ScrollFollow.toBottom` smooth）由 intent 事件打断。插件逐帧写 scrollTop
  会被视为读者移动；落点后上游折叠批次/回底跟随仍可能在无输入时移动视图，
  插件需要自己的短窗守护（chat-scroll 落点守护约 2.5 秒，任何 pointerdown/wheel/keydown
  在行所属 document 捕获层立即让位）。上游写入入口有三类：`write/align/jump`（instant）、
  `toBottom`（instant 或一次 smooth）、fold 批次按帧写（`flow-motion` 的 rAF 时钟）；
  hidden 标签页 rAF 冻结时动画按 1.8s 上限超时，布局稳定后的收敛交给插件守护。
- 消息行的可测量性：带工具调用的消息由多个 part 行组成（同一 `data-chat-node-key`，flow key
  为裸 key 或 `JSON.stringify([key, part])`），首个 part 常随过程分组折叠——`hidden` 属性或
  折叠过渡中的零高度都使 `getBoundingClientRect()` 全零，按零几何算目标会把落点错成
  「当前 scrollTop − 视口上沿 − 24」。定位前必须按行高过滤，取同消息第一条可测量行；
  dsh 的折叠过渡是瞬时的，等待恢复比立即放弃更稳。composer 座位
  （`[data-composer-seat]`）位于滚动容器内并占用 scrollHeight，「无滚动条」几乎不成立，
  可见性判定要用 composer 上沿做可视下界（与上游 capturePosition 同口径）。
chat-scroll 现已实现双向导航；行为与验证入口见 [插件 README](../../plugins/chat-scroll/README.md)。
- 不搬动 React 拥有的 sibling rows 来套内部滚动容器。
- chat-scroll（2026-11-10 起）把「回到消息开头」的滚动锚点与到达提示都放在上述原生分割线
  上：锚点永远是**本轮的 turn 头部**（按行 `data-chat-turn` 查找，不要求与消息行邻接——
  多步轮次的头部远在消息上方，用户要的是回到这一轮的开头），头部上沿停在滚动容器上沿下方
  20px（用户实机连续微调选定：0 inset 贴顶太挤，26/24 偏多）。整轮折叠使头部
  零高不可测量时退回消息行锚点。落点
  后注入按 `[data-chat-flow-kind="turn-process"] button[data-turn-process=N]` 属性选择的自有
  CSS 规则点亮 hairline（border 变 business-primary + `::after` 2px 光带复用自有 keyframes，
  720ms/reduced-motion 240ms 后定时移除规则）；特异性 (0,2,1) 高于 CSS module 哈希类，
  不需要 `!important`，且不向 React 拥有的节点写任何 class/属性/内联样式。整轮折叠使头部
  不可测量、头部在落点后滚出视口或上游 seam 变化时回退自绘 fixed overlay 在行顶闪线。
  衬垫、落点守护与输入让位机制不变，衬垫 prepare 直接复用与动画同源的目标值。
  「不滚动直接闪线」的跳过条件收窄为「对齐阅读线必须垫尾部空白（目标超过
  scrollHeight−clientHeight）且开头已可见」：只判「开头可见」会让屏幕中部的消息开头原地不动
  （2026-11-10 用户实机反馈），长会话里下方仍有内容时目标可达，必须照常滚动。

## 原生分叉节点约束

出处：`packages/client/ui-chat/src/client/chat/TurnTailNodeView.tsx`、`conversation-nodes/common.ts`。

审批与用户提问位于 composer，turn-tail 是独立行。
原生分叉要求 turn-tail 是该 turn 最后一个 Chat Node，组件返回 null 不会从 Location 索引删除节点。
真实后续工具或 steering 仍应阻止原生分叉。

## 用户消息分叉

出处：`packages/api/session-controller/src/commands.ts`、`src/client/sessions/service.ts`、
`packages/client/ui-conversation/src/client/contract/input.ts`、`packages/client/ui-chat/src/client/chat/MessageItem.tsx`。

fork(sessionId,atSeq) 找 atSeq 后的完整 turn/end 前缀，创建带 `isSeeded` 前缀的子会话，源会话不变。
**0.2.2 起普通 fork 不再写 `parentSession`/`parentSessionId`**：`SessionHeader.parentSession`
语义收窄为「仅子代理会话的直接创建者」，presence 不再作为子代理判定，分类只认 `origin`；
会话列表的血缘缩进只认 `origin==='subagent'` 且 parent 存在（`client/sessions/lineage.ts`），
历史普通 fork 保留的旧 parent 值不再参与缩进（上游升级指南：
`docs/upgrade-guide/v0.2.1-rc.3/independent-session-forks/`）。
要从用户消息之前重做，传该 turn 之前最后一个已完成 turn/end 的 seq，不能传用户消息自身 seq。
子会话通过 scoped SessionInput.setDraft 回填文本，标题由 increaseTitle 递增。
客户端导航：0.1.6 起 ISessions 不再有 open/openSubagent（导航归 view owner），打开子会话用 ctx.uiWorkspace.openSession(id)。
没有普通 user-actions 子槽，项目以 user keyed renderer 影子覆盖并保留复制/时间操作。
首轮消息之前没有已完成 turn/end，不能 fork：项目改为 sessions.create（同工作区，未归组时用相同 cwd）
新建普通会话、回填同一条文本，再按 view owner 规则导航；空文本、附件或未知内容块仍禁用，历史不全先分页补齐。
dsh 只为已 retain 的会话物化 client scope：fork()/create() 只登记目录行，ISessions.scope() 此时是 undefined，
input.for(scope) 也拒绝没有 retained binding 的 scope，所以回填草稿必须放在 openSession 之后。
fork 子会话继承源会话的 agent preset（presetForObservation），sessions.create 的新会话按 Host 默认预设组合，与「新会话」按钮一致。

程序化「发送」（task-board 实例，2026-10-29 实机验证）：`SessionInput.submit(mode?, source?)` 与
`setDraft` 一样在 shell（input hub 的 per-session facade）层面工作，不要求 composer 已挂载——
`create → openSession → scope.get('conversation').input.for(scope)` 后 `setDraft(text)` +
`submit('queue','click')` 即把文本真正发出（输入法/命令仲裁都走原生 submit 机器）。
`openSession` 的 replaceMain 用 'reveal' 语义，会顺带 `layout.selectPanel(null)` 把
全局面板切回该会话；mode 是 BusyEnterBehavior（'queue' | 'steer'），不是 'send'。
实例：`plugins/task-board/src/client/draft-task.ts`（2026-11-02 起只 `setDraft` 不 submit，
发送留给用户现选模型/思考强度）。

## 程序化图片草稿附件

出处（0.2.1-rc.5）：`packages/client/ui-conversation/src/client/{service.ts,apply.ts,contract/input.ts}`、
`packages/client/ui-attachment/src/client/ComposerAttachments.tsx`、
`packages/client/ui-workspace/src/client/navigation.ts`。

把浏览器 `File` 作为图片附件加入某个会话的输入框草稿，不需要 DOM 注入、不需要 composer
已挂载、不发送。`setDraft(text)` 只接受纯文本，附件必须走下面的运行时 id 契约：

- `ctx.get('conversation')` 取服务：`ConversationController` 由 ui-conversation 的 `apply`
  经 `ctx.plugin` 注册在它自己的 fiber 上；`reflect.get` 按 root isolate 全局查找，因此
  其它插件 fiber 也读得到（ui-workspace/navigation.ts 的 `prepareDraft` 同款跨 fiber 用法）。
  现取而不是在 `apply` 时缓存：面板首开时该服务可能尚未激活。
- `createDrafts(sessionId, files, uploadImages)`（`service.ts`）按 `isImageMediaType` 分流：
  只认 `image/png|jpeg|webp|gif`，命中即建 object URL 预览并登记运行时图片草稿；第三参
  `uploadImages` 为 true 时图片草稿也立刻启动宿主预上载（0.2.2 起；会话不接受图片上传时传
  false，如子代理续聊——无上传的图片草稿在发送时把字节随 prompt 内联）。其它 MIME 会变成
  文件草稿并立刻启动宿主文件上传。`ComposerBarInjected.addFiles`
  （`apply.ts`）是同一入口的原生封装，但它只在 composer 槽内注入，第三方插件不用它。
- `conversation.input.for(scope).addAttachments(ids): boolean`（`contract/input.ts` 的
  `SessionInput`/`InputActions`）把 id 追加到输入状态并 publish；`adjudicating`/`submitting`
  阶段返回 false。返回 false 必须 `releaseDraftAttachments(drafts)` 释放预览 URL 与运行时
  附件，避免泄漏。原生附件栏读 `useInput.attachmentIds` + `resolveDraftAttachments` 渲染缩略图，
  发送时 `serializeDraftAttachments` 产出 `{ type: 'image', mediaType, data, name }`。
- 新建会话回填顺序不变：`sessions.create()` → `uiWorkspace.openSession()` →
  `scope.get('conversation')`，与纯文本 `setDraft` 完全同链。
- 实例：`plugins/task-board/src/client/draft-task.ts`（2026-11-04，卡片图片随文本一起填入
  新对话草稿，卡片标题不参与）；`plugins/user-message-fork/src/shared.ts` 因 `setDraft` 无法
  表示附件而对带附件的历史消息禁用重发。

## 输入框提交契约（0.2.2-rc.1 增补）

出处：`packages/client/ui-conversation/src/client/contract/{input,slots}.ts`、
`packages/client/ui-chat/src/client/contract/slots.ts`、`chat/register-node-renderers.ts`。

- `InputState.phase` 新增 `'sending'`（提交已受理、出站中）；`adjudicating`/`submitting`
  阶段拒绝 `addAttachments` 的口径不变，读 phase 判定忙碌的插件把 `sending` 一并视为
  不可编辑窗口。
- `SubmitAttempt` 携带 `occurrences`/`quotes`/`attachmentIds`：引用块与附件随提交一起过
  仲裁链，监听提交事件的插件按同一形状读取。
- `insertQuote(text): boolean`（`SessionInput` 与 `InputActions`）：把非空文本作为原子
  引用块插入草稿，编辑器拒绝（提交锁定等）时 false；坐标语义同 `insertText` 的
  clipboard 投影。
- `SessionInput.focus()`（`facade.ts`，`contract/input.ts`）：把键盘交回 composer 并恢复
  编辑器记忆的选区，供「浮层/菜单拿走焦点后交还」的调用方使用。两个前提事实让它成为
  插入后定位光标的唯一正确路径：编辑器失焦时 `preserveExternalSelection`（`runtime.ts`
  的 BLUR_COMMAND/SELECTION_CHANGE_COMMAND/RootNode 守卫）会给更新打
  `SKIP_DOM_SELECTION_TAG`，于是 `insertText()` 改的只是编辑器选区、不会写回 DOM
  （光标不可见、打字进不去）；而 `focus()` 内部先 `rootElement.focus()` 再
  `editor.focus()`（Lexical 的 focus 只把编辑器选区落回 DOM，自己不点焦点），因此插入
  →`focus()` 后 DOM 光标正好停在插入文本末尾。取法：`ctx.get('conversation')
  .input.for(ctx.sessions.scope(sessionId))`（会话 scope 必须已 retain，切走后 `for()`
  抛错）。实例：`plugins/quick-commands/src/client/index.tsx`（2026-11-10）。
- 用户消息行新增 `conversation.chat.user.before` chain 子槽（session 作用域）：渲染在
  用户消息内容之前的装饰 seat，owner 按 durable source 与行 kind 选择组件；steering 与
  pending 行不渲染该槽（`ui-chat/src/client/contract/slots.ts`）。
- composer 系槽位（conversation.composer、conversation.input.dock、input.left/right、
  composer.bar、input.activity 等）的座位处于 fixed 后代 containing block 内（composer
  座位 z-index 9 + will-change）：fixed 覆盖层（菜单、弹层、拾取器）必须 portal 到
  document.body，否则被 composer 卡片收缩定位（`ui-conversation/src/client/contract/slots.ts`
  各槽 JSDoc）。会话头部的 lineage/actions 区溢出裁剪并渐隐，overlay 同样必须 portal。

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
Windows 上主实例已运行时前台锁定使点击只闪任务栏，机制见 desktop-app.md「协议唤起」。
未注册时不声明 launch，点击退化为关闭，避免系统的「如何打开此链接」错误。
文案经环境变量传入固定 PowerShell 脚本，XML 用 CreateTextNode，不拼接可执行文本。
这是目标机器的 Windows 桌面通知，不是手机 Web Push。