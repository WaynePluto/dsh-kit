# 交互终端

`@dsh-kit/dsh-plugin-terminal` 在右侧边栏提供**原生级**的可输入 PTY 终端：xterm.js 实时渲染、
键盘直写、尺寸自适应、关 tab 杀进程，同时模型保留完整的 start/write/read/close 工具链。
Windows 使用 PowerShell 7，POSIX 使用 bash，底层复用 dsh 的终端运行时与 node-pty。

## 形态

- 一个终端一个 tab chip（`kind: 'dsh-kit-terminal'`，标题固定「AI交互终端」）；
  guide 页的「新终端」卡片为当前会话 spawn 全新终端（与模型 start 走同一条 backend 路径，
  沙箱围栏一致）。
- 模型 `start` 出终端后，monitor（会话级，5 秒）自动打开它的 tab；用户关掉的终端从
  registry 消失，kill 失败的孤儿会被 monitor 重新开出 tab（自愈）。
- 关闭 chip = 杀进程树：第一次点 × 弹出**居中确认弹窗**（官方 Modal），点「关闭终端」才真杀，
  取消/Escape 撤回；模型侧 `close` action 无需确认（工具调用本身即意图）。
- 终端被模型 `close` 或 shell 退出后，tab 保留显示退出态（exit code）与「新建终端」按钮，
  不自动重启。

## 渲染与数据通道

- xterm.js（@xterm/xterm 6.0.0 + FitAddon，内联进 client bundle）+ 官方 xterm.css 内嵌注入。
- 输出走 `POST /api/terminal/stream` 的**流式响应**（官方 /api 桥对响应体增量写入 + 背压，
  无轮询）：attach 先重放宿主侧有界 ring buffer（512KB 原始字节），再接实时帧；进程退出
  发 exit 帧。tab 隐藏即断流，可见即重连重放。spawn 就绪后 ring 裁到最后一个受控提示符
  （`dsh> `），pwsh 启动回显（编码 preamble、prompt 安装命令）不进画面。
- 键盘直写：xterm `onData` → 16ms 微批 → `write` 端点 → PTY；Ctrl+C、Tab、粘贴都是真实按键。
  密码不回显是程序行为（sudo/REPL 关闭回显），UI 不做遮罩。
- 尺寸自适应：ResizeObserver → FitAddon → `resize` 端点 → ConPTY 重排；PTY 以
  `xterm-256color` 宣告（上游默认 `dumb`），程序输出 ANSI 彩色，模型 `read` 经上游
  sanitizer 剥离转义序列拿到干净文本。
- 主题：底座四色（背景/前景/光标/选区）跟随 dsh 主题 token（深浅自动切换）；16 色 ANSI
  用 xterm 内置经典色板（彩色输出）。

## 使用

1. 需要密码、MFA、确认或交互向导时，模型通过 interactive_terminal 的 start 启动命令；
   侧边栏自动弹出对应 tab。
2. 直接在终端里输入并回车（含密码）；提问/审批卡片与终端互不影响。
3. 模型等待用户输入完成时轮询 read 观察提示符恢复；用户输完命令跑完，模型工具自然解除阻塞。
4. 同一会话内的后续命令模型用 write 续发（submit=false 只敲字符不回车）。
5. 模型用完终端应主动 close 并说明；终端被用户关闭后模型 list 不到它，需要时 start 新的。
6. Linux 管理任务的每条 sudo 命令都通过交互终端执行，即使缓存可能跳过密码提示；
   不启动 `sudo -i`、`sudo su`、`su root` 或等价 root shell。

## 生命周期（保活）

| 事件 | 终端 |
|---|---|
| 关闭/刷新浏览器、收起侧边栏、切会话 | 存活（进程在宿主侧；tab 经 localStorage 绑定恢复） |
| 模型任务收尾、turn 结束 | 存活（直到模型显式 close） |
| 闲置 | 存活（上游 registry 无闲置回收） |
| dsh 宿主重启 / 停用插件 / 套件升级 | 死亡（PTY 是宿主子进程；与官方原生终端一致） |
| 所属会话被卸载 | 死亡（终端归属 owner Agent） |
| 用户关 chip（二次确认后）/ 模型 close | 死亡（主动杀） |

## 隔离

终端归属创建它的会话（registry 按 owner Agent 记账并核验）；浏览器通道每个请求带
sessionId，只能寻址本会话的终端，跨会话不可见。同一会话在两个窗口各开 tab 时是同一条
终端的广播（键盘穿插，真实终端语义）。

## 使用边界

只用于预期必须让用户在可见终端直接输入的命令。普通 Git、构建、测试、脚本、长时间运行、
仅需要持久 shell 状态均使用 pwsh/bash；可以改成非交互的优先改非交互。常驻服务用 services。
直接以 `ssh`/`ssh.exe` 开头的 start 命令默认补 `ServerAliveInterval=15` 与
`ServerAliveCountMax=3`；命令首个可执行项不是 ssh 时不做字符串改写。

## 配置

| 字段 | 默认 | 用途 |
|---|---|---|
| mountBackend | true | 挂载 registry 与 tap 包装的 shell backend |
| mountTools | true | 注册一个 interactive_terminal 组合工具 |
| shellDialect | auto | 按平台选择 pwsh/bash |
| hardenPwshReadLine | true | 移除 PSReadLine，稳定提示符与就绪检测 |
| shellArgs | [] | 非空时覆盖默认参数 |
| timeoutMs | 300000 | 一次模型 send 的上限 |
| startupTimeoutMs | 20000 | 每次启动上限 |
| startupAttempts | 3 | 启动尝试次数 |

## 维护与验证

- backend 装载：`TapTerminalBackend` 组合上游 `BashTerminalBackend`（公开构造函数），在
  `spawnTerminal` 注入点拦截——改写 `terminalType` 为 xterm-256color 并把句柄按
  `spec.sessionId`（registry 先铸）登记进 tap registry；上游 `LocalPtySession` 的就绪探测、
  busy 等待、read 分页、signal 全部原样。
- 模型工具契约零改动：composite tool 仍经上游六工具捕获，ssh 保活、guidance 在工具层。
- 多浏览器窗口：同会话多 tab 广播同一终端流；session 卸载 → Agent 销毁 → 终端全灭。
- 详细契约见 [工具与进程](../../docs/dsh/runtime.md)，流式响应与 sidebar tab 契约见
  [插件机制](../../docs/dsh/plugins.md)。

```powershell
pnpm --filter @dsh-kit/dsh-plugin-terminal test
node scripts/terminal-check.mjs
```

live 测试需真实 PTY（tap 配对、直写、帧接收、send 互斥）。修改插件后必须构建并重启 dsh。

## 分发与管理

本包不作为独立安装项分发，而是 `@dsh-kit/dsh-plugin-development-tools`（开发工具 Bundle）的
组件。停用后，交互终端工具与侧边栏 tab 消失；Linux 上经交互终端使用 sudo 的入口也不可用。
可在该 Bundle 详情中单独停用或重新启用本组件；安装、卸载和升级以整个开发工具 Bundle 为单位。
套件安装后本组件默认启用；后续升级以整个套件为单位，并保留 Bundle 与组件的停用状态；
卸载后不会自动补回。需要重装时，在 dsh「添加插件」中填写套件目录 `plugins/suite` 的绝对目录。
