# 官方桌面应用启动结构

核实于 dsh-v0.2.0-rc.2（git `639ed01539`）。源码路径相对 dsh 仓库根。
本页记录官方桌面版（本题的主宿主）的启动时序查证结论，供插件开发与排查参考；
行为变化在升级 dsh 时复核。

## 架构

- `apps/desktop`（`@deepseek-ai/dsh-desktop`）是 Electron 44 壳；真正的 dsh
  宿主是**同一个 Electron 二进制以 Node 模式运行的子进程**
  （`ELECTRON_RUN_AS_NODE=1`，`apps/desktop/src/node-environment.ts`），
  入口为 `apps/desktop-host`（`@deepseek-ai/dsh-desktop-host`）。
- 打包布局（实测 0.2.0-rc.2 安装目录）：**完整 dsh 运行时树（176 个包）整体
  打进 `resources/app.asar` 归档**（asar 头部 `dsh/node_modules/…`），只有
  原生模块等必须落盘的例外放在 `app.asar.unpacked/`（koffi、
  libreoffice-kit 等）。宿主装载插件树时经 Electron 的 asar 虚拟文件系统
  读取——单个大文件的偏移量读取替代数千次小文件的目录遍历与逐个打开，
  这是 Windows 上宿主启动明显快于散装 node_modules 的结构性原因
  （本机实测冷启动约 2.6s 到宿主端口监听）。**运行时零包管理器**：
  所有依赖打包时已就位，启动不做任何版本/内容校验；profile 里的
  `pnpm-workspace.yaml` 仅供用户经插件管理页安装第三方插件时使用。

## 启动时序（`apps/desktop/src/main.ts`）

1. `claimDesktopSingleInstance()` 后注册特权自定义协议 `dsh-app://`
   （`codeCache: true`，Chromium 对该协议 JS 启用 V8 代码缓存）。
2. 隐藏主窗口先 `navigateMain('dsh-app://app/')`：协议处理器对 `/`、
   `/assets/*` 直接 `readFile` 本地 `dsh-web-frontend/dist`
   （`apps/desktop/src/web-document.ts`），**不走网络、不等任何 server**；
   index 注入 `__DSH_BOOT_READY__` gate，页面立即渲染 BootPage。
3. `backend.start()` 随后**并行**：本地 profile 校验（不跑包管理器）→
   spawn 宿主进程 → 宿主 `runProfile` 装载插件树（约 150+ 行，
   Loader 以 `Promise.all` 并发 import，`vendor/loader/src/config/group.ts`）。
4. 宿主整树 settle 后经 **IPC 主动推送** `{type:'ready', url, injections}`
   （`apps/desktop-host/src/index.ts`）；壳用一次 loopback fetch 把
   token URL 换成 cookie（`web-document.ts` 的 `authenticateWebHost`）。
5. 渲染端 `dshDesktopBoot.ready()` IPC 拿注入表、resolve gate，
   前端继续装载浏览器插件；`/api` 与 WS 由协议转发到固定端口
   `127.0.0.1:19387`（宿主以 `--port 19387` 固定，无探测）。
6. 关窗即隐藏，宿主常驻；再次双击走 single-instance 只 focus
   （`main.ts` "Closing hides" 注释与 `single-instance.ts`）。

## 协议唤起（外部把桌面版带到前台）

出处：`apps/desktop/src/main.ts`、`apps/desktop/src/single-instance.ts`。

- 打包版启动时调用 `app.setAsDefaultProtocolClient('dsh')`（仅 `app.isPackaged` 或
  `DSH_DESKTOP_DEV_APP=1`；写入 HKCU `Software\Classes\dsh\shell\open\command`）。
- macOS 的 `open-url` 对 `dsh://open` 与 `dsh://open/` 精确匹配后调用 `focusPrimaryWindow()`。
- Windows 上协议激活是启动第二实例：`requestSingleInstanceLock()` 失败即退出，
  主实例经 `second-instance`（`claimDesktopSingleInstance` 的 focusOwner 回调）调用
  同一个 `focusPrimaryWindow()`——不检查 URL，restore + show + focus；窗口不存在则重建。
- 因此外部唤起统一用 `dsh://open`：notify 插件点击 toast 时经
  `activationType="protocol"` 由 Shell 执行该 URL（见 [会话与消息](conversation.md)）。
- Windows 前台锁定（用户实测 + `focusPrimaryWindow` 源码核对）：主实例已在运行时，
  点击通知后只闪任务栏按钮、不前置窗口。`focus()` 底层是 `SetForegroundWindow`，
  主实例此刻不是前台进程也不持有激活权——用户点击授予的激活权属于被 Shell 启动的
  第二实例，随其退出丢失，不随 single-instance IPC 传递。冷启动（主实例未运行）
  时新进程自带激活权，正常前置。官方 `focusPrimaryWindow` 未使用瞬时置顶或
  `AttachThreadInput` 等规避技巧；该缺陷影响所有 Windows 热启动唤起场景，
  修复需官方调整（dsh-kit 不改 dsh 源码）。
  本节复核于 `dsh-v0.2.1-rc.2`（git `687f282e86`，行号 1219/1235/1236/1343），
  与 0.2.0-rc.2 相比聚焦链路逐字未变，main.ts 差异都在 settings/update 相关文件；
  0.2.1-rc.3（git `1f81c047fc`）该链路同样零变更，行号继续有效。

## 对插件开发的结论

- 宿主启动约 2.6s 到端口监听（冷启动本机实测），其中 asar 化的运行时树是主要加速来源；
  官方 dsh 不跑包管理器，也不在启动时校验依赖版本——插件在 profile 里的依赖由
  用户经插件管理页安装时确定。
- 装插件写的是 profile 目录（asar 之外），第三方插件与官方运行时树物理分离；
  插件产物缺失或 patch 写错只会影响自己那一行，不会修改 app.asar。
- 宿主就绪后经 IPC 把 `{type:'ready', url, injections}` 给壳，壳用一次 loopback
  fetch 换 cookie；`/api` 与 WS 由协议转发到固定端口 `127.0.0.1:19387`。
  排查客户端插件问题要以渲染进程 console 为准（`ELECTRON_ENABLE_LOGGING`）。
- 关窗即隐藏、宿主常驻；再次双击走 single-instance。重启 dsh 即彻底重启宿主进程，
  插件改动必须这样做才能生效。
