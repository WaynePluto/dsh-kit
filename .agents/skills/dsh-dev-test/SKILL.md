---
name: dsh-dev-test
description: 启动 dsh-kit 开发实例（隔离 ~/.dsh-dev、端口 3180）配合本地假 LLM 服务做浏览器端 UI 效果验证：当需要在真实 dsh 界面里验证插件浏览器半行为（滚动定位、dock/slot、面板、消息流）、需要带助手消息的可滚动会话而 dev 实例无法配置真实供应商（CLI web 的 settings/mutate 上游缺陷），或用户要求「起 dev 实例 / 假 LLM / 本地跑一下看看效果」时使用。自带 assets/fake-deepseek-server.mjs（Anthropic Messages 协议假服务）与 CDP 探针模板。不适用于宿主半装载层与 RPC 冒烟（用 scripts/*-check.mjs）、单测、桌面实机验收。
---

# dsh-dev-test · dev 实例 + 假 LLM 浏览器端验证

在隔离 dev 实例（`~/.dsh-dev`、profile `dsh-kit-dev`、端口 3180）启动真实 dsh
（版本由仓库依赖钉定，与适配基线一致），
用本 skill 自带的假 LLM 服务生成带助手消息的会话，经 browser-use 驱动 Chrome 做 UI 效果验证。
当需要验证插件浏览器半的真实界面行为（滚动定位、面板、消息流、dock/slot 效果）、
需要带历史消息的可滚动会话而 dev 实例配不了真实供应商，或用户要求「起 dev 实例 / 假 LLM /
本地跑一下看看效果」时使用。不适用于宿主半装载层与 RPC 冒烟（用 `scripts/*-check.mjs`）、
单测、桌面实机验收（那要用户在官方桌面做）。

## 启动链路

1. **假 LLM 服务**（先起，后台任务）：

   ```powershell
   node .agents/skills/dsh-dev-test/assets/fake-deepseek-server.mjs
   ```

   监听 `127.0.0.1:3939`（`FAKE_LLM_PORT` 可覆盖）。实现 Anthropic Messages 协议
   （dsh 的 `llm-deepseek` 传输即此协议），流式 SSE，每次回复约 3200 字符长 markdown
   （多轮即可构造溢出视口的可滚动会话）；stdout 带请求日志（model/轮数/流式/prompt 预览）。

2. **dev 实例**（后台任务）：

   ```bash
   cd <仓库根>
   pnpm start   # 复用现有构建产物
   # 或 pnpm dev —— 先 plugins:build + build-suite 再启动
   ```

   stdout 会打印 `dsh web: http://127.0.0.1:3180/?token=<token>`——token 每次启动都变，
   浏览器导航用最新一条。改了插件代码且要新产物时用 `pnpm dev`，否则 `pnpm start` 更快。

3. **接入假 LLM**：假服务起来后，重启 dev 实例并带环境变量：

   ```bash
   DEEPSEEK_API_KEY=sk-fake-local DEEPSEEK_BASE_URL=http://127.0.0.1:3939 pnpm start
   ```

   **为什么必须走环境变量**：CLI web 形态的 settings/mutate 有上游缺陷
   （「profile reload requires the root Include entry」，dual app-boot 实例致
   bootstrapIncludes miss，见 docs/dsh/plugins.md「设置写入」），UI 上添加供应商/保存
   密钥一律失败且**静默**（表单回显成功、磁盘无写入）。`DEEPSEEK_BASE_URL` 属
   app-boot 的 BOOTSTRAP_NAMES，只接受进程继承环境；环境变量经 `dev-suite.mjs` 的
   `{...process.env}` 原样传给 dsh 子进程。

## 会话构造与发送

- 用 browser-use skill 打开带 token 的 URL，点「新建会话」。
- **composer 是 contenteditable div**（不是 textarea）：`document.execCommand('insertText', ...)`
  写入；**填充与点发送必须分两次 CDP 调用**（同一次调用内 React 状态来不及提交，发送落空）；
  发送后等 10–20 秒让假服务流完，再查 `[data-chat-flow-kind="assistant-step"]` 确认回复到达。
- 发 2–3 条消息即得可滚动会话；假服务按消息条数播种回复，内容不重复。

## 改代码后的生效方式

- **浏览器半**：`pnpm --filter <包名> build` 后**必须** `node scripts/build-suite.mjs`
  ——套件物化是**拷贝不是链接**，不物化则 dev 实例拿到的还是旧 bundle。物化后官方
  client-hmr（500ms stat 轮询）自动热替换，无需刷新页面。
- **宿主半 / 装载层**：重启 dev 实例。

## 关键陷阱

- **Chrome 窗口遮挡 → rAF 冻结**：ZCode 等窗口盖住 Chrome 时 `document.hidden === true`，
  浏览器把 requestAnimationFrame 节流到约 1fps 甚至完全暂停——逐帧滚动动画/守护循环停摆，
  「点击无效」「动画超时」多为假象。验证动画类行为前先读 `document.hidden`；
  隐藏标签页里每次 CDP `js()` 调用可能顺带推进一帧，采样结论不可信。需要真实行为时
  请用户把 Chrome 窗口保持可见（或前一定性验证改用不依赖 rAF 的直接写 scrollTop 观察）。
- **profile 污染**：失败的供应商添加流程会向
  `~/.dsh-dev/profiles/dsh-kit-dev/cordis.patch.yml` 写入杂行（实测出现过
  `- id: llm-deepseek / disabled: true`，导致「no adapter registered for provider
  deepseek-official」）。启动后模型请求报 no adapter / transport failed 时，先检查该文件
  有无异常行，删掉后重启实例。
- **`llm-deepseek` 行被停用的连锁症状**：UI 报 `no adapter registered for provider
  "deepseek-official"`；行恢复后若 SSE 报 `event type mismatch`，是假服务的 data JSON
  缺 `type` 字段（assets 内脚本已修，自写服务时注意）。

## CDP 探针模板（经 browser-use 的 js() 执行）

- **scrollTop 写入探针**（定位滚动写入者）：`Object.getOwnPropertyDescriptor` 从
  `Object.getPrototypeOf(port)` 沿原型链向上找（scrollTop 在 `Element.prototype`，
  不在实例原型）；defineProperty 拦截 setter 记录值 + `new Error().stack`。探针重装前
  先 `delete port.scrollTop` 卸旧实例属性，否则捕获器叠层、日志翻倍。
- **滚动轨迹**：`port.addEventListener('scroll', recorder, {passive: true})` 记录
  `{t, top}`；分析时过滤掉动画自身的匀速段，找「落点后方向反转」的段。
- **console 捕获**：patch `console.warn` 前加 `window.__patched` 守卫，重复 patch 会让
  每条日志出现两次，别误判为双重触发。
- **期望落点**：`Math.round(port.scrollTop + rowRect.top - portRect.top - 24)`；
  断言 `|rowRect.top - portRect.top - 24| <= 3`。

## 收尾

- 停假服务与 dev 实例（后台任务 TaskStop）；browser-use 会话按其规则 `--stop`。
- 会话与工作区数据都在 `~/.dsh-dev`，与真实实例（`~/.dsh`）完全隔离；需要干净环境时
  可整目录删除后重新 `pnpm dev`。dev 实例启动即生成新 token，旧页面要重新导航。
