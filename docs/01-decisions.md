# 01 · 需求与决策

## 1. 产品目标

给官方 DeepSeek Harness（dsh）加一组个人体验优化插件：模型、会话、工作区与运行环境四个方向，
用一个套件包一条路径安装。dsh 仍是唯一宿主，负责 Agent、工具、会话与全部界面；
本项目只提供插件，不提供宿主、不提供远程访问，也不持有自己的运行时数据。

## 2. 已确认的决策

| 编号 | 决策 | 依据 |
|---|---|---|
| D1 | 使用官方 dsh 运行时，不修改或 fork dsh 源码 | 扩展通过官方插件机制完成，升级时核对上游契约（见 [源码依据](02-dsh-facts.md)） |
| D2 | 项目名 dsh-kit（用户文案「DSH 增强套件」），包 scope `@dsh-kit/*` | `kit` 描述「成套的增强插件」，不暗示宿主或远程能力；改名为一次性事件，不保留旧名的运行时迁移，旧套件卸载重装即可 |
| D3 | 分发只有套件单包 `@dsh-kit/dsh-plugin-suite`：官方「添加插件」输入一条路径安装/升级/卸载 | 免掉 launcher 式的外部安装与介质同步；套件自带物化依赖闭包，本地目录安装是 `link:` 语义也能自洽 |
| D4 | 组合包（model-enhancements、conversation-enhancements、development-tools）是安装与停用单位，组件保留独立稳定行 id 并可单独停用 | 与 dsh 官方组合 Bundle 约定一致；行 id 必须跨重组稳定，否则 Profile HMR 会把匿名行当新条目重复 import |
| D5 | models-catalog 与 model-capabilities 共同构成 `llm-pi-ai` 启动屏障，不可只停一行 | 两者的 bootstrap 服务被 `llm-pi-ai` 行注入；只停一个会让屏障解析失败 |
| D6 | 套件 patch 固定 `llm-pi-ai` 屏障行与模型屏障占位行 | 模型组件随进程启动时写真实屏障，未启动时由占位行兜底，使在线启停模型组件不热重启 `llm-pi-ai`；生成逻辑只在 `scripts/build-suite.mjs` |
| D7 | 无项目专属数据目录、环境变量与 profile | 配置存在 dsh 自己的 profile 与 settings；插件卸载即无残留 |
| D8 | 开发栈与冒烟使用隔离环境：`~/.dsh-dev`、profile `dsh-kit-dev`、端口 3180 | 与日常实例互不影响；冒烟脚本从该 profile 复制隔离副本后启动真实 dsh |
| D9 | 所有直接依赖固定版本，不使用范围、dist-tag 或隐式升级 | `pnpm check:dependencies` 覆盖 `packages/` 与 `plugins/`；dsh 家族版本由根 `pnpm.overrides` 统一钉住 |
| D10 | 固定 YOLO：danger-full-access + ask，合法 approval 自动 allowed-once，用户提问不自动回答 | 取消模型执行前的交互式权限边界是明确选择，风险与替代防线见 [yolo-mode README](../plugins/yolo-mode/README.md) |
| D11 | 展示壳微包（model-bootstrap、preset-concise）承载裸包名行的中文元数据 | 插件管理器只为裸包名行解析 locale meta；相对路径行会退化成完整文件 URL，官方包只有英文 |
| D12 | 远程访问能力已整体删除（2026-10-10）：relay/connector/protocol、remote-* 组件与相关脚本文档全部移除 | 远程能力实际使用频率低，项目收敛为纯插件套件；最后一次可用状态存档在 git tag `dsh-remote-final`，将来需要时重新评估而不是直接恢复旧代码 |
| D14 | 简洁预设的频道选择默认直呼工具：`run-code:guidance` 前置于工具指引与 `tools:sdk`，单个工具调用禁止包成程序 | both 展示模式下「可以写程序」会被模型读成「应该写程序」：真实会话 100 次顶层调用里 96 次 run_code，其中 20% 的程序只调一个工具、没有任何收益。位置对齐 dsh 自己的 `tools:ptc-only`（规则必须早于工具指引），措辞由同一提示词与同一模型的真机 A/B 确定（单工具任务 3/3 直呼、三个独立 shell 检查 3/3 写程序） |
| D15 | 移除内置 DeepSeek（API 密钥）卡片 = 经官方 pluginManager 停用 base bundle 的 `llm-deepseek` 行；恢复入口放模型页底部 footer 槽 | `deepseek-official` 是整段供应商（settingsPath 为空），dsh 原生删除只覆盖用户层配置条目，卡片无法经设置消失；停用行是让路由与卡片消失的唯一官方途径（web-search-switch 同款机制，2026-10-13 用户确认）。恢复入口必须独立于被移除的卡片，footer 槽（models-catalog 先例）在行停用后仍渲染。不动 `DEEPSEEK_API_KEY` 凭据与 `llm-deepseek-account` 行：账号卡与官方网页搜索（独立注册搜索 provider）不受影响；目录采纳的第三方 `deepseek`（`llm-pi-ai` 行注册）与本开关无关 |
| D13 | 简洁模式的提示词范围由预设作用域内的嵌套行 `prompt-filter` 按名摘除 dsh 部署级 section 决定，不用 persona 的 `complete: true` | 用户预期是「极简模式那一句 + 常用工具」；`complete: false` 只替换 persona 槽位、部署级段落一条也过滤不掉，`complete: true` 会把 `tools:sdk` 与工具指引一起滤掉（run_code 失去 `tools.*` 声明）。dsh 的 `system-prompt/assemble` 按作用域路由（`scopeTarget` 祖先准入），预设作用域的监听器只能影响本预设的 agent |

## 3. 术语

| 概念 | 用户可见名称 |
|---|---|
| 整个分发包 | 套件（`@dsh-kit/dsh-plugin-suite`） |
| 组合分发单位 | 组合包（模型增强、会话增强、开发工具） |
| 组合包内的单行插件 | 组件 |
| 关闭某个组件行 | 停用组件 |
| 预设 `config.plugins` 内联的子插件行（如 run-code、prompt-filter） | 嵌套行组件（没有自己的 profile 行） |
| 取消某个组合包 | 停用/卸载 Bundle |
| dsh 的 Profile Bundle 机制 | 官方插件机制 |

代码标识符保持英文原名（`bundle`、`row`、`patch`、`pluginManager` 等），
中文文案只用于标题、说明与按钮。

## 4. 历史沿革

项目经历过三个阶段，细节见 [更新日志](changelog/)：

1. **独立工作站**：自带桌面壳、relay/connector 隧道、四端发行介质（已删除）。
2. **远程插件套件**：转为官方 dsh 的第三方套件，项目名 dsh-remote（2026-10-09）。
3. **纯增强套件**：删除全部远程能力，定名 dsh-kit（2026-10-10，本文件 D2、D12）。

旧阶段的数据目录（`~/.dsh-station`、`~/.dsh-remote`）与旧套件安装不提供迁移路径：
删掉目录、卸载旧套件、安装新套件即可。

## 5. 持续关注

- dsh 升级可能改变插件契约，按 [源码依据](02-dsh-facts.md) 与各插件检查脚本复核。
- 固定 YOLO 取消了执行前的交互式权限边界，请在理解风险的前提下使用。
- 插件界面与主题必须同时验收深浅主题；新样式经验回流到 `dsh-theme` skill。
