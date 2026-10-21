---
name: dsh-source
description: 定位并查证 DeepSeek Harness (dsh) 的本地源码与官方文档。当需要确认 dsh 的实际行为（Web 传输协议、/api 的 Host/Origin 校验、Cordis 插件机制、审批与权限、web server 配置、CLI 命令、官方 SDK）时先加载本 skill，它给出本地源码根路径和常用文件位置。不适用于 dsh-kit 自身的架构决策（那些在 docs/01、docs/03）。
---

# dsh 源码查证入口

本仓库（dsh-kit）中**唯一**记录 dsh 本地源码路径的地方。其他文档、代码注释一律使用**相对于 dsh 仓库根**的路径（如 `packages/client/connection/src/api-request-trust.ts`），需要落到磁盘时来这里取根路径。

## 源码根路径

```
D:\github\deepseek-harness
```

- 若该路径不存在，**先问用户**新位置，不要在别处猜测或搜索。
- **本地源码版本跟随本机安装的 dsh 桌面版**（对齐方法见下节）；查证结论必须对应实际运行的产品版本。
- 本仓库的结论文档（`docs/02-dsh-facts.md`）维护适配基线。本地 checkout 版本与结论文档基线
  不一致时，**以源码为准，并在结论中标注实际核对的 tag**，同时提示用户回写
  `docs/02-dsh-facts.md`；整体推进适配基线属 dsh-upgrade 流程，不在单次查证里顺手推进。

```powershell
# 确认版本
git -C D:\github\deepseek-harness rev-parse --short HEAD
git -C D:\github\deepseek-harness branch --show-current
```

## 与本机安装版本对齐（默认工作流）

每次用本 skill 查证前：先读本机安装的 dsh 桌面版版本，把本地源码切到同一 tag，然后才开始读源码。
本机版本从注册表卸载项读，`InstallLocation` 同时给出安装目录（供实机核对产物用）：

```powershell
Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
  Where-Object { $_.DisplayName -match 'DeepSeek Harness' } |
  Select-Object DisplayName, DisplayVersion, InstallLocation
```

- 源码已停在目标 tag（`git describe --tags` 或 `git rev-parse` 对照）则直接查证；否则按下一节切换。
- 本机安装版本高于 `docs/02-dsh-facts.md` 适配基线时，本次查证仍以本机版本源码为准。

## 切换到指定版本

需要把源码对齐到某个 tag 时（默认是本机安装版本，也可能是升级前核对的指定版本），**优先**用精确拉取单个 tag 再分离切换：

```powershell
git -C D:\github\deepseek-harness fetch origin tag <tag>   # 只拉该 tag，不动远端跟踪分支
git -C D:\github\deepseek-harness switch --detach <tag>    # detached HEAD 停在 tag 上，不建本地分支
```

- tag 命名为 `dsh-v<版本号>`，如 `dsh-v0.1.7-rc.1`。
- 切换前确认 `git status --porcelain` 为空，工作区有残留先处理，不要强切。

## 常用位置（相对 dsh 仓库根）

| 想知道什么 | 去哪看 |
|---|---|
| Web 传输层协议 | `packages/client/connection/README.md` + `packages/client/connection/src/` |
| `/api` 的 Host / Origin 校验规则 | `packages/client/connection/src/api-request-trust.ts` |
| dsh 自带的浏览器认证（token → cookie） | `packages/client/connection/src/browser-auth.ts`、`src/rpc-host.ts` |
| 下行 WebSocket（`/api/remote.mux`） | `packages/api/gateway/src/stream-protocol.ts`、`packages/api/gateway/src/index.ts` |
| 前端插件机制 | `docs/subsystems/client-modules.md`、`docs/cookbook/adding-a-settings-card.md` |
| 插件打包 / 客户端构建 | `packages/client/tsdown.client.ts` |
| Profile 与 bundle | `docs/architecture.md`、`packages/boot/app-boot/README.md` |
| 写第一个 Cordis 插件 | `docs/cordis-tutorial/01-first-plugin.md` |
| `dsh plugin` CLI 行为 | `apps/cli/src/plugin.ts` |
| 设置页扩展（`installSettingsSection`） | `packages/settings/settings/src/index.ts`、`packages/client/ui-settings-general/src/client/index.ts` |
| 审批与权限 | `docs/subsystems/approval.md`、`docs/subsystems/permission-presets.md` |
| Web server 配置 | `docs/subsystems/web-server.md`、`packages/host/webserver/` |
| 官方 TS SDK（备用路线） | `packages/sdk/{protocol,client,server}/` |
| 全部 UI 插件 | `packages/client/ui-*`（37 个） |

## 使用约定

- **只读。** 铁律 1：不改 dsh 源码、不 fork dsh（见 `AGENTS.md`）。
- dsh 行为**必须读源码确认**，不要凭记忆或猜测。
- 查证结论回写到 `docs/dsh/` 对应主题，并标注**相对路径**出处；`docs/02-dsh-facts.md` 只维护基线、导航与检查入口。不要在结论里写绝对路径。

```powershell
# 在 dsh 源码里搜索（示例）
Select-String -Path 'D:\github\deepseek-harness\packages\client\connection\src\*.ts' -Pattern 'trustedHost'
```
