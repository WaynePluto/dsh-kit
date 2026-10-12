---
name: dsh-upgrade
description: 官方 dsh 发布新版本时的插件适配检查。核对上游契约变化（槽位授权、菜单面材质、index 注入、RPC 通道、客户端模块表、预设与模型屏障）、把项目适配基线（类型/开发栈钉住的 @deepseek-ai 版本）推进到新版本、评估原生新能力对插件的替代（清理/精简/保留）、官方桌面实机验证并回写适配基线。当官方 dsh 出新版本、用户要求检查插件对某版本的适配或把项目跟进到某个 dsh 版本时使用。不适用于与 dsh 版本无关的普通依赖升级（项目依赖固定不动，另行决策）。
---

# dsh-upgrade

本文仓库路径均相对仓库根（本技能目录向上三级），命令在仓库根执行。
用户仅要求检查或评估时，只报告结论，不改版本号、不装不删；以下实施步骤用于已授权的适配任务。

官方 dsh（桌面版/web 版）是唯一宿主，本项目**没有可升级的 dsh 运行时依赖**——
生产宿主版本由用户安装的官方应用决定。本技能做三件事：

1. **契约核对**：对照新版本源码，逐条确认套件插件依赖的上游行为「变 / 没变」；
2. **基线推进**：把项目钉住的 `@deepseek-ai/*` 类型与开发栈版本同步到新版本并重装；
3. **适配与清理**：修复破坏的插件、按原生新能力评估组件的替代/精简/保留。

## 适配基线（单一记录，技能维护）

- **人类可读**：`docs/02-dsh-facts.md` 开头的「当前插件适配基线」行——dsh 版本、git 短哈希、
  实机验证过的官方宿主版本与日期。每次适配完成后回写本行。
- **机器侧三处**（必须同步改，缺一就是假基线）：
  - 根 `package.json` 的 `pnpm.overrides` 全表 `@deepseek-ai/*`；
  - `scripts/dev-suite.mjs` 的 `DSH_VERSION`（隔离开发栈安装的官方 base/web-app）；
  - 各插件 `package.json` devDependencies 里的 `@deepseek-ai/dsh-client-*` 等类型包，
    以及 `@earendil-works/pi-ai`、`@deepseek-ai/dsh-llm`（copilot-auth / turn-retry 对齐用）。

## 步骤

### 1. 查新版本

```powershell
npm view @deepseek-ai/dsh dist-tags --json
npm view @deepseek-ai/dsh versions --json
```

与基线行比较。口径：以 npm 实际可安装版本为准；**alpha 视为高风险**，第 2 步逐条做完并把结论
交用户确认后才动手（rc 可直接推进）。无新版本时报告「已是最新」并结束。

### 2. 契约核对（必做，不要直接改版本号）

加载 skill `dsh-source`，把本地 checkout 切到目标 tag（保留其版本核对规则），
读 `docs/02-dsh-facts.md` 与 `docs/dsh/` 对应主题，逐条给出「变 / 没变」：

- **套件 patch 契约**：`plugins/suite/cordis.patch.yml` 的两个固定段落（`llm-pi-ai` 行注入
  `modelsCatalogBootstrap`/`modelCapabilitiesBootstrap`、模型屏障占位行）、insert 成员的
  `disabled: !!js` 表达式、`!!js` 标量 tag 限制（裸数组会被安装期校验拒绝）、
  裸包名相对 Bundle 安装目录解析的规则，以及 `scripts/build-suite.mjs` 的物化前提
  （`@deepseek-ai/*` 跳过、其余 registry 闭包复制）
- **组合包与行 id**：官方组合 Bundle 的 `disabled` 表达式约定、行 id 稳定性要求、
  `dsh.profile.bundles` 与 profile patch `disabled` 的区别
- **locale meta**：`locale/{en,zh}.json` 的 `meta.title/description` 解析规则
  （只有裸包名行能拿到元数据）
- **槽位契约**（0.2.0 已吃过亏，见 `docs/dsh/plugins.md`）：声明 children 的座位条目才拿
  renderSlot/SessionProvider、重复声明 child slot 抛错、同 cell priority 影子规则、
  `settings.section` 导航原始投影例外、`MenuSurface` 半透明磨砂面（禁止自绘 specific-menu 背景）、
  dock 与图标约定
- **客户端模块系统**：`dsh.client` 声明、平台 external 基线（react / react-dom/client / cordis）、
  combo 路由 `/plugins/??…`、`__DSH_BOOT__` 图组成与首扫语义
- **RPC 通道**：`ctx.connection.rpc.handle/call` 契约（`/files`、`/services` 等私有通道）
- **index 注入契约**：`IndexInjection` 的 kind/placement 取值与
  `__DSH_TRANSPORT__` 的壳语义（当前没有组件使用，仍需在升级时确认未破坏）
- **预设与模型**：`@deepseek-ai/dsh-agent-preset` 行内联、run-code 双通道行、`llm-pi-ai` 启动屏障、
  `settings.models.*` 子槽
- **会话契约**：turn-retry 依赖的 `TurnEndReasonMap`、`sessionProjections.register` wire 契约、
  `Agent.inbox.nextTurn`、`followup()` 语义（升级后必跑排队消息回归）
- **官方「添加插件」安装器**：patch 校验时机、bundle 列表语义、安装/升级两条路径
  （本地 link: 与 git 地址）的解析差异

结论回写 `docs/dsh/` 对应主题，标清目标版本与未验证项；不改 dsh 源码、不 fork（铁律 1）。

### 3. 基线推进与重装

改「机器侧三处」版本 → 删 `pnpm-lock.yaml` 与**全部** `node_modules`（根 + packages/* + plugins/*，
hoisted 下旧 peer 解析会存活）→ `pnpm install` → `pnpm check:dependencies`。

dsh 子包互为 peerDependencies，预发布轨道下 pnpm 自动装 peer 会解析到旧 `latest`，出现多版本共存即
`启动即报 does not provide an export named ...`；overrides 全表 + 删 lockfile 重装是修法。
`nodeLinker: hoisted` 是 profile fallback 前提，不要改 isolated。

### 4. 插件重复性评估（每次必做）

以 `plugin-catalog.json` 与 `plugins/` 实际目录交叉核对，逐组件对照目标版本源码列
原生对应能力、覆盖范围、剩余差异与证据；同名功能不等于覆盖，无法确认标证据不足。
不能只看 changelog 提到的功能，也要识别原生此前已有、现在完善的能力。此步只做初评。

### 5. 适配修复与清理

| 结果 | 处理 |
|---|---|
| 原生完整覆盖，替代验证通过 | 普通功能组件直接完整清理（源码/测试/专属 check 脚本/catalog/locale/文档），不保留空壳 |
| 部分覆盖或有意义的行为差异 | 列出覆盖、独有、删除影响与方案，由用户决定 |
| 无重叠 | 保留，修复适配 |
| 证据不足 | 保留并列待验证项，不得删除 |

替代验证必须用目标版本实际产物在隔离 profile 确认模块表不含候选组件后做功能场景验证；
UI 涉及真实浏览器与深浅主题。套件级固定契约（`llm-pi-ai` 屏障行、模型屏障占位行、
display 壳微包）与构建链改动必须先提方案由用户决定。清理后搜索包名/目录/中英文功能名/样式标记残留，
并重新执行 `pnpm suite:build` 让套件 patch 与闭包跟上。

### 6. 验证（必做）

```powershell
pnpm check:dependencies
pnpm lint
pnpm typecheck
pnpm build
pnpm test
pnpm plugins:build
pnpm suite:build
```

- 隔离开发栈：`pnpm dev`（profile `dsh-kit-dev`、端口 3180），按 `docs/02-dsh-facts.md`
  升级检查表跑各组件 check 脚本；
- **官方桌面实机**（适配的最终口径，静态检查不能替代）：重启官方桌面 →
  `node scripts/verify-suite-client.mjs --token <宿主打印的 token>`（套件浏览器行完整性）→
  带举 `ELECTRON_ENABLE_LOGGING=1` 抓渲染期 `slot entry crashed` / TypeError →
  按 `docs/05-roadmap.md` 插件实机验收表点检核心场景（含深浅主题）。

### 7. 常设关注：套件在线启停的上游竞态

dsh 0.2.0 仍存在 session-controller 重挂载竞态（停用 Bundle 触发 file-upload 的 Agent resolver
二次注册失败）。套件整包停用/启用会经过这条路径；`scripts/concise-mode-check.mjs` 命中时
只允许按精确签名豁免，其他失败照常响亮报错。上游修复后删除豁免并回写
`docs/05-roadmap.md` 的后续任务。

### 8. 常设关注：原生能力替代插件

新版本里出现与现有组件重叠的原生能力（模型目录、通知、目录选择、会话增强等）时，
按第 4、5 步评估替代与精简，但「原生已有」不等于「可直接删除」：要看覆盖范围、
行为差异与用户体验，结论交用户决定。

### 9. 新能力吸收建议

新版本对插件开发有用的接口变化、审批/权限模型变化、部分覆盖插件的精简方案，
整理成推荐列表（能力、缺口、影响面、推荐方案）交用户决定；未确认前不开工。

## 完成后

向用户汇报：旧 → 新版本、契约核对逐条结论、基线三处同步情况、逐组件重复性评估结论
（覆盖证据/清理项/保留理由/待决项）、实机验证结果（开发栈 + 官方桌面），并确认
`docs/02-dsh-facts.md` 基线行已回写。汇报在对话中给出，不生成历史文件。
