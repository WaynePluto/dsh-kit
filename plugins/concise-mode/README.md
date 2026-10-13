# 简洁模式

`@dsh-kit/dsh-plugin-concise-mode`   `dsh-kit-web` 供供简洁 Agent 预设。
新建会话时选择对应预设即可使用，不影响官方 `web` profile。

## 预设

| 预设 | 工具调用方式 |
|---|---|
| `concise` | 原生工具照常直呼；同时供供 `run_code`，模型可写 TypeScript 程序组合调用工具，由模型自主选择 |

预设提供 persona 提示词、文件读写与搜索、技能、当前平台 shell、前台一次性子代理、用户提问、待办和上下文压缩。
它继承 profile 中的常驻服务与交互终端工具；不包含计划文件、后台任务管理、工作流或网页搜索工具。
普通 shell 与子代理调用不供供后台执行，常驻服务使用 `service_*`。
子代理深度继承 dsh 原生设置（默认 1，可由用户调整）；本预设不单独指定深度。

`run_code` 双通道由嵌套行 `run-code`（`@dsh-kit/dsh-plugin-run-code`，作 本分发包组件
随包供供）声明  both 展示模式：默认直呼工具，只有一步内需要多次调用（参考 pi 的 codemode：
批量并发、链式依赖、大结果过滤）才写程序，单个工具调用不包成程序。PTC 的规则、SDK、执行器和 UI 均复用 dsh。
工具状态页只统计顶层调用，一次 `run_code` 程序显示 一次调用，不展开计算内部子调用次数。
旧的 `concise-ptc` 预设已删除；已有会话请改选「简洁模式」。

## 提示词构成

简洁会话的系统提示词只有三个来源：persona 那一句（dsh 原生「极简模式」那句
`You are a helpful software engineer assistant.`，其后追加英文思考指引
`When you thought, thought in ENGLISH, start with "We need.."`）、各工具行注册的工具指引、
以及 `run_code` 的 `tools:sdk` 声明与使用指引。dsh 在部署层注册的段落（`harness:identity`、`context:file-reference`、
`ui:deliverable-file-references`、`harness:source`、`app:web-surface`）由嵌套行 `prompt-filter`
（`@dsh-kit/dsh-plugin-prompt-filter`）在预设作用域里按名摘除，清单即该行的 `dropSections`。

persona 的 `complete` 开关表达不了这个范围：`complete: false` 只替换 persona 槽位，部署级段落一条
也过滤不掉；`complete: true` 会把整个提示词覆盖成那一句，连 `tools:sdk` 一起滤掉（run_code 就看不到
`tools.*` 声明）。`node scripts/concise-mode-check.mjs` 断言最终段落集合，以及无作用域的部署组装
不受影响；section 名是 dsh 契约，升级 dsh 时必须复核。

## 装载、分发与限制

本包是可单独停用、卸载和升级的独立 Profile Bundle，放在 `@deepseek-ai/dsh-web-app` 后，不使用普通插件的末尾 overlay。
套件安装后本插件默认启用；后续升级以整个套件 单位并保留停用状态，卸载后不会自动补回。
需要重装时，在 dsh「添加插件」中填写套件目录 `plugins/suite` 的绝对目录。
Bundle patch 通过 profile 根的 `baseUrl` 创建 `require`，解析当前已安装包的 `package.json` 后定位 presets；
不再加载额外 locator entry，因此在线停用时不会因 HMR 重导入即将移除的模块而失败，发行包仍可移动目录。

persona 必须使用 `complete: false`（否则 dsh 生成的 PTC SDK 声明会被完整 persona 过滤，
模型不知道 `tools.*` 绑定），并使用 `includeRuntimeContext: false`。权限仍由 profile 的固定 YOLO 插件决定。

## 验证

```powershell
pnpm --filter @dsh-kit/dsh-plugin-concise-mode test
node scripts/concise-mode-check.mjs
```

修改后必须重启 dsh。源码依据见 [dsh 核实结论](../../docs/02-dsh-facts.md)。
