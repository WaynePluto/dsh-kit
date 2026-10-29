# DSH 增强套件（dsh-kit）

**简体中文** | [English](README.en.md)

对应官方 dsh：`0.2.1-rc.3`（已实测；适配基线与跟进流程见 [docs/02-dsh-facts.md](docs/02-dsh-facts.md)）

官方 DeepSeek Harness（dsh）的第三方**插件套件**：模型、会话、工作区与运行环境四个方向的
个人体验增强，共 26 个组件，通过官方「添加插件」输入**一个地址**即可安装或升级全部内容。

- 不改 dsh、不 fork：扩展全部走官方插件机制（Profile Bundle + 行级停用）
- 不含远程访问能力：没有 relay/connector、没有项目专属数据目录与环境变量
- 套件层不覆写任何官方行：在线启停不会热重启上游服务（决策 D16）

## 组件一览

| 组件 | 使用入口 | 用途 |
|---|---|---|
| [全局提示词](plugins/agents-md/README.md) | 设置 → 全局提示词 | 编辑 dsh 读取的全局 AGENTS.md |
| [出网代理](plugins/proxy/README.md) | 设置 → 代理 | 跟随环境（默认）、使用插件代理地址或强制直连 |
| [Copilot 登录](plugins/copilot-auth/README.md) | 设置 → 模型 → GitHub Copilot | 设备码登录与账号模型同步 |
| [模型目录更新](plugins/models-catalog/README.md) | 设置 → 模型 | 从 models.dev 补充模型目录 |
| [模型能力与协议](plugins/model-capabilities/README.md) | 设置 → 模型 → 展开模型行 | 声明图片支持、推理档位与单模型协议覆盖 |
| [常用模型](plugins/favorite-models/README.md) | 设置 → 模型；聊天模型选择器 | 收藏并筛选常用模型 |
| [模型提供商](plugins/model-provider/README.md) | 聊天输入框 → 模型选择器左侧 | 显示当前模型所属提供商的名称 |
| [DeepSeek 官方 API 开关](plugins/deepseek-official-switch/README.md) | 设置 → 模型 | 移除或恢复内置 DeepSeek（API 密钥）供应商卡片，并提供恢复入口 |
| [失败重试](plugins/turn-retry/README.md) | 输入框上方 | 失败后重试、停止后继续，并保护排队消息 |
| [会话滚动导航](plugins/chat-scroll/README.md) | Agent 消息操作栏、右下角底部按钮 | 消息开头定位与返回底部滚动动效 |
| [会话统计小时档](plugins/stats-hours/README.md) | 输入框上方 → 会话统计 | 模型用时、工具调用用时超过一小时时按小时显示 |
| [用户消息分叉](plugins/user-message-fork/README.md) | 用户消息操作栏 | 从消息之前的历史创建子会话并回填草稿；首轮消息改为新建会话回填 |
| [会话重命名](plugins/session-rename/README.md) | 顶栏 → 双击会话标题 | 双击当前会话标题弹窗重命名（原生入口只在侧栏） |
| [会话工作区显示](plugins/session-workspace/README.md) | 输入框下方 → 统计栏最左 | 显示当前会话的工作区，悬停看完整路径，点击复制 |
| [复制工作区路径](plugins/workspace-path/README.md) | 侧栏 → 工作区 `···` 菜单 | 菜单新增「复制路径」，一键复制工作区完整目录路径 |
| [收起全部工作区](plugins/workspace-collapse/README.md) | 侧栏 → 工作区标题栏 | 一键收起下方所有工作区分组 |
| [任务通知](plugins/notify/README.md) | 设置 → 通知 | 在运行 dsh 的 Windows 桌面提醒任务完成或等待输入 |
| [侧栏面板行回会话](plugins/panel-toggle/README.md) | 侧栏 → 面板行（插件/自动化任务/服务） | 再点一次高亮的面板行即返回当前会话（原生只能无效重选） |
| [切屏停靠](plugins/session-park/README.md) | 切屏离开时自动 | 离开时把运行中的会话让位给空白会话，结束后侧栏亮「完成未读」绿点 |
| [工具状态](plugins/tools-inspector/README.md) | 会话 → 工具 | 查看可见工具及历史调用、失败次数 |
| [技能状态](plugins/skills-inspector/README.md) | 会话 → 技能 | 查看技能来源与会话加载历史 |
| [文件浏览](plugins/files/README.md) | 右侧 Sidebar → 文件 | 原生文件树增强、Git 状态、图片预览与目录右键菜单 |
| [常驻服务](plugins/services/README.md) | 模型工具；侧边栏「服务」面板 | 管理有名字、可跨会话存活的服务 |
| [交互终端](plugins/terminal/README.md) | 模型工具；输入框上方 | 由用户直接输入密码、MFA 等交互内容 |
| [网页搜索开关](plugins/web-search-switch/README.md) | 插件 → 网页搜索开关 | 关闭或恢复 dsh 官方网页搜索插件 |
| [套件更新](plugins/suite-updates/README.md) | 插件 → 套件 → 套件更新 | 检查 dsh-kit 新版本，一键复制升级地址 |

分组、顺序与停用粒度见 [插件索引](docs/plugins.md) 与根目录 [plugin-catalog.json](plugin-catalog.json)。

## 安装

dsh → 插件 → 添加插件 → 输入下面的下载地址 → 安装 → 启用 → 重启 dsh。

**GitHub 安装（推荐，无需克隆仓库）**

```text
https://github.com/WaynePluto/dsh-kit/releases/download/v0.0.1/dsh-kit.tar.gz
```

地址形如 `releases/download/<tag>/dsh-kit.tar.gz`，**每次发新版会更新上面的 tag**；
首次安装与升级用同一种地址。升级不需要卸载：把新版的地址粘进「添加插件」即原地
替换并在线热生效（同一地址重复输入会被官方管理器拒绝，tag 变化即地址变化）。装好
之后也可以在插件页「套件」详情页的**套件更新**区一键检查新版本、自动复制升级地址。
注意：裸仓库地址（`https://github.com/WaynePluto/dsh-kit`）不可用——pnpm 会把它当
git 依赖重打包，剥掉套件自带的依赖闭包；只认上面的 Release 资产地址。

**本地目录安装（开发/离线）**

```powershell
git clone https://github.com/WaynePluto/dsh-kit.git
cd dsh-kit
pnpm install
pnpm plugins:build
pnpm suite:build      # 生成套件 patch 并物化依赖闭包
```

然后在「添加插件」里输入 `plugins/suite` 目录的**绝对路径**（例如
`D:\Documents\ai-dev\dsh-kit\plugins\suite`）。

**通用说明**

- 重启是生效的必要步骤：在安装前就启动的 dsh 里点「启用」，组件行会整包延迟到重启
  装载（可解析性守卫，不会报 failed to import）；个别机器上首次启用还可能报一条
  session-controller 的重挂载竞态（dsh 上游已知，见 [roadmap](docs/05-roadmap.md)），
  同样重启即恢复。
- 套件不经过 npm：组件不发布 registry，GitHub 安装全程只从本仓库的 Release 下载。

装完之后套件就是一个普通第三方 Bundle：插件页可以停用整个套件，也可以在套件详情里
单独停用某个组件；卸载后不会自动补回，重新安装同样走「添加插件」。

## 数据与配置

- 不写项目专属数据目录，也不注入环境变量；所有配置存在 dsh 自己的 profile 与 settings 里。
- 通知、代理、模型目录等插件各自的作用范围见对应包 README。

## 开发

```powershell
pnpm install
pnpm lint && pnpm build && pnpm typecheck && pnpm test && pnpm check:dependencies
pnpm plugins:build && pnpm suite:build      # 插件产物 + 套件 patch/闭包
pnpm dev                                    # 隔离开发实例：profile dsh-kit-dev、端口 3180
```

`pnpm dev` 使用 `~/.dsh-dev` 作为 DSH_HOME，与日常实例互不影响；改动插件任何一半后
都要重新构建并重启 dsh（套件所在 profile 没有 HMR，刷新页面不会更新产物）。
各主题的检查脚本入口见 [源码依据](docs/02-dsh-facts.md)。

## 文档

| 文档 | 内容 |
|---|---|
| [需求与决策](docs/01-decisions.md) | 产品边界、术语与全部决策 |
| [架构](docs/03-architecture.md) | 组件划分、装载方式与依赖 |
| [当前进度](docs/05-roadmap.md) | 已实现能力、实机验收清单与下一步 |
| [插件索引](docs/plugins.md) | 组件功能、入口与分发组合 |
| [dsh 契约](docs/dsh/) | 上游源码核对结论（插件机制、模型、会话、运行时、工作区） |

模块结构见 [ARCHITECTURE.md](ARCHITECTURE.md)。
