# DSH 工作站套件（dsh-station）

**简体中文** | [English](README.en.md)

对应官方 dsh：`0.2.0-rc.2`（已实测）

官方 DeepSeek Harness（dsh）的**全量插件套件**：不再有独立的桌面应用与发行介质（决策 D27），
在官方 dsh 桌面版（或 web 版）的插件管理页「+ 添加插件」输入**一条路径**即可安装或升级全部内容——
远程访问能力与 22 个功能组件。

- 不改 dsh、不 fork，扩展全部走官方插件机制；dsh 升级与工作站解耦
- 远程访问在插件内自举：`remote-runtime` 组件在 dsh 宿主里拉起 relay 与 connector
  （两级分离启动器，杀宿主进程树也存活、重启后自动认领），登录令牌经文件交接，
  trustedHosts 由信任服务注入 connection 行——**没有独立 launcher**
- 远程语义不变：被开放的机器不监听公网端口、主动外拨；所有非本机浏览器访问必须登录
  （密码 + TOTP）；入口机器路由到各台机器的 dsh

## 安装

1. 安装官方 dsh 桌面版（或服务器上运行官方 dsh web）。
2. 克隆本仓库并构建：
   ```powershell
   pnpm install
   pnpm plugins:build
   node scripts/build-suite.mjs   # 生成套件 patch 并物化依赖闭包
   ```
3. dsh → 插件 → 添加插件 → 输入 `packages/plugins/station-suite` 的绝对路径 → 安装 → 启用 → 重启 dsh。
   升级：重新构建后卸载再安装。

用一条 GitHub 仓库地址安装的结构已就绪（`file:` 相对依赖），待仓库公开后实测收口。

## 运行数据与配置

- 数据目录 `~/.dsh-station`：relay 数据库、设备密钥、membership、dsh-token、进程注册表与日志（`logs/`）
- 配置示例见 [packaging/dsh-station.config.example.json](packaging/dsh-station.config.example.json)
  （放 `~/.dsh-station/dsh-station.config.json`；未配置时默认局域网模式，relay 端口 30809）
- 已知边界：更换远程入口后需手动重启 dsh 使新 trustedHosts 生效（插件无法重启宿主）

## 组件一览

远程设置、模型目录/能力/收藏、Copilot 登录、出网代理、全局提示词、会话重试/滚动/分叉、
简洁模式（concise / concise-ptc）、固定 YOLO、常驻服务、交互终端、工具/技能历史、文件浏览、
网页目录选择、浏览器兼容垫片、桌面通知、网页搜索开关。功能说明见 [插件索引](docs/plugins.md)。

## 开发

```powershell
pnpm install
pnpm lint && pnpm build && pnpm typecheck && pnpm test   # 与 CI 相同
pnpm plugins:build && node scripts/build-suite.mjs       # 套件产物
pnpm dev                                                  # 旧开发栈（过渡，待套件化流程替代）
```

修改插件任何一半后都要重新构建并重启 dsh；冒烟脚本见 [源码依据](docs/02-dsh-facts.md)。
可行性探针与桌面版实测记录见 [spike/remote-probe/README.md](spike/remote-probe/README.md)。

## 文档

| 文档 | 内容 |
|---|---|
| [需求与决策](docs/01-decisions.md) | 产品边界、术语与全部决策（D27 为现行分发形态） |
| [架构](docs/03-architecture.md) | 组件、隧道协议与安全模型 |
| [安全](docs/04-security.md) | 认证边界、部署要求 |
| [当前进度](docs/05-roadmap.md) | 已实现能力与待验收项 |
| [插件索引](docs/plugins.md) | 组件功能与入口 |
