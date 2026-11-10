# @dsh-kit/dsh-plugin-chat-scroll

为 dsh 会话提供统一的滚动导航：每条正式 Agent 消息下方增加一个向上箭头，点击后把这条消息所属
turn 的「已完成，用时 X秒」头部（或消息本身的开头）贴到视口顶部（头部整行可见，其下方就是
dsh 原生分割线），并在落点短暂点亮这条原生分割线；dsh 原生右下角的向下箭头返回底部时增加
平滑滚动动效。

## 行为

- 按钮位于 dsh 原生的 `conversation.chat.assistant-actions` 槽，与复制、点赞、分支按钮处在同一个操作组中。
- 每条正式 Agent 消息都有自己的按钮；按钮只绑定当前操作组收到的 `messageId`，不局限于最后一条消息。
- 提示文案为「回到消息开头」；英文环境显示 `Back to the start of the message`。
- 通过 Chat snapshot 的 `assistant-step.finalNode.messageId` 找到对应消息行，再用 dsh 的
  `data-chat-flow-key` 找到真实 DOM，不猜 URL、不移动 React 拥有的节点。带工具调用的消息
  首个 part 可能被折叠在过程分组里（hidden/零高，rect 全零）：按同一 `data-chat-node-key`
  的全部 part 行取第一条可测量的行定位，整条消息都折叠时等待而不是按零几何错位。
- 落点锚点是**本轮的 turn 头部**：按目标行的 `data-chat-turn` 沿祖先 flow 层查找同轮的
  turn-process 头部按钮（`button[data-turn-process]`），不要求它紧贴消息行——多步轮次里头部
  远在消息上方，落点仍是这一轮的开头。头部不可测量（整轮折叠隐藏）或缺失时退回消息行锚点。
- 滚动容器不写死：优先使用 dsh ConversationRoot 的
  `[data-conversation-scroll]`，否则沿祖先查找 ChatView 自己的滚动框。
- 落点让锚点上沿停在滚动容器上沿下方 20px（`LANDING_INSET_PX`）：头部整行可见、原生分割线
  （头部按钮的 border-bottom）落在其下方约 33px 处，顶部留一行左右的呼吸位（用户实机连续
  微调选定）。普通浏览器使用 smooth scroll，开启「减少动态效果」时改为瞬时定位。
- 只有「对齐顶部必须临时垫出尾部空白」（无滚动条的短页、会话最后一条消息）且开头本来
  就看得见时才不滚动，直接在当前分割线闪烁——此时硬对齐只会垫出无意义的空白。长会话里
  开头在屏幕中部可见、下方仍有内容时照常滚动到顶部，不会原地不动。
- 最后一条回复较短时，浏览器会在自然滚动底部提前钳住目标位置；插件按缺口临时增加尾部滚动空间，下一次用户滚轮、触摸或键盘输入时恢复正常尾部。
- 切换历史会话时如果消息行尚未提交到 DOM，点击动作会等待目标出现，而不是静默失效。
- 首次定位不需要先滚到顶部或点击「加载更早」。插件用 requestAnimationFrame 逐帧推进，若 dsh 保持底部的逻辑介入，会重新测量并继续动画；正常进行的滚动不受干扰。
- 滚轮、触摸、键盘输入或切换会话会取消待完成的定位；定位与校正均有超时上限。
- dsh 0.2.2 起会话视口引入折叠批次与回底跟随等自有滚动机制，可能在无用户输入时移动视图：
  动画落点后插件继续按帧守护约 5 秒，把无输入的漂移拉回落点；写回被滚动底钳制时按当前
  几何重新补足尾部空间再写；目标行瞬时折叠（零高/隐藏）时等待恢复（上限 40 帧），行卸载即停。
  任何指针、滚轮或键盘输入（行所属 document 捕获层）立即让位，原生 Turn 导航等跳转不会被争夺。
- 返回底部保留 dsh 原生按钮和状态更新：插件先动画到原生底部阈值外，再重放仍连接的原生按钮 click，由 dsh 完成最终归位、清理分页锚点并恢复新消息跟随；无法安全接管时不拦截原生行为。
- 只有确认到达后才闪线，且点亮 dsh 原生分割线：注入按
  `[data-chat-flow-kind="turn-process"] button[data-turn-process=N]` 属性选择的自有 CSS 规则，
  hairline 变 `--dsw-alias-state-business-primary` 并叠 2px `::after` 光带（720ms 渐隐，
  「减少动态效果」240ms），动画结束即移除规则；不向 dsh / React 拥有的消息行写 class、属性
  或内联样式。整轮折叠导致头部不可测量（没有可点亮的原生线）、或头部在落点后滚出视口、
  或上游 seam 变化时，回退为插件自己的 fixed overlay 在行顶闪烁。开启「减少动态效果」
  也会在下一帧复核落点。

这些接缝已在 dsh 源码中核实：

- `packages/client/ui-chat/src/client/contract/slots.ts`
- `packages/client/ui-chat/src/client/chat/TurnTailNodeView.tsx`
- `packages/client/ui-chat/src/client/chat/ChatNodeSeat.tsx`
- `packages/client/ui-chat/src/client/chat/TurnProcessNodeView.tsx`（分割线 = 头部按钮的
  `border-bottom: 0.5px solid var(--dsw-alias-border-l2)`，`TurnProcessNodeView.module.css`）
- `packages/client/ui-chat/src/client/chat/ChatView.module.css`（头部与下方内容 16px 间隙）
- `packages/client/ui-chat/src/client/chat/ChatView.tsx`
- `packages/client/ui-conversation/src/client/skeleton/ConversationRoot.tsx`

## 开发

```powershell
pnpm --filter @dsh-kit/dsh-plugin-chat-scroll build
pnpm --filter @dsh-kit/dsh-plugin-chat-scroll test
pnpm --filter @dsh-kit/dsh-plugin-chat-scroll typecheck
```

浏览器回归：首次打开仍有「加载更早」的历史会话，不滚动、不加载更多，直接点击最后一条回复的「回到消息开头」，确认「已完成，用时 X秒」头部（或消息开头）贴到视口顶部、顶部不残留上一条消息的半行、其下分割线被短暂点亮且 有中间滚动位置；再检查短回复、其他回复各自的按钮、切换会话以及「减少动态效果」（分割线 240ms 短闪）。展开一条消息的过程组再点击，确认回退为行顶自绘线。手动上滚后点击右下角原生向下箭头，确认有中间滚动位置、最终回到底部，继续生成内容时仍自动跟随；深浅主题与中英文都需验收。

插件改完后必须重启 dsh；当前 `dsh-kit-web` profile 没有 HMR，单纯刷新页面不会重新加载新的浏览器 bundle。

## 分发与管理

本包不作为独立安装项分发，而是 `@dsh-kit/dsh-plugin-conversation-enhancements`（会话增强 Bundle）的组件。停用后，消息开头定位与返回底部按钮消失，回到 dsh 原生滚动行为。
可在该 Bundle 详情中单独停用或重新启用本组件；安装、卸载和升级以整个会话增强 Bundle 为单位。
套件安装后本组件默认启用；后续升级以整个套件为单位，并保留 Bundle 与组件的停用状态；卸载后不会自动补回。
需要重装时，在 dsh「添加插件」中填写套件目录 `plugins/suite` 的绝对目录。
