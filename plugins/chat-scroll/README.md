# @dsh-kit/dsh-plugin-chat-scroll

为 dsh 会话提供统一的滚动导航：每条正式 Agent 消息下方增加一个向上箭头，点击后回到**这条消息的开头**并在落点短暂闪过分界线；dsh 原生右下角的向下箭头返回底部时增加平滑滚动动效。

## 行为

- 按钮位于 dsh 原生的 `conversation.chat.assistant-actions` 槽，与复制、点赞、分支按钮处在同一个操作组中。
- 每条正式 Agent 消息都有自己的按钮；按钮只绑定当前操作组收到的 `messageId`，不局限于最后一条消息。
- 提示文案为「回到消息开头」；英文环境显示 `Back to the start of the message`。
- 通过 Chat snapshot 的 `assistant-step.finalNode.messageId` 找到对应消息行，再用 dsh 的
  `data-chat-flow-key` 找到真实 DOM，不猜 URL、不移动 React 拥有的节点。带工具调用的消息
  首个 part 可能被折叠在过程分组里（hidden/零高，rect 全零）：按同一 `data-chat-node-key`
  的全部 part 行取第一条可测量的行定位，整条消息都折叠时等待而不是按零几何错位。
- 滚动容器不写死：优先使用 dsh ConversationRoot 的
  `[data-conversation-scroll]`，否则沿祖先查找 ChatView 自己的滚动框。
- 落点沿用 dsh Turn 导航的 24px 阅读线；普通浏览器使用 smooth scroll，开启「减少动态效果」时改为瞬时定位。
- 消息开头已在可视区内（无滚动条的短页，或开头本来就看得见）时不滚动、不加临时尾部空间，
  直接在消息行当前顶部闪烁分界线——把可见内容硬对齐到阅读线只会垫出无意义的空白。
- 最后一条回复较短时，浏览器会在自然滚动底部提前钳住目标位置；插件按缺口临时增加尾部滚动空间，下一次用户滚轮、触摸或键盘输入时恢复正常尾部。
- 切换历史会话时如果消息行尚未提交到 DOM，点击动作会等待目标出现，而不是静默失效。
- 首次定位不需要先滚到顶部或点击「加载更早」。插件用 requestAnimationFrame 逐帧推进，若 dsh 保持底部的逻辑介入，会重新测量并继续动画；正常进行的滚动不受干扰。
- 滚轮、触摸、键盘输入或切换会话会取消待完成的定位；定位与校正均有超时上限。
- dsh 0.2.2 起会话视口引入折叠批次与回底跟随等自有滚动机制，可能在无用户输入时移动视图：
  动画落点后插件继续按帧守护约 5 秒，把无输入的漂移拉回阅读线；写回被滚动底钳制时按当前
  几何重新补足尾部空间再写；目标行瞬时折叠（零高/隐藏）时等待恢复（上限 40 帧），行卸载即停。
  任何指针、滚轮或键盘输入（行所属 document 捕获层）立即让位，原生 Turn 导航等跳转不会被争夺。
- 返回底部保留 dsh 原生按钮和状态更新：插件先动画到原生底部阈值外，再重放仍连接的原生按钮 click，由 dsh 完成最终归位、清理分页锚点并恢复新消息跟随；无法安全接管时不拦截原生行为。
- 只有确认到达后，分界线才由插件自己的 fixed overlay 闪烁，不向 dsh / React 拥有的消息行写 class 或属性；开启「减少动态效果」也会在下一帧复核落点。

这些接缝已在 dsh 源码中核实：

- `packages/client/ui-chat/src/client/contract/slots.ts`
- `packages/client/ui-chat/src/client/chat/TurnTailNodeView.tsx`
- `packages/client/ui-chat/src/client/chat/ChatNodeSeat.tsx`
- `packages/client/ui-chat/src/client/chat/ChatView.tsx`
- `packages/client/ui-conversation/src/client/skeleton/ConversationRoot.tsx`

## 开发

```powershell
pnpm --filter @dsh-kit/dsh-plugin-chat-scroll build
pnpm --filter @dsh-kit/dsh-plugin-chat-scroll test
pnpm --filter @dsh-kit/dsh-plugin-chat-scroll typecheck
```

浏览器回归：首次打开仍有「加载更早」的历史会话，不滚动、不加载更多，直接点击最后一条回复的「回到消息开头」，确认其开头到达阅读线且有中间滚动位置；再检查短回复、其他回复各自的按钮、切换会话以及「减少动态效果」。手动上滚后点击右下角原生向下箭头，确认有中间滚动位置、最终回到底部，继续生成内容时仍自动跟随；深浅主题与中英文都需验收。

插件改完后必须重启 dsh；当前 `dsh-kit-web` profile 没有 HMR，单纯刷新页面不会重新加载新的浏览器 bundle。

## 分发与管理

本包不作为独立安装项分发，而是 `@dsh-kit/dsh-plugin-conversation-enhancements`（会话增强 Bundle）的组件。停用后，消息开头定位与返回底部按钮消失，回到 dsh 原生滚动行为。
可在该 Bundle 详情中单独停用或重新启用本组件；安装、卸载和升级以整个会话增强 Bundle 为单位。
套件安装后本组件默认启用；后续升级以整个套件为单位，并保留 Bundle 与组件的停用状态；卸载后不会自动补回。
需要重装时，在 dsh「添加插件」中填写套件目录 `plugins/suite` 的绝对目录。
