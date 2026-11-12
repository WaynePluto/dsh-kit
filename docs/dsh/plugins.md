# 插件机制与界面

基线见 [源码依据](../02-dsh-facts.md)。产品装载规则见 [决策](../01-decisions.md)。
以下路径相对 dsh 仓库根，明确标注项目实现的除外。除另有标注外，本页结论核对于 dsh `0.2.2-rc.1`
（cordis vendor 4.1.0 / loader 1.1.0 / include 1.1.0 / hmr 1.1.0 / schemastery 3.19.0 / timer 1.2.0）。

## Bundle、Overlay 与第三方安装

出处：`apps/cli/src/profile-boot.ts`、`packages/boot/app-boot/src/index.ts`、`src/profile.ts`、
`apps/cli/src/plugin.ts`、`packages/boot/plugin-manager/src/index.ts`。

应用顺序为 Bundle → profile patch → home patch → `--patch`（argv 顺序），后者覆盖前者。
`--patch` 可重复传入；insert 中 `./` 或 `../` 开头的入口锚定到 patch 所在目录。裸包名相对
Bundle 自身解析，因此组合 Bundle 必须将组件声明为固定版本 dependencies，并从自己的安装目录
解析；本地目录安装是 `link:` 语义（不安装依赖），套件因此自带物化好的 `node_modules/`。

profile 的 `dependencies` 是第三方 Bundle 是否安装的事实，`dsh.profile.bundles` 是 Bundle 是否
启用的事实，profile patch 中目标行的 `disabled` 则是组件是否停用的事实，三者不能混用。
dsh-kit 只使用官方安装流程：「添加插件」写 dependency 与 bundles，插件页开关改 bundles，
组件开关改 profile patch 的 `disabled`；项目不实现自己的安装、升级或状态记忆，也不在卸载后补回。

行开关与 disabled 覆写的上游事实（2026-10-12 核对 `packages/boot/plugin-manager/src/patch.ts`
与 `vendor/include/src/index.ts`）：行开关写入 profile patch 顶层 `{id, name?, disabled}` 覆写行
（findLast 匹配非 insert 行；`document.add` 追加的行是**流式形态** `[ { id: …, disabled: false } ]`），
patch 应用时对目标行按键整段替换——`!!js` 表达式会被布尔值整体覆盖。行自身的 `disabled: !!js`
表达式在 loader ctx 求值，config 的 `!!js` 在行 fiber ctx 求值，`baseUrl` 都是 profile 目录
（根 config `cordis.yml` 所在目录），因此表达式能读 profile 的 package.json 与 `cordis.patch.yml`。
组件行开关只命中同 id 的行：bundle patch 里同一组件的兄弟覆写行是独立 entry，必须各自跟随
组件开关；且**覆写行的 disabled 会连官方基础行一起整行禁用**
——需要「未激活时保留官方行为」的覆写必须用 config 条件回退而不是行 disabled。

套件 patch 由 `scripts/build-suite.mjs` 生成，不是手写文件：**本层只有 insert 行，永不覆写官方行
（D16，2026-10-14）**——任何 id 命中官方 Bundle 行的覆写（历史上的 `llm-pi-ai` 屏障行、
connection 行 webServer 注入覆写）都会让套件启停的重组合重启该行 fiber 并沿
注入链级联到 session-controller（file-upload Agent resolver 二次注册竞态已由上游 0.2.2 的
`67a4ab78be` 修复：resolver 存 holder、dispose 后可重注册，同刻双注册仍抛错；D16 禁令不因此
放松——级联重启本身就是要避免的故障源）。其余为各组件 `cordis.patch.yml` 顶层条目的改写
（入口换成裸包名，insert 子行补「套件成员 + 组件包可解析」双条件 `disabled` 表达式）。
生成后脚本把组件包、组件依赖的
workspace 共享包（`packages/` 下，如 `@dsh-kit/plugin-rpc`）与 registry 依赖闭包物化进
`plugins/suite/node_modules/`；`@deepseek-ai/*` 由 dsh 运行时树提供，不复制第二份单例。
套件包移动目录后仍可工作（入口是包内相对路径，裸包名从套件自身安装目录解析）。

宿主半私有 RPC 的官方通道（2026-10-14，D16；0.2.2 复核 connection 包零 diff）：`ctx.connection.rpc.handle(channel, handler)`
把通道挂在 connection 行 fiber 上且注册路径要求该行注入 `webServer`，第三方层为满足它覆写
官方 connection 行是不可行解。官方另有 `ctx.connection.fetch.register({ path, methods,
requestBody, fetch })`：在 `/api` 之下的精确 Fetch 路由，由官方 connection 插件自挂的共享
`/api` 桥统一应用 Host/Origin 围栏与浏览器认证（`connection/src/rpc-host.ts` 的
`registerFetchRoute`），不要求 connection 行注入任何服务。kit 组件统一经共享包
`@dsh-kit/plugin-rpc` 使用：宿主半 `registerKitChannel(ctx, channel, handler)`（路由
`/api<channel>`，kit 信封 `{ endpoint, payload }` → `{ ok, value | error }`），浏览器半
`callKitChannel(channel, endpoint, payload?, signal?)`。

**流式响应是一等支持（2026-11-05 核对 `connection/src/http-bridge.ts`，交互终端 stream 路由实例）**：
fetch 路由 handler 返回标准 `Response`，桥对响应体做 `for await (chunk of response.body)`
增量写入 + 背压（socket 满 → 等 drain，中途断开由 'close' 解围），无请求级超时；`requestBody`
只管请求体模式（buffered 有 JSON 上限 / streaming 带背压无上限）。插件可注册长驻流式路由
（如 PTY 字节流），响应体用 `ReadableStream` 逐块推帧，客户端断开经 `request.signal` 感知并
即时清理；浏览器端用同源 fetch（cookie 自动携带）+ `body.getReader()` 渐进读，不走一次性
json() 的 `callKitChannel`。这是官方插件边界内唯一的 Host→Client 实时数据通道（typert
Remote 流只对官方服务开放），适合终端输出、日志尾随等增量推送；一元调用仍走 kit 信封。

可解析性守卫的依据（2026-10-12 核对 `app-boot/src/profile-resolution/resolver.ts`、
`plugin-manager/src/index.ts`）：dsh 只在进程启动时用
`createRuntimeResolution` 把选中 bundle 的依赖闭包收进 runtime resolution 表，安装/启用
Bundle 从不调用 `replace()` 刷新该表；profile 层的本地候选只查
`<profile>/node_modules/<name>` 一层。因此运行中首次启用套件（安装前启动的进程）时裸包名解析不到
套件自带 `node_modules` 里的组件，loader 直接报 failed to import。守卫表达式与 loader 用同一
baseUrl（profile 目录）`createRequire(...).resolve('<组件包>/package.json')` 探测，与真实导入同一判定，
探测不到的行延迟到重启装载。子路径行不适用于有浏览器半的组件行：
`client/modules/src/client/manifest.ts` 的 `exactPackageSpecifier` 只认精确 `@scope/name`，
会被客户端模块扫描跳过（丢浏览器半；模型屏障占位行已随 D16 删除）。
loader 另有裸包名解析 fallback（0.2.2）：解析失败时在项目作用域生成 `.cordis/resolve.mjs`
助手经 `import.meta.resolve` 重试（`vendor/loader/src/resolve.ts`）；运行时 resolution 表拦截
先于它生效，profile 目录出现 `.cordis/` 目录属正常现象，不是装载故障。

profile patch 执行时，末尾 overlay 插入的行还不存在，所以覆盖普通项目插件 config 需要更靠后的 patch，
且目标行必须有稳定 id。用户可编辑的插件字段通过带 volatile Config 的插件行和 configForms 写入；
其他设置仍按其所属服务的契约处理。

插件管理页有三类槽位：`plugins.item` 是官方插件卡片 list；第三方 Bundle 配置使用 keyed
`plugins.bundle.config`（key 为 Bundle 完整包名），组件行配置使用 `plugins.row.config`。
项目配置表单以插件行 entry id 寻址，写回该行的 volatile Config，而非独立设置命名空间
（出处：`ui-plugin-manager/src/client/{slot-contract.ts,PluginManagerPage.tsx}`）。

## 原生「添加插件」与显示

出处：`packages/client/ui-plugin-manager/src/client/{presentation.ts,manager-store.ts,PluginManagerPage.tsx}`、
`packages/boot/plugin-manager/src/index.ts`。管理页行为应以当前安装版本为准。

- 「添加插件」支持包名/版本、Git、压缩包与宿主机器的本地绝对路径；目录应指向有
  `package.json` 且声明 `dsh.bundle.patch` 的包根。已在当前管理列表中的包会被拒为
  already-installed；0.2.2 起该匹配扩展了 Git 形态换算——HTTP(S) Git 地址换算成 SSH 形式
  参与比对（`plugin-manager/src/git-transport.ts`），自托管 Git HTTPS 探测失败时安装自动
  回退 git+ssh。
- manifest 新增可选 `dsh.bundle.platforms` 与 `dsh.bundle.listedByDefault`（0.2.2，
  `packages/boot/app-boot/src/bundle-platform.ts`）：不声明即全平台放行；命中不支持平台时
  该包降级为不默认列出，`listedByDefault` 显式控制默认列出与否。dsh-kit 未声明，行为不变。
- Web 安装先 inspect，再由官方包管理器写 profile dependency；安装完成后点「立即启用」才选入
  `dsh.profile.bundles`。直接关闭安装完成弹窗会保持已安装、未启用。
- 外部包列在「已安装」，标题按展示规则去掉常见包名前缀，简介来自 package.json 的
  `description`，不是 README；因此分发介质必须保留 manifest 的准确中文简介。
- Bundle 开关改有序 bundles 数组；行开关改 profile patch 的 disabled，两者不是同一种停用。
  装载层变更（开关、patch 行、新组件）需要重启 dsh 才应用；浏览器半产物变更由常驻
  client-hmr 热替换（见「客户端产物」）。管理页出现卡片不等于功能已经加载。
- 每个 Bundle `insert` 行必须给出跨重组稳定且全局唯一的 `id`。Cordis Loader 会给匿名行生成随机 ID，
  Profile HMR 全量重读 Bundle 后便会把未变化的匿名行当成新条目，并在旧条目仍存活时重复 import。
  这会使任意 Bundle 开关被无关插件的 `failed to import` 阻断；磁盘选择已保存但旧 fiber 未卸载，
  随后的卸载又会得到 `bundle-in-use`。进程重启只会掩盖问题，不能以“重启后正常”代替稳定 ID。

### 覆盖安装与升级语义（0.2.1-rc.3 查证；0.2.2-rc.1 复核补充）

出处：`packages/boot/plugin-manager/src/index.ts`（installBundle/removeBundle/listVersions/
updateBundle）、`install-spec.ts`、`git-transport.ts`、
`ui-plugin-manager/src/client/{manager-store.ts,PluginManagerPage.tsx}`、`official-install-target.ts`。

- Web 安装的 already-installed 拒绝只在「spec 能预先反查出包名」时发生：registry 名、本地目录
  manifest、以及与已存依赖值逐字相同（或 Git 形态换算后相同，见上文）的 git/tarball spec。
  固定 URL（如 latest 永久链接）重复输入即命中——依赖值就是 URL 本身。**内容不同的新 URL
  反查不到包名，inspect（tarball 类不做该检查）与 installBundle 都放行**，`pnpm add` 原地替换
  同包名依赖值，随后走 HMR publishAndReload 热装载新版本（无 HMR 的 CLI 形态则替换后等重启）。
- 0.2.2 起第三方 registry 包也有原生升级路径：`BundleInfo.update?: 'registry' | 'git'` 标记
  可升级性（rc.1 为布尔 `updatable`，rc.2 改为来源枚举），`listVersions` 列 registry 上的更新
  版本（含 tag/deprecation/DSH 兼容性），`updateBundle` 原地替换（HMR 下先停旧版、安装失败
  自动回装旧版；0.2.2-rc.2 起安装后还校验装出的包名/版本与 patch 可加载，不符按
  `unexpected-package` 回滚）。registry 之外的升级：rc.2 新增 Git 钉 full-commit 安装的
  `update: 'git'` 路径（`updateBundle` 传 `spec`，须同一 origin；`listVersions` 对 Git 安装包
  明确 refused）；本地目录、tarball 安装的包仍不可升级（`update === undefined`）。官方目录包
  的「更新」按钮语义不变（`installTarget` 仅 `OFFICIAL_ON_DEMAND_CATALOG` 条目派生）。
- CLI `dsh plugin --profile desktop add <spec>` 不走 manager、无 already-installed 拒绝，
  等价于带文件锁的裸 pnpm；同 URL 重复 add 会重新下载更新 node_modules，升级障碍只在
  dsh 的 already-installed 拒绝。
- 实机验证（2026-10-28，`suite-upgrade-check.mjs` 全通过）：在线 installBundle 新版本地址 →
  ChangeResult `application=applied` 热生效、各行重新 ACTIVE、依赖值换新；同 spec 重装被拒
  already-installed 且行不受扰动。dsh-kit 的升级机制以此为准（D21）。
- 官方 Bundle 清单搬家到新包 `packages/util/official-bundles/`（bundles.ts、plugin-manager.ts、
  catalog.generated.ts）：`OPTIONAL_BUNDLES` 12→15（新增 personalized-recommendations、
  experimental-liveshare、experimental-forge-bundle），`HIDDEN_BUNDLES` 新增
  experimental-terminal-bundle 与 experimental-tool-worktree；`EXTENSION` 列表 plugin-market
  升主列表、inspector 降 More。
- 0.2.2-rc.2 官方行 id 增删（D16 依赖的稳定性核对，无任何 id 改名）：base 增 `agent-team`、
  `tool-agent-team`（无 disabled 表达式，默认装载），`deepseek-account` 行 id 不变、包名
  `dsh-deepseek-account-platform` → `dsh-deepseek-account`，`web` 行 `searchProvider` 默认
  `deepseek-official` → `deepseek-search-api`，`web-deepseek-api` 删 `apiKeyEnv` config；
  web-app 删 `account-controller`、`office-to-pdf`，增 `ui-account-notifications`、
  `mcp-manager`、`office-kit`、`workspace-dependencies`（`disabled: !!js` 按 desktop +
  `DSH_PRIMARY_RUNTIME` 门控）、`skill-office`、`ui-agent-team`。`disabled: !!js` 三类写法
  （裸布尔 / `profileContext` / `process` env）不变；组合 Bundle patch 文件零改动、行 id 稳定；
  `agent-team-profile` 进 `RETIRED_BUNDLES`，cua-bundle 移入 `OPTIONAL_BUNDLES` 且改随 DSH
  出厂（实验性列表开关启用）。`build-suite.mjs` 未来新增组件行需避开上述新官方 id。

### dsh-kit 分发约束

- 根 `plugin-catalog.json` 将 21 个功能组件映射为 3 个组合包与 5 个独立包；
  它们又收进 `plugins/suite` 一个套件包，用本地绝对目录走上述官方安装流程。
- 组合包是安装/卸载/升级单位，其 `cordis.patch.yml` 仍为组件保留独立稳定行。组件从 Bundle
  内嵌依赖的相对路径装载，并用 Bundle 选择状态跳过 HMR 卸载阶段的瞬时残留行。普通组件可以
  单独 disabled；models-catalog 与 model-capabilities 是一对运行时模型目录组件
  （共享 `modelsCatalogRuntime` 服务），不能只停一行。
- cordis 4 的 service.ctx 经 shadow 解析到服务构造行、`connection.rpc.handle` 的通道归属
  connection 行 fiber 是仍然成立的上游事实（`packages/client/connection/src/rpc-host.ts` 的
  `get rpc()`），但为满足它覆写官方行不可行——套件启停重组合会重启被覆写行并级联
  session-controller（file-upload 二次注册竞态已随上游 0.2.2 修复，见上文；D16 前的三条覆写行已全部移除）。
  私有 RPC 走 `connection.fetch.register`（见上文），模型晚注册生效不需要启动屏障；
  第三方 patch 层覆写官方行前必须先验证「该行随本层启停回退」的级联后果。
- profile 初始化的 `allowBuilds` 逐包显式决定（缺项会让 pnpm 硬失败 ERR_PNPM_IGNORED_BUILDS）：
  开发 profile 的清单对齐官方桌面 `apps/desktop/src/project-manager.ts` 的 `workspaceFile`，
  原生模块（subprocess-local/koffi/node-pty/fs-ext）置 true，纯 JS/预编译包置 false。
- 插件不写项目专属数据目录、不注入环境变量；不存在 launcher、外部介质同步或第二套插件管理器。

## 客户端产物

出处：`packages/client/modules/src/index.ts`、`packages/client/tsdown.client.ts`、`packages/client/web/src/platform.ts`。

客户端扫描会从 --patch 的入口向上寻找 package.json，读取 dsh.client 与 exports["./client"]。
浏览器 bundle 使用 lazy CJS factory，由 window.__ModuleLoader__.load 注册，必须匹配页面模块表。
页面冻结模块表（`packages/client/web/src/platform.ts` 的 `PLATFORM_MODULES`）成员是
`react`、`react/jsx-runtime`、`react-dom`、`react-dom/client`、`@deepseek-ai/cordis`、
`zod`、`@tanstack/react-virtual`、`@deepseek-ai/dsh-client-store`、`@deepseek-ai/dsh-client-ui-slots`、
`@deepseek-ai/dsh-client-ui-primitives`、`@deepseek-ai/dsh-client-ui-dockkit`；插件要共享其中任何一项
都应作为 external 声明进构建模块表（实例是 files 的 Git 变更面板：`dsh-client-store` 的
`defineStore` 必须取页面单例，独立打包会出现第二份引擎实例）。
React、Cordis、store、slots、ui-primitives 等共享运行时保持 external，其他依赖按需内联。
构建工厂 `packages/plugin-build` 的 `DEFAULT_CLIENT_MODULE_TABLE` 只含 `react`、
`react/jsx-runtime` 与 `@deepseek-ai/dsh-client-ui-primitives`；使用 portal 把内容渲染进
页面 React 管理的原生 DOM 的插件（model-capabilities、deepseek-official-switch）必须显式
追加 `react-dom`，portal 与页面 reconciler 必须共用同一次 React 实例。
跨插件通过 Cordis 服务协作，避免重复打包造成模块实例不一致。

客户端入口的 cordis `inject` 导出（服务等待）与 manifest `dsh.client.inject`（包行图边）是两回事：
fiber 上下文访问已声明的服务属性强制要求 cordis inject 声明（`vendor/cordis` reflect：
`cannot get property "<name>" without inject`），缺声明整行激活失败；0.2.2-rc.2 起 Web 启动
审计只对 7 个必需入口（modules、api-session-controller、ui-renderer、ui-layout、ui-session、
ui-chat、ui-sidebar）拒绝挂载，第三方入口失败降级为一条 console warning、应用照常挂载、该组件
缺席（`packages/client/web/src/boot-client.ts` 的 `requiredClientEntryNames`；官方消费方如
ui-open-in-app/ui-workspace 均声明 `contextMenus`/`sessions`；dsh-kit files
2026-11-11 实机踩坑）。单测 mock ctx 不校验此约束，实机启动是唯一拦截面。
缺失 dist/client.js 会导致该客户端模块激活失败并缺席（rc.2 起不再阻断整个 Web UI）。
`pnpm plugins:build` 与 `pnpm suite:build` 必须同时检查宿主与浏览器产物。

注册时 readFileSync 将 bundle 读成不可变快照，以 IMMUTABLE_CACHE 下发；只有 rebuilt() 会重读。
官方 web-app Bundle 常驻 client-hmr 行（`packages/bundle/web-app/cordis.patch.yml`）：宿主半
以默认 500ms stat 轮询全部已装载组件的浏览器产物（`packages/client/hmr/src/index.ts`），变化即
rebuilt() 重读 bundle、重组模块图并经 `/plugins/events` SSE 推 rebuilt 帧，浏览器半就地热替换。
纯浏览器半改动构建落盘即自动生效，本地路径安装（link: 语义）同样被轮询；宿主半与装载层变更
（Bundle/行开关、patch 行、新组件、依赖物化）仍需重启 dsh。模块扫描不再保留负判定缓存（0.2.2）：
包重装后重启 dsh 即发布新模块状态；`/plugins` 页面路由改为 resource 形态，对外 URL 行为不变。

ui-primitives 0.2.2-rc.1 为纯新增导出；rc.2 起菜单面迁移 CSS anchor positioning：
`useAnchoredPosition`/`AnchoredPositionOptions` 导出删除，`Menu` 的 `getAnchorRect` prop 删除
（改 `anchorRef`/`anchorPoint`），子菜单改独立 body portal（`SubmenuPanel`），`MenuSurface`
组件与半透明磨砂面材质不变。剩余 rc.1 新增导出仍有效（UserMessageBubble、AnimatedRows、
ZoomControls、Tooltip `onlyWhenClipped`、Menu contextual/exiting/returnFocus、MenuItemButton
disabledReason 等）；Tooltip 的 anchor 事件改 pointer 系。

包资产体系（0.2.2 新增，dsh-kit 未采纳，记录为可选）：`/plugins/<pkg>/assets/<path>` 路由 +
包 manifest `./assets/*` export 约定（发射目标 `./lib/assets/*`）+ client factory 的
`require.asset(reference)`（`packages/client/modules/src/assets.ts`、`client/manifest.ts`）。
官方 client 构建预设不再把图片内联成 data URL（tsdown.client.ts 删 dsh-image-inline，
`src/client/assets/` 发射到 `lib/assets/`，需 manifest 声明）；data-URL 内联假设失效。

## 原生客户端加载页

出处：`packages/client/web/src/boot-page.ts`、`src/boot.ts`（对照 0.2.0-rc.2 发布产物确认）。

`AppWebEntry` 构造时创建 `BootPage`（`Loading plugins…`），预取、加载并激活客户端插件后交给
`uiRenderer` 挂载工作台，没有最短展示时间；未看到启动提示不等于流程被跳过（热缓存下 BootPage
可能在首绘前就被替换），后台进程“已可进入”不代表浏览器插件已加载完成。

## index.html 注入

出处：`packages/host/webserver/src/index.ts`（`webserver/index-inject` 事件）、`src/injections.ts`。

宿主插件订阅 `webserver/index-inject`，向每次渲染重新收集的表追加结构化行；0.2.2 起事件
签名带第二参 peer（渲染页面代表的 PeerScope），行是纯 JSON 数据，serve 形态渲染进
index.html 文本，静态 worker 形态由 boot payload 的页面解释器按同一顺序执行。行类型
（IndexInjection）未变：`global`（先于后续 script 行给 globalThis 赋值）、`script`
（内联经典脚本，text 不得含 `</script`）、`script-src`/`script-preload`、`style`、`html`。
webserver 另开放 `WebResourceRoute`/`readResource`（GET/HEAD 资源路由，进程内读取带调用方
Peer；`packages/host/webserver/src/index.ts`），`/plugins` 资源路由即其应用。

head 位置的经典脚本 parser-blocking，先于页面 combo 模块求值。行是给宿主插件的通用能力，
当前 dsh-kit 组件没有使用它。将来要用须注意函数体 `toString()` 序列化限制：自包含、
不引用模块作用域、不能含 `</script`。

原生启动页承担认证交接之后的浏览器插件加载等待（见上文「原生客户端加载页」）。
创建 DOM 不等于立即绘制；不能用 index 注入或 rAF 中看到该节点来保证用户一定看得到。

## 设置写入（dsh 0.1.7 重写）

出处：`packages/settings/settings/src/index.ts`（SettingsForms）、`packages/client/ui-settings/src/client/config-form.ts`（configForms 服务）、
`packages/client/ui-primitives/src/settings-form/`。

dsh 0.1.7 移除了 `settings.register` / `ctx.settingsScope` / `settings.plugin.item`，用户可改字段并入插件行的
composition Config：

- 宿主半导出 `Config`（z schema，可热改字段链 `.volatile()`）与同名 interface（`Volatile<T>` 字段）。
  `apply(ctx, config)` 收到解析后的 config；读值 `config.x.get()`（兼容 schema 直接解析出的普通值），
  响应热更新用 `ctx.on('loader/volatile-update', cb)`（事件名声明来自 `@deepseek-ai/cordis-plugin-loader`）。
- 跨字段校验挂 `ctx.on('internal/config', (fiber, next) => {...})`——cordis 1.1.0 起签名从
  `(this: Fiber, config, next)` 改为 `(fiber, next)`（waterfall，`next()` 取候选，多次调用
  抛错）；校验抛错即拒绝写入、不落盘。参考实现 `plugins/proxy/src/index.ts`。
- cordis 1.1.0 其余契约变化：程序化 `fiber.update()` 的持久化写回改走新事件 `internal/commit`
  （`internal/update` 不再承担保存语义，noSave 只压制 commit 通知）；fiber 失败恢复只有
  `update()` 清 `_error`；logger 数值 WARN=1/INFO=2（与旧版互换，按数值比较日志级别的代码要
  复核）；include 的 `EntryTree.write()` 改名 `commit(change)`，且运行期对 patch 拥有键的
  改动路由回 `config.patches` 并经 `fiber.update` 持久化（journal 化）——insert 行稳定 id
  硬性要求不变。
- 宿主 SettingsForms 仍提供跨命名空间 `describe()` / `mutate(ns, ops, expectedRevision?)`；
  表单命名空间是 profile 行的 entry id（`cordis.patch.yml` insert 行的 `id` 字段），不再与
  文案命名空间同串；宿主显示投影读 `entry.fiber.effectiveConfig`
  （`packages/settings/settings/src/index.ts`）。
- 浏览器半 `ctx.configForms.get<T>(entryId)` 返回 ConfigForm（inject 用 `configForms`）：
  `getSnapshot()/subscribe()`、`mutate(ops)`、`set(field,v)`、`unset(field)`。**mutate/set/unset 返回
  Promise<boolean>，false 即宿主拒绝**——0.1.7 起无需写后回读比对。快照含 `value/status/writable/revision`。
- 插件配置页挂侧栏 Plugins 页三槽（`plugins.item` 官方页、`plugins.bundle.config` 按 bundle 包名、
  `plugins.row.config` 按包名#行id）；`settings.section` 槽仍在，本项目设置分区继续用它。
  schemastery 3.18.4 起 schema 常量不再写 `z<Config>` 显式注解，常量不注解、interface 单独声明。

写入 UX 约定不变：保存前用宿主与浏览器共享的纯函数校验；mutate 返回 false 报错并保留草稿，
确认成功才清草稿和显示已保存；错误贴近字段，成功提交触发的刷新不能立即抹掉成功提示。

已知上游缺陷（0.2.2-rc.1 复核仍未修复）：CLI/dev 形态下 `settings/mutate` 的 volatile 写入
一律被拒（`settings/rejected: profile reload requires the root Include entry`）——config-editor
的 `edit()` 无守卫调用 `reconcileProfilePatches`，settings/config-editor 行从 profile 的 hoisted
node_modules 解析出第二份 app-boot 实例，root Include entry 的模块级 WeakMap 永远 miss
（plugin-manager 的 `reload()` 有 `hmr === undefined` 守卫，config-editor 没有）。官方桌面不受
影响（app.asar 单实例解析）。CLI 冒烟（notify-check/proxy-check 的写入成功项）按精确签名豁免
该缺陷，其余写入失败仍响亮报错。

## 槽位与导航

出处：`packages/client/ui-slots/src/index.ts`、`packages/client/ui-settings-models/src/client/slot-contract.ts`、
`packages/client/ui-conversation/src/client/contract/slots.ts`。

- keyed/single/list 槽同一 cell 可以按 priority 影子覆盖，数值最小者渲染；同 cell + 同 priority 才冲突。
- 0.2.2-rc.2 起新增 `hoc` 槽 kind（`SlotKind` 五值）：包装层语义，entry 声明 `id`/可选 `key`/
  `order`，组件经注入的 `children` 渲染内层（最内层是 owner 内容）；cell =（key 或 wildcard）+ id，
  同 id 的 exact-key 层替换 wildcard 层；层崩溃 `abdicate: false` 只报错不卸层。官方新声明：
  `conversation.chat.markdown.fence`（Markdown fence 包装）与 `conversation.hero.frame`（会话
  滚动体框架）。dsh-kit 暂无使用。
- 接管现有 renderer 使用 priority:-1；并列添加用 list 或插件定义的子槽。
- 普通 list 槽由标准 `renderSlot` 按 cell 选择 priority 最低的 winner。
- `ctx.slots.onEntryError` 观察被错误边界捕获的 slot renderer 异常；只覆盖渲染边界，不等于全局
  `window.error` 或 Promise 拒绝监听（0.1.6 起回调参数是 StoredEntry | StoredFactory 联合，需
  `'options' in entry` 收窄）。监听器随插件 fiber 清理，来源 `ui-renderer/src/client/registry.ts`。
- settings.models.provider-card 是 keyed，llm-pi-ai 的入口由 copilot-auth 负责组合。
  model-capabilities 使用其项目子槽，models-catalog 使用 settings.models.footer。
  0.1.6 起 ISessions.list 不再携带 current（SessionListState 只是目录）；根作用域组件要当前会话，订阅 ctx.uiSession.adapter.current 并读快照的 key。
- conversation.view 是 session-scoped list，label 必须是 thunk，才能随语言切换。
- conversation.chat.node 是 keyed；新增消息行需要自己的 ConversationNodeDefinition 和新 key。
- conversation.input.dock 是输入框上方的 list；conversation.composer.dock 在下方（统计栏），
  也是 session 作用域 list：原生 StatsPills 按 id 各占一条（activity order 0、usage order 1），
  `ui-chat/src/client/apply.ts` 注释明示插件可按 id 新增 pill。列表排序纯数值升序、tie 保注册序，
  负 order 合法；条目收到 session 标准 kit（`sessionId`）加 `useSessions`，会话 cwd 直读
  `useSessions(s => s.byId[sessionId]?.cwd)`，无需宿主半。pill 视觉契约见
  `ui-chat/src/client/chat/StatsPills.module.css`。实例：`plugins/session-workspace/src/client/{index.tsx,pill.tsx}`（order -1）。
- conversation.input.left 是工具行左组（`.tools`）的 session 作用域 list 槽，渲染于
  `[+]` 按钮与 permission/plan 模式之后、右侧控制组（`conversation.input.right` → 模型座位 →
  发送）之前（`InputBar.tsx` 行渲染顺序；官方仓库内无占用者）。工具行按钮视觉契约：
  圆形纯图标钮复刻同文件 `.add`（28×28、14px Medium 字形、全局 focus ring）；
  **开关型按钮不要照抄 `.add` 的常驻灰底**——关闭态 transparent 底 + label-secondary 图标、
  hover `--dsw-alias-interactive-bg-hover`，打开态（`[aria-expanded='true']`）才换
  `--dsw-specific-selector` 灰底 + label-primary 图标（2026-11-02 用户反馈）；带文字 chip 复刻
  `PermissionSelect.module.css` 的 `.trigger`（28px 高、8px 圆角、显式 2px box-shadow focus ring）。
  实例：`plugins/quick-commands/src/client/{index.tsx,button.tsx}`（order 0，2026-11-02）。
- **session 槽位组件的 `inputActions` 标准 prop**（`contract/input.ts` 的 `InputActions`，
  SessionStandardProps 注入）是输入框草稿的公开动作面：`insertQuote(text): boolean`（非空
  文本以原子引用块插入，编辑器拒绝时 false，0.2.2）+ `captureInsertion(): TokenSpan`
  （修订守卫的光标区间副本）+ `insertText(text, span): boolean`（CAS 校验 draftRev，
  草稿已变化或提交锁定时 false）+ `setDraft/persistDraft` 与附件操作。`TokenSpan`
  坐标系是编辑器的 clipboard 投影，不是 DOM `selectionStart`——输入框本体是 Lexical
  `contentEditable`，没有 textarea 可查；span 对插件不透明，捕获后原样传回，失败重取重试。
  插入后面板/菜单行按钮仍持焦点时编辑器是失焦态，上游会跳过 DOM 选区同步：要「插入后
  光标停在文本之后」必须调 `SessionInput.focus()`（同文件 `contract/input.ts`，经
  `ctx.get('conversation').input.for(ctx.sessions.scope(sessionId))` 取），不能靠 DOM
  `focus()` 猜光标位置。
  实例：`plugins/quick-commands/src/client/{insert.ts,index.tsx}`。
- conversation.chat.turnTail 是 chain，不适合保证多个插件并列显示。
- 程序化把图片加入会话草稿走 `conversation.createDrafts()` + `SessionInput.addAttachments()`，契约见 [会话](conversation.md) 的「程序化图片草稿附件」。

0.2.2 新增 `settings.section.icon` 槽（`ui-settings/src/client/contract/slots.ts`）：kind list、
root 作用域、inline；注册 id 必须等于目标 `settings.section` 条目 id，不匹配永不渲染；owner
props 为 `{ size: number; active: boolean }`（导航行传 size 16）；icon 条目的 label 不显示，
未注册的 id 回落 shell 默认 glyph。设置导航原始投影例外仍在（`ui-settings-general/src/client/index.ts`
用原始 `slots.entries('settings.section')` 投影导航）：同 id 的 priority shadow 只渲染一个正文却
会生成两个菜单项，不应把 list 正文 shadow 当作无副作用的菜单增强。设置面板 0.2.2 起 grid 化重排，
<768px 浏览器全屏横向导航（见「原生设置面板」）。dsh-kit 的 proxy/notify/agents-md 已迁移到
`settings.section.icon` 槽，旧的导航 mask 注入 hack 已删除——图标序列化成 data URI/mask 的做法
随图标 sprite 化（见「视觉 token」）整体失效。

### 全局面板（侧边栏行 + 主列页面）

出处：`ui-sidebar/src/client/{index.ts,SidebarRoot.tsx,contract/slots.ts}`、
`ui-layout/src/client/{index.ts,service.ts,stores.ts}`；官方实例 ui-plugin-manager 与 ui-schedule。

- 侧边栏的全局面板行（插件、自动化任务）不是写死的：`sidebar.panellist` 是 root 域 list 槽，
  条目 `{ id, order, label }` + 图标组件；ui-sidebar 订阅该槽重建行、按 order 升序排列，
  label 经 `resolveSlotLabel` 解析、语言切换时重算；行按钮与选中态归 sidebar 所有。
- 页面注册在 `main` keyed 槽（root 域，`key` = 面板 id）；`layout.selectPanel(id)` 切换主列，
  `activePanelId: null` 回到会话（`conversation` 是 main 的保留 key）。id 未注册时 selectPanel 抛错，
  因此先注册页面再注册行（官方顺序）。第三方 id 应带包名前缀，避免与官方 key（plugins/schedules）撞名。
- AppFrame 渲染 `renderSlot('main', {}, { entryKey: panelId ?? 'conversation' })`：选中面板时会话列卸载，
  但 mainView 保留由工作区导航层持有（`ui-workspace/src/client/navigation.ts` 的 retain），
  `ctx.uiSession.adapter.current` 仍是当前会话——全局面板要「当前工作区优先」类锚点时在每次
  轮询/操作前现取，不要在 inject 工厂里缓存。
- 页面 props 组合 `PropsRuntime<'main'> & InjectFace<T> & PropsLocale<ns>`；store 可选
  （ui-plugin-manager 传导航 store，ui-schedule 不传）。行点击埋点只对官方 id 生效，第三方静默。
- 一级页面版式（`ui-schedule/src/client/TaskManagerPage.module.css`）：内容列 `max-width:960px`
  居中、`padding:0 clamp(24px,4vw,48px) 48px`、标题行 `padding-top:28px`（darwin 加
  `--dsh-frame-top-clearance`）、h1 `20px/28px/500`；滚动区 `scrollbar-gutter:stable`、
  `--dsh-scrollbar-width:9px; --dsh-scrollbar-thumb-border:2px`。
- 组件停用后面板行随槽注销消失；正被选中时 layout store 把 activePanelId 回落 null
  （`stores.ts` 的 selectPanel 清理），不留孤儿视图。
- 入口自定义（0.2.1-rc.3 起）：用户可原生收起侧栏面板行、会话头部 View 标签与右侧栏起始页
  卡片，收起 id 持久在 localStorage `dsh.slot.manual-order.<list slot key>.v1`；三个新 root 域
  list 槽 `sidebar.panellist.actions`、`conversation.session.header.views.actions`、
  `sidebar.right.tab.guide.actions` 渲染各区域「更多」菜单行。套件的面板行与 View 标签可被
  用户收起，属预期行为不是装载故障。
- 实例：`plugins/services/src/client/{index.tsx,ServicesPage.tsx,ServicesPanelIcon.tsx}`（order 20）。
- **面板行没有原生 toggle（0.2.1-rc.3 核实）**：`PanelRow` 的点击无条件
  `selectPanel(id)`，对已选中行是无效重选；`layout.selectPanel(null)` 是唯一的
  「回到会话」开关（null 不做注册校验）。活动行的稳定信号是 `aria-current="page"`
  （只有当前选中行输出），行在侧栏唯一的 `nav[class*="panelList"]` 内、类名含
  `panelRow`。注意 ui-primitives Menu 的选中菜单项同样输出 `aria-current="page"`，
  但 portal 在 body、不在该 nav 内——document 级监听必须用容器判定排除。面板页展示期间
  会话结束不记「完成未读」绿点（status-controller 按 mainView 保留判定），见
  docs/dsh/workspace.md；panel-toggle 组件实现了活动行再点一次回会话，上游若原生实现
  toggle 应删除该组件。
- **`ctx.layout` 面板导航契约**（0.2.1-rc.5 核实）：`panelInfo` 是 HostObservable
  （getSnapshot + subscribe，通知同步派发），可零 DOM 订阅面板选中变化；`selectPanel` 与
  `beginNavigation` 都会 abort 挂起导航，在途的 startSession/openWorkspace 遇到后续面板
  切换/回会话即放弃提交。换 mainView 的公开 API（openSession/startSession/openWorkspace）
  全部 'reveal' 收尾：replaceMain 先 retain 换持再 `selectPanel(null)` deselect 面板，无
  'preserve' 公开路径——要在换 mainView 的同时保住面板，只能在面板→null 的同步通知里补一次
  `selectPanel(prev)`（发生在 React 提交渲染之前，面板页不重挂；id 已注销时抛错需捕获）。
  session-park 的面板停靠即此形态。

### Sidebar 扩展与页签

右侧 sidebar 的 tab 类型两段式注册、`useTabInfo`/`registerCloseHandler`/`openTabIn` 契约、
guide 入口、原生 files 增强边界、预览页签、默认页与页签右键菜单，拆分至 [Sidebar 扩展](sidebar.md)。


## 主题与对齐

### 原生主题偏好的作用域

已按 0.2.0-rc.2 的 ui-theme、ui-settings、config-editor 源码核对；本地旧 checkout 不作为此结论基线。
出处：`packages/client/ui-theme/src/{index.ts,theme-settings.ts,boot-theme.ts,client/index.ts}`、
`packages/client/ui-settings/src/client/config-form.ts`、`packages/boot/config-editor/src/index.ts`。

- 三态为 `light/dark/system`，默认 `system`；宿主配置为原生 `ui-theme` 行的 volatile `config.preference`，
  ConfigEditor 写活动 profile 的 `cordis.patch.yml`，不是浏览器 localStorage。
- 客户端公开服务为 `ctx.theme`：`getTheme()` 读快照，`setTheme()` 改偏好，`theme/change` 通知变化；
  内部经 `configForms.get('ui-theme')` 订阅。`setTheme()` 返回 void、先本地更新，不能当作持久化成功的回执。
- 可访问宿主设置的客户端共享同一宿主/profile 的持久化偏好；缺少可写宿主设置时不能承诺跨客户端
  持久化同步。`system` 只共享选择，各设备自行按操作系统解析明暗。
- 宿主每次 index 渲染注入当前偏好与启动配色，刷新时不依赖浏览器存储恢复。

### 视觉 token

出处：`packages/client/ui-theme/src/styles/design-platform.css`、
`packages/client/ui-primitives/src/icons/index.tsx`。

| 用途 | 正确 token 或规则 |
|---|---|
| 描边 | --dsw-alias-border-l1、--dsw-alias-border-l2，l 是字母 |
| 层背景 | --dsw-alias-bg-layer-2 |
| 文字 | --dsw-alias-label-primary、secondary、tertiary |
| 等宽 | var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace) |
| 抬升面 | --dsw-specific-tip |

浅色 bg-layer-1/2/3 都是白，bg-layer-4 无定义；内嵌容器不能只靠层背景表达边界。
--dsw-font-mono 虽被引用但未定义，必须提供完整字体栈。
token 拼写和实际值是两件事，需用真实页面 getComputedStyle 检查深浅主题。

图标 sprite 化（0.2.2）：ui-primitives 图标组件输出
`<svg data-icon="dsw-icon-*"><use href="#…"/></svg>`，sprite 由 ui-theme 注入 body
（`ui-theme/src/client/index.ts`），主题可按 id 替换 artwork；「Artwork 返回独立 svg」的旧
表述作废，把图标序列化进 data URI / CSS mask 的做法失效，需要图标时渲染组件本体。

图标与文字对齐先用嵌套 flex；外层 stretch，各块内部 align-items:center。
汉字墨迹中心与 SVG 几何中心仍可能相差约 1.5px，图标格可用 translateY(0.115em) 做光学补偿。
具体量法见 flex-centering skill；图标尺寸必须放入真实相邻导航行比较。

### 插件配置表单

出处：`packages/client/ui-settings-plugins/src/client/fields.module.css`、`fields.tsx`。
编写主题样式先加载项目 [dsh-theme skill](../../.agents/skills/dsh-theme/SKILL.md)（含级联、
原生控件与深浅主题验证方法，新经验验证后自动合并回技能）。

- 字段使用 34px 内容高度、水平 12px padding、0.5px border-l4、8px 圆角、bg-layer-3，
  文字为 13px / 1.5 / label-primary；核对 content-box 与实际渲染高度，不能只抄 height。
- 内置字段 `:focus-visible` 取消 outline，只将原有边框改为 brand-primary，不叠加粗外圈；
  下拉触发按钮用 `:focus` 同时覆盖鼠标与键盘，不能移除轮廓后丢失可见焦点反馈。
- 默认与焦点/禁用态的 border、color 放在局部 CSS；inline border/color 会压过普通伪类规则。
  禁用态使用 label-tertiary、default cursor，同时保留原生 disabled 语义。
- `appearance:none` 不会自动移除 UA 焦点 outline，也不会统一 OS 原生 select 弹层的 hover；
  卡片 header 的 2px 键盘焦点圈不受字段规则影响。
- 设置 → 模型里的原生字段基准来自 `ui-settings-models/src/client/ModelsSection.module.css`：
  `border-box`、32px、0.5px border-l4、8px、bg-layer-1、14px/22px、brand focus；select
  额外保留右侧 12px chevron。`model-capabilities` 的三个能力/协议 select 必须跟这个基准，
  不能退回 1px border-l1、透明背景或 UA focus。
- 设置 → 代理与全局提示词是项目自有原生 input/textarea，也必须给出局部 focus/disabled 状态；
  日志/终端输出等 code surface 是有意的阅读容器，不按表单字段强行改成同一高度；终端实际输入框
  仍按 dsh 字段处理，不能因为同在一个 dock 就沿用输出区的 l1/transparent 样式。

### 选项菜单

出处：`packages/client/locale/src/client/LanguageRow.tsx`、`packages/client/ui-primitives/src/Menu.tsx`、
`Menu.module.css`。选项菜单以 dsh external `Menu` 复用页面运行时。

- 选项 hover 使用 `--dsw-alias-interactive-bg-hover`，不要给原生 option 强套 CSS，或修改触发器背景来代替。
- 默认 `selection='check'` 以右侧勾号标记 `selectedId`，选中未 hover 时仍透明；`fill` 会常驻高亮，语义不同。
- 设置页使用 `portal` 避开滚动容器裁剪；Menu 的 `className` 仅给锚点 wrapper，不传给浮层。
- 锚点 wrapper（`.root`，`position:relative; display:inline-flex`）是**内容宽**的：给 anchor 元素
  自身写 `max-width:N%` 会对这个 wrapper 解析而不是宿主行，等于永远按自身内容宽截断。宽度约束
  应经 `className` 写在 wrapper 上（`flex:0 1 auto; min-width:0`），anchor 元素只留 `min-width:0`。
  实例：task-board 工作区 chip 的 `.dsh-task-board-wsChipHost`（2026-11-01 实机定位）。
- 当前 Menu 无选中项自动聚焦或方向键导航；替换原生 select 时由字段局部补齐箭头/Home/End、
  Enter/Space、Tab/Escape 和选择后焦点归还。外部点击关闭不抢焦点；禁用时关闭菜单并拒绝选择。
- Portal 首帧隐藏以测量尺寸；自动聚焦需等定位提交后（如可清理的下一帧），不能在同轮父 layout effect 中直接 focus。
- Portal 的 React 键盘事件仍到达字段 owner，局部 Escape 应阻止冒泡，避免同时关闭父设置窗口。
- MenuSurface（ui-primitives 浮层菜单面）0.2.2 新增 `phase` prop（`'enter'|'dismiss'|'replace'`）
  驱动 `MENU_TRANSITION_MS` 进出场动画；动画施加在直接子元素与 backing 上、不施加容器。
  材质与 `data-menu-material="translucent"` 契约未变，禁止自绘 specific-menu 背景的规则不变。

### 原生设置面板与桌面顶部留白

出处：`packages/client/ui-settings-general/src/client/SettingsRoot.module.css`（0.2.2-rc.1 源码核对）。
设置 overlay 仍为 fixed 居中；面板高度为
`min(800px, calc(100vh - 2 * max(24px, var(--dsh-frame-overlay-top,24px))))`
（`--dsh-frame-overlay-top` 由 `ui-layout/src/client/AppFrame.module.css` 发布：桌面为
`--dsh-frame-top-clearance + 20px`，浏览器为 20px），`max-width: calc(100vw - 48px)`。
0.2.2 起面板内部 grid 化：`188px minmax(0,1fr)` 两列、标题行 + 导航/正文两行；<768px 浏览器
全屏（`max-width:none`）横向导航。dsh 文档未定义该项目变量，沿用36px占位和border-box。

### Modal 弹窗

出处：`packages/client/ui-primitives/src/Modal.tsx`、`Modal.module.css`。

- 插件传给 Modal 的 `className` 落在 `.dialog` 卡片上：`position:relative`、`overflow:hidden`，
  Modal 不提供自定义 header 插槽；要在关闭按钮旁加自绘按钮，只能绝对定位在卡片内。
- header 布局：padding `22px 14px 12px 24px`，close 按钮 28×28、圆角 8、右侧 14px；
  紧贴其左侧的新按钮用 `top:22px; right:50px`（14+28+8），样式复刻 `.close`（transparent 背景、
  label-secondary、hover interactive-bg-hover、保留 UA 焦点轮廓）。
- 自绘按钮必须压过移动热区（z-index 2）与 resize 手柄（3），公共实现取 `z-index: 4`；全屏图标用
  `IconFullscreenOutline16`（仅展开方向，两种状态共用并切换 aria-label）。
- 全屏能力由 `packages/plugin-ui/src/dialog-fullscreen.ts` 提供：`useDialogFullscreen`（进入前保存几何、
  退出写回、窗口 resize 跟随、按 `open`/`identity` 复位）、`dialogFullscreenButtonRule`、`DialogFullscreenButton`；
  几何写入与拖动 resize 共用同一组 custom properties，全屏时隐藏拖动与八向手柄。
- 实例：services 日志弹窗与 turn-retry 原因弹窗共用同一实现（仅 dialog class、data 属性名、图标不同）。

## Dock 约定

出处：`packages/client/ui-conversation/src/client/skeleton/TodoPanel.module.css`、`TodoPanel.tsx`、
`queue/QueueDock.module.css`。项目 dock 外观沿用官方 todo，不独立设计。

| 项目 | 规则 |
|---|---|
| 宽度 | margin:0 auto；width:calc(100% - 侧留白×2 - dock内缩×4)；max-width:calc(var(--dsh-composer-card-max-width) - dock内缩×4) |
| 背景与边框 | var(--dsw-specific-tip)；0.5px solid var(--dsw-alias-border-l1) |
| 圆角 | 12px |
| 表头 | 整行 button、aria-expanded、gap:10px、padding:8px 12px；嵌套 flex 居中 |
| 标题与摘要 | 13px，标题 500/primary，摘要 tertiary；ellipsis 放内层 span |
| 列表行 | 单行不换行；可变长文本给 `min-width:0` + ellipsis，行尾按钮组包在 `flex:none` 容器里不被压缩（实例：services 的 ServiceRow） |
| 图标 | ui-primitives 的 outline 图标；services 与 terminal 共用 IconApiOutlineMedium |
| 箭头 | 收起状态 IconChevronUpOutlineMedium，展开状态 IconChevronDownOutlineMedium |
| 滚动条 | --dsh-scrollbar-thumb 与 hover 使用 scrollbar-bg-l2、scrollbar-hover-l2 |

@deepseek-ai/dsh-client-ui-primitives 必须 external，复用页面已有组件与 CSS。通用文件图标是
`FileTypeIcon`（用 `path` 或 `kind` 选择类型）；该包带 CSS，不能在 environment:node 单元测试中直接 import。

## 插件包约定（dsh 0.1.7）

- **peer 版本准入**：dsh 在 profile 装载时校验插件 `peerDependencies` 里的
  `@deepseek-ai/dsh*` 声明与运行时版本，不匹配即拒载整行（官方豁免通道是 profile
  `compatibility.json`）。本项目插件对 dsh 包只有类型引用，统一放 devDependencies 而非 peerDependencies。
- **显示元数据**：插件页/设置清单的标题与描述来自各包 `locale/{en,zh}.json` 的
  `meta.title/description`（exports 需含 `./package.json` 与 `./locale/*.json`，
  files 带 `locale`）；解析规则 0.2.2 未变，Bundle 详情页另支持 `meta.detail` 命名的
  Markdown 长描述（缺省回落 README，`plugin-manager/src/bundle-detail.ts`），dsh-kit 暂不提供。
  文案与 docs/plugins.md 词表一致；`icon` 暂不声明，用默认图。
- **Bundle 静默跳过**：dsh 0.1.7 对解析/清单/patch 失败的 Bundle 不再启动即败，跳过项收进
  `Profile.skippedBundles`，CLI 装载完成后 `reportSkippedBundles` 每次启动向 stderr 打一次
  `dsh: skipping profile bundle "<包名>": <原因>`。排查安装问题先看这行输出；构建管线的
  「缺少宿主/浏览器产物」预检仍是必要的前置防线。
- **工具参数 schema**：`ctx.tools.register` 收原始 JSON Schema，只有 `defineTool` 会把属性表简写
  编译成对象根 schema（`packages/core/tools/src/schema.ts`）。裸注册的 `parameters` 必须自己写全
  `type: 'object'` 与 `properties`，属性级 `required: true` 简写不生效；扁平属性表会原样进入模型
  请求，被服务端工具定义校验拒绝整轮请求（2026-10-09 实测 400 `invalid_function_parameters`；
  terminal 插件因此改回对象根 schema）。
