# AGENTS.md

适用于本仓库中的 AI 编码助手。本项目 dsh-kit（用户文案「DSH 增强套件」）是官方
DeepSeek Harness (dsh) 的第三方插件套件：通过官方「添加插件」输入一条路径安装 19 个
功能组件，扩展只走官方插件机制，不含远程访问能力。

## 开始前

1. 读 [当前进度](docs/05-roadmap.md)，确认本次任务与待验收项。
2. 读 [决策](docs/01-decisions.md)，遵守现行产品边界与术语。
3. 涉及 dsh 行为先读 [源码依据索引](docs/02-dsh-facts.md) 对应主题；查上游源码前加载 dsh-source skill。
   dsh 本地路径只记在 [.agents/skills/dsh-source/SKILL.md](.agents/skills/dsh-source/SKILL.md)。

## 铁律

- 不修改或 fork dsh 源码，扩展只能写插件。
- 唯一分发路径是套件单包：`plugins/suite` 经官方「添加插件」安装/升级；不实现第二套插件管理器，
  不做 launcher 式的外部安装、介质同步或进程编排。
- 插件一律是受管 Profile Bundle：包根 `cordis.patch.yml` 声明行，宿主入口 `./dist/index.js`，
  浏览器半声明 `dsh.client` 并产出 `dist/client.js`；`pnpm plugins:build` 与 `pnpm suite:build`
  都要检查两半产物，缺失即响亮失败。
- 不写项目专属数据目录、不注入环境变量；配置存在 dsh 自己的 profile 与 settings。
- 插件不能 append 自定义 Session 事件，否则持久化加载会拒绝会话；projection 只折叠已知事件，
  无关事件返回同一引用。工具/技能历史使用 snapshotEvents，查询 scope 必须传 live Agent。
- 设置写入走插件行 volatile Config：宿主半 loader/volatile-update + internal/config 校验钩子，
  浏览器半 configForms；mutate/set/unset 返回 boolean，false 即宿主拒绝。两半共享校验，
  失败保留草稿并就地报错（契约见 [插件机制](docs/dsh/plugins.md)）。
- 组合包（model-enhancements、conversation-enhancements、development-tools）是安装与停用单位，
  组件保留跨重组稳定且全局唯一的行 id；models-catalog 与 model-capabilities 共同构成
  `llm-pi-ai` 启动屏障，不可只停一行。
- 套件 patch 里的 `llm-pi-ai` 屏障行、connection 行覆写（`inject` 扩 webServer 并复刻官方
  `trustedHosts` config）与模型屏障占位行是固定契约：模型组件随进程启动时写真实屏障，
  未启动时由占位行兜底，使在线启停模型组件不热重启 `llm-pi-ai`；宿主半 RPC 通道归属
  connection 行 fiber，必须由该覆写注入 webServer。占位行以套件包子路径
  `@dsh-kit/dsh-plugin-suite/fallback` 装载（实现内嵌套件包 `fallback/`，exports 重映射到
  入口与 locale），保证冷启动、git 安装与运行中首次启用都可解析、屏障当场有服务可绑。
  生成逻辑只在 `scripts/build-suite.mjs`，patch 本身是生成物，不手改。
- 全部功能组件在套件内以裸包名 + `disabled` 表达式装载：套件离开
  `dsh.profile.bundles` 时全部组件行一并禁用；insert 子行的表达式另带可解析性守卫——
  运行中首次启用套件时 dsh 的 runtime resolution 表还是安装前的快照，守卫（与 loader 同一
  baseUrl 的 createRequire 探测组件包）探测不到就整行禁用、延迟到重启装载，不产生
  failed to import 报错（守卫只用于 insert 子行，顶层覆写行的 disabled 会连官方基础行一起
  整行禁用，禁止加守卫）。组件包不能依赖套件当前在工作区里存在。守卫契约由
  `plugins/suite/tests/suite-patch.spec.mjs` 与 `scripts/suite-first-enable-check.mjs`（真实
  dsh 在线启用冒烟）守护。
- yolo-mode 默认停用：安装后原生权限保持原样，只有 profile patch 显式启用行（行开关写入，
  流式形态）才整体生效；sandbox-policy/approval 用 config 条件回退官方默认（覆写行 disabled
  会连官方基础行一起整行禁用，禁止再犯），permission/ui-permission 镜像禁用，插件行取反。
  行开关或套件关闭并重启后原生权限控制必须完整恢复。启用后固定 danger-full-access + ask，
  合法 approval 自动 allowed-once，用户提问不自动回答；schema 与执行/展示参数都过滤提权字段；
  升级运行 yolo-mode-check（覆盖独立 Bundle 与套件两形态），任何契约变化必须响亮失败。
- services 在沙箱外 spawn，受限模式 start/restart 必须批准；终端沿用 dsh PTY 沙箱。
  interactive_terminal 只用于预期用户直接输入，普通 Git、构建、测试和长任务用 pwsh/bash；
  Linux sudo 管理任务的命令统一走交互终端，可在同一终端内复用系统缓存，但不建立持续 root shell。
- Windows 杀进程树用 taskkill /T /F；常驻服务用两级启动器并记录 L2 pid，不以 detached:true 保证存活。
- 全局提示词只保存 DSH_HOME/AGENTS.md，UTF-8 字节上限 1 MiB、原子写入，冒烟由 dsh 加载器反向认领。
- files 插件的 Git 根只取 live session.header.cwd，Git 采集无 shell 且有界；文件树、读取与预览跟随
  dsh 原生 workspaceFiles/UI，目录右键只复制绝对/相对路径；不增写入接口、不递归预扫、不挂 watcher、
  不引第二套预览编辑器。
- 所有直接依赖固定版本，不使用范围、dist-tag 或隐式升级；`pnpm check:dependencies` 覆盖
  `packages/` 与 `plugins/`。

## 环境与检查

Windows，PowerShell 7；使用 PowerShell 语法。Node 最低 22.19.0，本地 pnpm 使用已安装版本，
CI 固定 10.17.0。TypeScript + ESM + pnpm workspace，构建 tsdown，开发 tsx，测试 Vitest。
技术选型见 [架构](docs/03-architecture.md)，不要随意替换。项目模块架构见
[ARCHITECTURE.md](ARCHITECTURE.md)；修改模块结构后请更新该文件。

常用检查：`pnpm check:dependencies`、`pnpm lint`、`pnpm typecheck`、`pnpm build`、`pnpm test`；
插件产物与套件产物：`pnpm plugins:build`、`pnpm suite:build`。

官方 dsh 新版本的插件适配检查加载 dsh-upgrade skill（适配基线记录在 docs/02-dsh-facts.md 开头）；
其余依赖固定不动，升级另行决策。提交前钩子检查固定版本并清理 lockfile 内部镜像 tarball 地址。

## 按任务阅读

| 改动 | 必须阅读 | 关键约束 |
|---|---|---|
| 插件装载、设置、界面 | [插件机制](docs/dsh/plugins.md) | mutate 返回 boolean（false 即拒绝），失败保留草稿；同 cell 同 priority 冲突；primitives external |
| 模型与代理 | [模型](docs/dsh/models.md) | 保留用户条目、只清理插件溯源；混合协议先恢复同一 pi-ai map；代理唯一配置源 |
| 重试、滚动、分叉、通知 | [会话](docs/dsh/conversation.md) | 保护 nextTurn 队列；不移动 React DOM；保持 turn-tail 最后；idle 去抖 |
| 权限、服务、PTY、工具统计 | [运行时](docs/dsh/runtime.md) | 不 append 自定义事件；统计回放历史；进程身份复核；交互终端仅用于人类输入 |
| 技能、提示词、文件浏览 | [工作区](docs/dsh/workspace.md) | scope/cwd 来自 live Agent；有界读取；只读视图不改变模型能力 |

插件功能与入口见 [插件索引](docs/plugins.md)，具体实现前读对应包 README。

## 界面约束

编写或调整 dsh UI/CSS/主题样式前，必须加载 [dsh-theme skill](.agents/skills/dsh-theme/SKILL.md)。
任务收尾时自动将本次已验证、可复用的新样式经验合并回该技能（无需用户再次提醒）；
有新上游契约同步更新 docs/dsh/plugins.md，不记录未经验证的猜测或重复流水账。

任何图标文字对齐先加载 flex-centering skill。dock 必须沿用 dsh todo 风格：specific-tip 背景、
0.5px border-l1、12px 圆角、13px 标题、原生 outline 图标、整行 button 与 aria-expanded、共享宽度轴。
表头嵌套 flex，图标必要时 translateY(0.115em)，摘要省略号在内层 span。
箭头收起用 IconChevronUpOutlineMedium，展开用 IconChevronDownOutlineMedium（dsh 0.1.7 起数字后缀改为 Medium/Regular），不用文本箭头。
services 与 terminal 共用 IconApiOutlineMedium。

深浅主题都验收；border-l1 的 l 是字母，浅色 bg-layer-1/2/3 都为白，font-mono 要完整 fallback 栈。

## 文档与运行

- 插件使用说明放包根 README，[插件索引](docs/plugins.md) 做导航；源码契约按 docs/dsh 的主题归属维护。
- docs 每个文件最多 600 行，只保留现行行为与明确待办，不追加旧方案或调试过程。
- 修改插件任何一半后都要构建并重启 dsh，套件所在 profile 没有 HMR，刷新页面不会更新产物。
- 上游源码引用使用相对 dsh 根路径，不在其他文件记录本地绝对路径。
- 未记录的架构决策先向用户确认，不猜 dsh 行为。
