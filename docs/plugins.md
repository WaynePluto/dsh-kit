# 插件索引

功能、使用入口和限制写在各插件包根的 README；本页负责导航与分发组合。
实现依据见 [dsh 源码依据](02-dsh-facts.md)，装载方式见 [架构](03-architecture.md)。

## 设置与模型

| 插件 | 使用入口 | 用途 |
|---|---|---|
| [全局提示词](../plugins/agents-md/README.md) | 设置 → 全局提示词 | 编辑 dsh 读取的全局 AGENTS.md |
| [出网代理](../plugins/proxy/README.md) | 设置 → 代理 | 跟随环境（默认）、使用插件代理地址或强制直连；覆盖原生 fetch 和官方网页抓取，不保证接管子进程或独立网络库 |
| [Copilot 登录](../plugins/copilot-auth/README.md) | 设置 → 模型 → GitHub Copilot | 设备码登录与账号模型同步 |
| [模型目录更新](../plugins/models-catalog/README.md) | 设置 → 模型 | 从 models.dev 补充模型目录 |
| [模型能力与协议](../plugins/model-capabilities/README.md) | 设置 → 模型 → 展开模型行 | 声明图片支持、推理档位与单模型协议覆盖 |
| [常用模型](../plugins/favorite-models/README.md) | 设置 → 模型；聊天模型选择器 | 收藏并筛选常用模型 |
| [模型提供商](../plugins/model-provider/README.md) | 聊天输入框 → 模型选择器左侧 | 显示当前模型所属提供商的名称 |
| [DeepSeek 官方 API 开关](../plugins/deepseek-official-switch/README.md) | 设置 → 模型；底部恢复入口 | 移除或恢复内置 DeepSeek（API 密钥）供应商卡片（官方页面不给整段供应商删除） |

## 会话与工作区

| 插件 | 使用入口 | 用途 |
|---|---|---|
| [失败重试](../plugins/turn-retry/README.md) | 输入框上方 | 失败后重试、停止后继续，并保护排队消息 |
| [会话滚动导航](../plugins/chat-scroll/README.md) | Agent 消息操作栏、右下角底部按钮 | 消息开头定位与返回底部滚动动效 |
| [会话统计小时档](../plugins/stats-hours/README.md) | 输入框上方 → 会话统计 | 模型用时、工具调用用时超过一小时时按小时显示 |
| [用户消息分叉](../plugins/user-message-fork/README.md) | 用户消息操作栏 | 从消息之前的历史创建子会话并回填草稿；首轮消息改为新建会话回填 |
| [会话重命名](../plugins/session-rename/README.md) | 顶栏 → 双击会话标题 | 双击对话顶栏的当前会话标题，弹窗重命名（原生入口只在侧栏） |
| [任务通知](../plugins/notify/README.md) | 设置 → 通知 | 在运行 dsh 的 Windows 桌面提醒任务完成或等待输入 |
| [工具状态](../plugins/tools-inspector/README.md) | 会话 → 工具 | 查看可见工具及历史调用、失败次数 |
| [技能状态](../plugins/skills-inspector/README.md) | 会话 → 技能 | 查看技能来源与会话加载历史 |
| [文件浏览](../plugins/files/README.md) | 右侧 Sidebar → 文件 | 原生文件树增强、Git 状态、图片预览 Space + 鼠标左键拖动平移、目录右键菜单与文件右键「查看 Git 变更」面板 |
| [常驻服务](../plugins/services/README.md) | 模型工具；输入框上方 | 管理有名字、可跨会话存活的服务；注册表在 DSH_HOME，跨工作区可见可停 |
| [交互终端](../plugins/terminal/README.md) | 模型工具；输入框上方 | 由用户直接输入密码、MFA 等交互内容 |

## 运行环境

| 插件 | 使用入口 | 用途 |
|---|---|---|
| [固定 YOLO](../plugins/yolo-mode/README.md) | 插件 → 固定 YOLO 行开关 | 默认停用；打开行开关并重启后固定全权限并自动允许权限请求，用户提问仍需回答 |
| [网页搜索开关](../plugins/web-search-switch/README.md) | 插件 → 网页搜索开关 | 关闭或恢复 dsh 官方网页搜索插件（官方插件页没有提供开关） |

## 分发组合

21 个功能组件以 8 个第三方 Bundle 随 dsh-kit 提供；它们又统一收进
`@dsh-kit/dsh-plugin-suite` 一个套件包，经官方「添加插件」一条路径安装。
组合包是安装、卸载和升级单位；除表中注明外，其组件行仍可在插件详情中单独停用。

| 分发包 | 类型 | 包含组件或功能 |
|---|---|---|
| model-enhancements | 组合包 | Copilot 登录、模型目录更新、模型能力与协议、常用模型、模型提供商、DeepSeek 官方 API 开关；模型目录和模型能力共享运行时目录服务，不可单独停用 |
| conversation-enhancements | 组合包 | 失败重试、会话滚动、会话统计小时档、用户消息分叉、会话重命名、任务通知 |
| development-tools | 组合包 | 常驻服务、交互终端、工具状态、技能状态 |
| proxy | 独立包 | 出网代理 |
| agents-md | 独立包 | 全局提示词 |
| files | 独立包 | 文件浏览 |
| yolo-mode | 独立包 | 固定 YOLO |
| web-search-switch | 独立包 | 网页搜索开关 |

完整包名均为 `@dsh-kit/dsh-plugin-<上表名称>`（套件包为 `@dsh-kit/dsh-plugin-suite`）。
组件顺序以根目录 [plugin-catalog.json](../plugin-catalog.json) 为唯一清单。

插件页与设置清单显示的标题、描述来自每个包 `locale/{en,zh}.json` 的 `meta` 字段
（dsh 0.1.7 起支持本地化包元数据），文案与本页词表一致；未声明 `icon` 时使用 dsh 默认图。
模型屏障占位行不走独立壳包：实现内嵌在套件包 `plugins/suite/fallback/`，
行名是套件包子路径（中文元数据经套件 exports 重映射读取）。

## 安装、升级与停用

- 安装：官方 dsh → 插件 → 添加插件 → 输入 `plugins/suite` 的绝对路径 → 安装 → 启用 → 重启 dsh。
  重启是生效的必要步骤：运行中的 dsh 点「启用」时组件行会因可解析性守卫整包延迟到重启
  装载（不再报 failed to import；安装前启动的进程里裸包名解析不到组件，见
  [插件机制](dsh/plugins.md)）；个别机器上首次启用还可能报一条 session-controller 的
  file-upload 重挂载竞态（上游已知，见 [roadmap](05-roadmap.md)），同样重启即恢复。
  升级：重新构建套件后卸载再安装。
- 停用：套件是一个普通 Bundle。插件页的 Bundle 开关停用整个套件；套件详情里的
  组件开关停用单个组件的行。两者都写在 profile patch 的 `disabled` 或 `dsh.profile.bundles`，
  重启后保持。
- 卸载：官方插件页卸载套件即整体移除；dsh-kit 没有任何自动补回逻辑，
  需要恢复时重新走「添加插件」。
- 组合包与套件不要同时安装：两者会提供同名稳定行 id，冲突会被 dsh 拒绝。
- 改动插件后重新构建并重启 dsh；套件所在 profile 没有 HMR，刷新页面不会加载新产物。
- 带浏览器半的插件依赖 `dist/client.js`；缺失时应修复构建或重新安装套件，不能跳过检查启动。
- 固定 YOLO 默认停用，打开行开关并重启才会取消模型执行前的交互式权限边界，
  关闭行开关（或套件 Bundle 开关）并重启即恢复原生权限控制；
  详情见 [yolo-mode README](../plugins/yolo-mode/README.md)。

新增、删除或重新分组插件时，以根目录 `plugin-catalog.json` 为唯一清单，并同步维护本索引、
组合包 README 与组件 README；新决策先写入 [决策](01-decisions.md)。
