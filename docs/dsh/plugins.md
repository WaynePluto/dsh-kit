# 插件机制与界面

基线见 [源码依据](../02-dsh-facts.md)。产品装载规则见 [决策](../01-decisions.md)。
以下路径相对 dsh 仓库根，明确标注项目实现的除外。

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
注入链级联到 session-controller，命中 file-upload Agent resolver 二次注册竞态。其余为各组件
`cordis.patch.yml` 顶层条目的改写（入口换成裸包名，insert 子行补「套件成员 + 组件包可解析」
双条件 `disabled` 表达式）。生成后脚本把组件包、组件依赖的
workspace 共享包（`packages/` 下，如 `@dsh-kit/plugin-rpc`）与 registry 依赖闭包物化进
`plugins/suite/node_modules/`；`@deepseek-ai/*` 由 dsh 运行时树提供，不复制第二份单例。
套件包移动目录后仍可工作（入口是包内相对路径，裸包名从套件自身安装目录解析）。

宿主半私有 RPC 的官方通道（2026-10-14，D16）：`ctx.connection.rpc.handle(channel, handler)`
把通道挂在 connection 行 fiber 上且注册路径要求该行注入 `webServer`，第三方层为满足它覆写
官方 connection 行是不可行解。官方另有 `ctx.connection.fetch.register({ path, methods,
requestBody, fetch })`：在 `/api` 之下的精确 Fetch 路由，由官方 connection 插件自挂的共享
`/api` 桥统一应用 Host/Origin 围栏与浏览器认证（`packages/client/connection/src/rpc-host.ts`
的 `registerFetchRoute`；`/api` 桥由官方 connection 插件 `ctx.inject(['webServer'],…)` 动态
注入挂载），不要求 connection 行注入任何服务。kit 组件统一经共享包
`@dsh-kit/plugin-rpc` 使用：宿主半 `registerKitChannel(ctx, channel, handler)`（路由
`/api<channel>`，kit 信封 `{ endpoint, payload }` → `{ ok, value | error }`），浏览器半
`callKitChannel(channel, endpoint, payload?, signal?)`。

可解析性守卫的依据（2026-10-12 核对 `packages/boot/app-boot/src/profile-resolution/resolver.ts`、
`packages/boot/plugin-manager/src/index.ts`）：dsh 只在进程启动时用
`createRuntimeResolution` 把选中 bundle 的依赖闭包收进 runtime resolution 表（`PluginPackages`
拦截 ESM/CJS 解析），安装/启用 Bundle 从不调用 `replace()` 刷新该表；profile 层的本地候选只查
`<profile>/node_modules/<name>` 一层。因此运行中首次启用套件（安装前启动的进程）时裸包名解析不到
套件自带 `node_modules` 里的组件，loader 直接报 failed to import。守卫表达式与 loader 用同一
baseUrl（profile 目录）`createRequire(...).resolve('<组件包>/package.json')` 探测，与真实导入同一判定，
探测不到的行延迟到重启装载。（历史）模型屏障占位行曾用套件包子路径
`@dsh-kit/dsh-plugin-suite/fallback` 保证首次启用当场可解析，随 D16 移除屏障行一并删除；
子路径行不适用于有浏览器半的组件行——
`packages/client/modules/src/client/manifest.ts` 的 `exactPackageSpecifier` 只认精确 `@scope/name`，
子路径行会被客户端模块扫描跳过（丢浏览器半）。

profile patch 执行时，末尾 overlay 插入的行还不存在，所以覆盖普通项目插件 config 需要更靠后的 patch，
且目标行必须有稳定 id。用户可编辑的插件字段通过带 volatile Config 的插件行和 configForms 写入；
其他设置仍按其所属服务的契约处理。

插件管理页有三类槽位：`plugins.item` 是官方插件卡片 list；第三方 Bundle 配置使用 keyed
`plugins.bundle.config`（key 为 Bundle 完整包名），组件行配置使用 `plugins.row.config`。
0.1.7 的项目配置表单以插件行 entry id 寻址，写回该行的 volatile Config，而非独立设置命名空间。
槽位声明出处：`packages/client/ui-plugin-manager/src/client/{slot-contract.ts,PluginManagerPage.tsx}`。

## 原生「添加插件」与显示

出处：`packages/client/ui-plugin-manager/src/client/{presentation.ts,manager-store.ts,PluginManagerPage.tsx}`、
`packages/boot/plugin-manager/src/index.ts`。管理页行为应以当前安装版本为准。

- 「添加插件」支持包名/版本、Git、压缩包与宿主机器的本地绝对路径；目录应指向有
  `package.json` 且声明 `dsh.bundle.patch` 的包根。已在当前管理列表中的包会被拒为 already-installed。
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

### 覆盖安装与升级语义（2026-10-28 查证，0.2.1-rc.3）

出处：`packages/boot/plugin-manager/src/index.ts`（installBundle/removeBundle）、
`install-spec.ts`（specPackageName）、`packages/client/ui-plugin-manager/src/client/`
`{manager-store.ts,PluginManagerPage.tsx}`、`official-install-target.ts`。

- Web 安装的 already-installed 拒绝只在「spec 能预先反查出包名」时发生：registry 名、本地目录
  manifest、以及与已存依赖值逐字相同的 git/tarball spec。固定 URL（如 latest 永久链接）重复输入
  即命中——依赖值就是 URL 本身。**内容不同的新 URL 反查不到包名，inspect（tarball 类不做该检查）
  与 installBundle 都放行**，`pnpm add` 原地替换同包名依赖值，随后走 HMR
  publishAndReload 热装载新版本（无 HMR 的 CLI 形态则替换后等重启，源码注释明示该流程）。
- 官方「更新」按钮（`updateAvailable`）只对官方目录包出现：`installTarget` 仅
  `OFFICIAL_ON_DEMAND_CATALOG` 条目派生（产品安装 = `name@dsh版本` registry spec），第三方包
  永远没有。按钮语义本身是 removeBundle + install 的自动编排（manager-store 的 `update`）。
- CLI `dsh plugin --profile desktop add <spec>` 不走 manager、无 already-installed 拒绝，
  等价于带文件锁的裸 pnpm。桌面内置 pnpm 11.28.5（`~/.dsh/dsh-runtimes/…/dependencies/pnpm`）。
- pnpm 实证（11.28.5，本地 HTTP 固定 URL 实验）：同 URL 重复 `add` 会重新下载并更新
  node_modules；不同 URL 替换同包名依赖同样成功且更新依赖值。「同 URL 重装拿不到新内容」
  不成立，升级障碍只在 dsh 的 already-installed 拒绝。
- 实机验证（2026-10-28，`suite-upgrade-check.mjs` 全通过）：旧版 tarball 冷启动 23 行
  ACTIVE 后，在线 installBundle 新版本地址 → ChangeResult `application=applied` 热生效、
  23 行重新 ACTIVE、核心行稳定、依赖值换新；同 spec 重装被拒 already-installed 且行不受
  扰动。dsh-kit 的升级机制以此为准（D21）。

### dsh-kit 分发约束

- 根 `plugin-catalog.json` 将 21 个功能组件映射为 3 个组合包与 5 个独立包；
  它们又收进 `plugins/suite` 一个套件包，用本地绝对目录走上述官方安装流程。
- 组合包是安装/卸载/升级单位，其 `cordis.patch.yml` 仍为组件保留独立稳定行。组件从 Bundle
  内嵌依赖的相对路径装载，并用 Bundle 选择状态跳过 HMR 卸载阶段的瞬时残留行。普通组件可以
  单独 disabled；models-catalog 与 model-capabilities 是一对运行时模型目录组件
  （共享 `modelsCatalogRuntime` 服务），不能只停一行。
- （2026-10-14 随 D16 移除）套件 patch 曾有三条常驻覆写：`llm-pi-ai` 屏障行、connection 行
  `inject` 扩 `[webRuntime, webServer]` 覆写与模型屏障占位行。cordis 4 的 service.ctx 经
  shadow 解析到服务构造行、`connection.rpc.handle` 的通道归属 connection 行 fiber 是仍然成立的
  上游事实（出处：`packages/client/connection/src/rpc-host.ts` 的 `get rpc()`），但为满足它而
  覆写官方行不可行——套件启停重组合会重启被覆写行并级联 session-controller（file-upload
  二次注册竞态）。私有 RPC 改走 `connection.fetch.register`（见上文），模型晚注册生效不需要
  启动屏障。第三方 patch 层覆写官方行前必须先验证「该行随本层启停回退」的级联后果。
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
`@deepseek-ai/dsh-client-store`、`@deepseek-ai/dsh-client-ui-slots`、`@deepseek-ai/dsh-client-ui-primitives`
与 `@deepseek-ai/dsh-client-ui-dockkit`；插件要共享其中任何一项都应作为 external 声明进构建模块表
（实例是 files 的 Git 变更面板：`dsh-client-store` 的 `defineStore` 必须取页面单例，独立打包会出现第二份引擎实例）。
React、Cordis、store、slots、ui-primitives 等共享运行时保持 external，其他依赖按需内联。
构建工厂 `packages/plugin-build` 的 `DEFAULT_CLIENT_MODULE_TABLE` 只含 `react`、
`react/jsx-runtime` 与 `@deepseek-ai/dsh-client-ui-primitives`；使用 portal 把内容渲染进
页面 React 管理的原生 DOM 的插件（model-capabilities、deepseek-official-switch）必须显式
追加 `react-dom`，portal 与页面 reconciler 必须共用同一次 React 实例。
跨插件通过 Cordis 服务协作，避免重复打包造成模块实例不一致。

缺失 dist/client.js 会导致客户端模块激活失败，可能使整个 Web UI 无法启动。
`pnpm plugins:build` 与 `pnpm suite:build` 必须同时检查宿主与浏览器产物。

注册时 readFileSync 将 bundle 读成不可变快照，以 IMMUTABLE_CACHE 下发；只有 rebuilt() 会重读。
官方 web-app Bundle 常驻 client-hmr 行（`packages/bundle/web-app/cordis.patch.yml`，注释明言
always mounted）：宿主半以默认 500ms stat 轮询全部已装载组件的浏览器产物（mtime/ctime/size，
`packages/client/hmr/src/index.ts`），变化即 rebuilt() 重读 bundle、重组模块图并经
`/plugins/events` SSE 推 rebuilt 帧，浏览器半就地热替换（`packages/client/hmr/src/client`）。
因此纯浏览器半改动（dist/client.js）构建落盘即自动生效，无需重启 dsh 或刷新页面，本地路径
安装（link: 语义）同样被轮询；宿主半（dist/index.js）与装载层变更（Bundle/行开关、patch 行、
新组件、依赖物化）不在此列，仍需重启 dsh。

## 原生客户端加载页

出处：`packages/client/web/src/boot-page.ts`、`src/boot.ts`、
`packages/client/ui-renderer/src/client/index.ts`；对照 0.2.0-rc.2 发布的 Web 前端产物确认。

`AppWebEntry` 构造时创建 `BootPage`（`Loading plugins…`），随后在当前浏览器文档里
预取、加载并激活客户端插件，最后交给 `uiRenderer` 挂载工作台；没有最短展示时间。
未看到启动提示不等于流程被跳过：热缓存下 BootPage 可能在首绘前就被替换。
后台进程“已可进入”不代表浏览器插件已经加载完成，排查仍需看渲染进程日志。

## index.html 注入

出处：`packages/host/webserver/src/index.ts`（`webserver/index-inject` 事件）、`src/injections.ts`。

宿主插件订阅 `webserver/index-inject`，向每次渲染重新收集的表追加结构化行；行是纯
JSON 数据，serve 形态渲染进 index.html 文本，静态 worker 形态由 boot payload 的页面解释器
按同一顺序执行。行类型：`global`（先于后续 script 行给 globalThis 赋值）、`script`
（内联经典脚本，text 不得含 `</script`）、`script-src`/`script-preload`、`style`、`html`。

head 位置的经典脚本 parser-blocking，先于页面 combo 模块求值。行是给宿主插件的通用能力：
当前 dsh-kit 组件没有再使用它（原先用它注入 `__DSH_TRANSPORT__.ownsHost` 与旧 WebKit 垫片，
随远程能力删除）。如果将来要用，注意函数体 `toString()` 序列化限制：必须自包含、
不引用模块作用域，也不能包含 `</script`。

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
- 跨字段校验挂 `ctx.on('internal/config', function (this: Fiber, _raw, next) {...})`：`next()` 取候选，
  `this !== ctx.fiber` 时放行；校验抛错即拒绝写入、不落盘。参考实现 `plugins/proxy/src/index.ts`。
- 宿主 SettingsForms 仍提供跨命名空间 `describe()` / `mutate(ns, ops, expectedRevision?)`；
  表单命名空间是 profile 行的 entry id（`cordis.patch.yml` insert 行的 `id` 字段），不再与文案命名空间同串。
- 浏览器半 `ctx.configForms.get<T>(entryId)` 返回 ConfigForm（inject 用 `configForms`）：
  `getSnapshot()/subscribe()`、`mutate(ops)`、`set(field,v)`、`unset(field)`。**mutate/set/unset 返回
  Promise<boolean>，false 即宿主拒绝**——0.1.7 起无需写后回读比对。快照含 `value/status/writable/revision`。
- 插件配置页挂侧栏 Plugins 页三槽（`plugins.item` 官方页、`plugins.bundle.config` 按 bundle 包名、
  `plugins.row.config` 按包名#行id）；`settings.section` 槽仍在，本项目设置分区继续用它。
- schemastery 3.18.4 起 schema 常量不再写 `z<Config>` 显式注解（exactOptionalPropertyTypes 报错），
  常量不注解、interface 单独声明。

写入 UX 约定不变：保存前用宿主与浏览器共享的纯函数校验；mutate 返回 false 报错并保留草稿，
确认成功才清草稿和显示已保存；错误贴近字段，成功提交触发的刷新不能立即抹掉成功提示。

已知上游缺陷（0.2.0-rc.2，2026-10-14 查证）：CLI/dev 形态下 `settings/mutate` 的 volatile 写入
一律被拒（`settings/rejected: profile reload requires the root Include entry`）。链条：settings 的
写入经 `packages/boot/config-editor/src/index.ts` 的 `edit()` 无守卫调用 `reconcileProfilePatches`
（`packages/boot/app-boot/src/index.ts`，root Include entry 记在模块级 WeakMap）；boot（`apps/cli` 的
`runProfile` → `boot` → `mountRootInclude`）在 dsh bin 解析的 app-boot 实例上登记，而 settings/
config-editor 行从 profile 的 hoisted node_modules 解析出第二份 app-boot 实例，WeakMap 永远 miss。
官方桌面不受影响：运行时树整体打进 app.asar 单实例解析。`packages/boot/plugin-manager` 的
`reload()` 有 `hmr === undefined → return []` 守卫，config-editor 没有——这是上游两处不对称。
探针实测：真实 dsh 进程内 `reconcileProfilePatches(ctx.root)` 在 boot 实例上 WeakMap 命中、
在 profile 解析实例上 miss。CLI 冒烟（scripts/notify-check.mjs 的「开关能被写入」项）按精确
签名豁免该缺陷（桌面宿主正常），其余写入失败仍响亮报错。0.2.1-rc.2 与 0.2.1-rc.3 复核均未
修复；官方桌面 rc.3 实测设置持久化正常（profile patch 2026-10-25 有写入），升级 dsh 时复核。

## 槽位与导航

出处：`packages/client/ui-slots/src/index.ts`、`packages/client/ui-settings-models/src/client/slot-contract.ts`、
`packages/client/ui-conversation/src/client/contract/slots.ts`。

- keyed/single/list 槽同一 cell 可以按 priority 影子覆盖，数值最小者渲染；同 cell + 同 priority 才冲突。
- 接管现有 renderer 使用 priority:-1；并列添加用 list 或插件定义的子槽。
- **设置导航是例外**：当前 `ui-settings-general/src/client/index.ts` 用原始 `slots.entries('settings.section')`
  投影导航，而不是 `entriesOfSlot`。同 id 的 priority shadow 虽然只渲染一个正文，却会生成两个菜单项。
  不应把 list 正文 shadow 当作无副作用的菜单增强。
- 普通 list 槽由标准 `renderSlot` 按 cell 选择 priority 最低的 winner。
- `ctx.slots.onEntryError` 观察被错误边界捕获的 slot renderer 异常；它只覆盖渲染边界，不等于全局
  （0.1.6 起回调参数是 StoredEntry | StoredFactory 联合，Factory 没有 options 字段，需 `'options' in entry` 收窄）
  `window.error` 或 Promise 拒绝监听。监听器随插件 fiber 清理，来源为 `packages/client/ui-renderer/src/client/registry.ts`。
- settings.models.provider-card 是 keyed，llm-pi-ai 的入口由 copilot-auth 负责组合。
  model-capabilities 使用其项目子槽，models-catalog 使用 settings.models.footer。
  0.1.6 起 ISessions.list 不再携带 current（SessionListState 只是目录）；根作用域组件要当前会话，订阅 ctx.uiSession.adapter.current 并读快照的 key。
- conversation.view 是 session-scoped list，label 必须是 thunk，才能随语言切换。
- conversation.chat.node 是 keyed；新增消息行需要自己的 ConversationNodeDefinition 和新 key。
- conversation.input.dock 是输入框上方的 list；conversation.composer.dock 在下方（统计栏），
  也是 session 作用域 list：原生 StatsPills 按 id 各占一条（activity order 0、usage order 1），
  `ui-chat/src/client/apply.ts` 注释明示插件可按 id 新增 pill。列表排序是纯数值升序、tie 保注册序
  （`ui-slots/src/index.ts`），负 order 合法，可排到官方条目之前；条目收到 session 标准 kit
  （`sessionId`）加 `useSessions`（ui-session 适配器并入 GlobalStandardProps），会话 cwd 直读
  `useSessions(s => s.byId[sessionId]?.cwd)`，与原生工作区悬停卡同源、无需宿主半。
  pill 视觉契约见 `ui-chat/src/client/chat/StatsPills.module.css`（anchor 12px 次级字号、
  pill `1px 8px` 圆角 `--dsw-radius-sm`、tertiary 静息、hover interactive-bg-hover、svg 14px）。
  实例：`plugins/session-workspace/src/client/{index.tsx,pill.tsx}`（order -1，2026-10-27）。
- conversation.chat.turnTail 是 chain，不适合保证多个插件并列显示。

settings.section 没有 icon 字段，导航 shell 按 id 选择图标，未知 id 为齿轮。
出处：`packages/client/ui-settings-general/src/client/SettingsRoot.tsx`。
项目的代理、通知、全局提示词和浏览器日志使用局部导航标记和注入样式，不替换 React 节点。
当前图标映射为 `IconGlobeOutlineMedium`、`IconAlarmClockOutlineMedium`、`IconListPenOutlineMedium` 和
`IconCodeOutlineMedium`；`settings.section` 没有 icon 字段，因此插件调用这些原生 component 并将
返回的 SVG element 序列化成导航 mask。已安装的 0.2.0-rc.2
`@deepseek-ai/dsh-client-ui-primitives/lib/index.js` 中，这些 component 返回的 React element
先以纯函数 Artwork 为 `type`，Artwork 再返回原生 `<svg>`；项目公共 helper 必须有界展开函数包装，
不能只接受 `type === 'svg'`，否则四个设置页插件启动即失败。
公共 helper 使用 dsh shell 已渲染的直接子 SVG 作为 mask 载体，并隐藏其原生子路径，避免伪元素在
React 重建或旧 WebKit flex 布局中丢失。升级检查包含 `navCell`/`navLabel` 的局部类名；不匹配时退回默认图标。

### 全局面板（侧边栏行 + 主列页面）

出处：`packages/client/ui-sidebar/src/client/{index.ts,SidebarRoot.tsx,contract/slots.ts}`、
`packages/client/ui-layout/src/client/{index.ts,service.ts,stores.ts}`、官方实例
`packages/client/ui-plugin-manager/src/client/index.ts` 与 `packages/client/ui-schedule/src/client/index.ts`。

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
- 一级页面版式（`ui-schedule/src/client/TaskManagerPage.module.css` 的
  `.page/.pageScroll/.pageContent/.pageHeading`）：内容列 `max-width:960px` 居中、
  `padding:0 clamp(24px,4vw,48px) 48px`、标题行 `padding-top:28px`（darwin 再加
  `--dsh-frame-top-clearance`）、h1 `20px/28px/500`；滚动区 `scrollbar-gutter:stable`、
  `--dsh-scrollbar-width:9px; --dsh-scrollbar-thumb-border:2px`。
- 组件停用后面板行随槽注销消失；正被选中时 layout store 把 activePanelId 回落 null
  （`stores.ts` 的 selectPanel 清理），不留孤儿视图。
- 入口自定义（0.2.1-rc.3 起）：用户可原生收起侧栏面板行、会话头部 View 标签与右侧栏起始页
  卡片，收起 id 持久在 localStorage `dsh.slot.manual-order.<list slot key>.v1`；三个新 root 域
  list 槽 `sidebar.panellist.actions`、`conversation.session.header.views.actions`、
  `sidebar.right.tab.guide.actions` 渲染各区域「更多」菜单行（owner props 为
  entries/onOpen/onPinnedChange/onDismiss），官方 `ui-entry-customization` 包注册默认菜单内容。
  套件的面板行与 View 标签可被用户收起，属预期行为不是装载故障；「更多」按钮只在对应
  actions 槽有注册项时出现。
- 实例：`plugins/services/src/client/{index.tsx,ServicesPage.tsx,ServicesPanelIcon.tsx}`（order 20）。

### 右侧 Sidebar 页面类型

出处：`packages/client/ui-sidebar-right/src/client/tab-registry.ts`、`contract/slots.ts`、`service.ts`，
文件树实例见 `packages/client/ui-sidebar-files/src/client/{definition,index,FilesBody}.ts`。

- 页面类型通过 `ctx.sidebarRightTabs.register({ id, kind, priority, title, guide })` 注册；不声明 `patterns` 的类型是页面，入口由 guide box 的 `id/order/title/description/icon` 提供（0.1.6 起 `id` 必填，为 provider 内稳定标识）。
- 页面正文必须以同一 `id` 注册 keyed slot `sidebar.right.pane.tab`；组件通过标准 props 的 `useTabInfo()` 读取当前 tab 与 `tab.actions`，并由 session scope 自动得到 `sessionId`。
- `ctx.sidebarRight.openTab(kind)` 打开页面；条目内部应使用 `tab.actions.openTab/openResource`，不要自己拼 `sidebar://` 地址。files 增强只 shadow 原生 `files` body，不另注册用户可见 kind；其他外部插件仍使用独立 kind，只有明确接管 builtin kind 时才用 `priority: 'extension'` 同 kind 注册。
- 外部插件注册**新资源类型**（不接管 builtin）的完整契约（files Git 变更面板实例）：definition 声明
  `patterns`（含 `:` 的模式匹配整串地址）+ `canOpen` 否决 + `title(address)`，缺省 priority 即 `extension`；
  正文以 definition 的 `id` 注册 keyed 座位；`openResource(address, { params })` 的参数类型经
  `SidebarRightResourceParamsMap` 的声明合并（key 是 `dsh-resource://` 后的第一段）；资源按 `(kind, contentId)`
  跨 pane 去重（`revealIfOpened` 默认开），重复 open 走同一页签并递增 `navigation.revision`、携带新 `params`；
  正文可用 `tab.actions.bindCommands({ refresh })` 接上 Sidebar 刷新入口。`ctx.sidebarRightTabs` 来自
  `ui-sidebar-right` 的 reflect provide，需加进插件 client `inject`。
- 原生「已编辑 n 个文件」改动面板（`ui-deliverables` 的 changes-review）**不能被插件 import**：
  已发布包外层导出只有 `apply`/`inject`，`files` 列表不含 `src`（`./src/*` 导出只是仓库内形态），
  且两包不在页面冻结模块表；复用只能按其组件结构与 CSS 规则在插件内复刻（同版本源码对照），
  公开 primitives（Menu/Tooltip/PathLabel/`useCodeHighlighter`）与 `dsh-client-store` 不受影响。
- **inject hooks 的 observable 必须发布不可变快照**：渲染层把 hooks observable 绑定成
  `useSyncExternalStoreWithSelector`（`packages/client/ui-renderer/src/client/bind.ts`），它先用
  Object.is 比较快照引用，引用不变就不会重跑 selector——插件拿原地修改的 Map/对象当快照时，
  通知照发但组件永远停在首次渲染（2026-10-14 files Git 变更面板实机定位：面板永远「正在读取改动…」；
  回归测试 `plugins/files/src/client/gitReviewBinding.spec.tsx` 用同一 API 驱动真实 React 渲染守护）。
- 页面包的 `package.json` 用 `dsh.client.inject` 声明对 `@deepseek-ai/dsh-client-ui-sidebar-right` 的模块关系；Cordis 运行时仍把 `sidebarRightTabs` 放进插件 `inject`，两者不是同一种依赖。

### 原生文件增强的复用边界

出处：`packages/client/ui-sidebar-right/src/client/{tab-registry.ts,service.ts,contract/slots.ts}`、
`packages/client/ui-renderer/src/client/registry.ts`、`packages/client/ui-slots/src/index.ts`、
`packages/client/web/src/platform.ts`。文件能力见 [工作区](workspace.md)。

- 同 kind 共存只允许一组 builtin + extension；原生 `files` 可以这样接管，guide 只列生效项，
  卸载 extension 后恢复 builtin。`text` 属于 fallback，不能用 extension 同 kind 重注册，二者会冲突。
- `ctx.sidebarRight.split(paneId)` 返回新 pane id 或 undefined；底层 dockkit 默认预算为四个 docked pane，
  当前 Sidebar controller 的 split 还在已有两个 docked pane 时拒绝分栏，并受空间与浮动状态约束。
  `tab.actions.openResource(address, { paneId })` 可指定目标 pane，但分栏本身不会改变原生树“在自己的 pane 打开文件”的行为。
- `FilesBody` 与 `TextPreview` 没有从各包 client 入口导出为运行时值，两包也不在平台共享模块表；
  不能仅添加 external 就假定浏览器能 import 它们。发布 files 列表也不包含源码，不能依赖 `./src/*` 导入。
- `slots.entries` 是登记快照，不是通用组件嵌入 API；files 增强在当前版本只把它作为版本受控的适配 seam：
  shadow 登记完整复用原 entry 的 component、store、inject、locale，并只在外层观察/事件委托。
  这不是对任意 dsh 组件的稳定承诺，原生登记契约变化必须由冒烟检查响亮失败。
- **0.2.0-rc.2 起原生 FilesBody 声明 children 并在渲染期调用 `props.renderSlot`**（`sidebar.right.tab.files.actions`，
  list/session，官方 ui-open-in-app 往里注册「打开方式」）。影子条目不声明 children 就拿不到 renderSlot prop，
  内嵌的原生组件抛 `TypeError: renderSlot is not a function`，条目被错误边界捕获后座位回退原生——增强静默丢失
  （2026-10-10 桌面 CDP 定位，ELECTRON_ENABLE_LOGGING 可见该报错；`standardKit` 只给声明 children 的条目装配
  renderSlot/SessionProvider，`scoped-slots.tsx` 的绑定按登记项自身 children 授权，无公开途径借得原生绑定）。
  重复声明同一 child slot 会在 register 抛错（`slot "..." is already declared`），因此影子包装在 0.2.0 契约下不可行。
  files 已改为 DOM 级挂载（MutationObserver 发现 `[data-files-state]` 树根 + 捕获事件 + 独立 React 根菜单，
  `nativeFilesAdapter.tsx`）；title 座位（`sidebar.right.pane.tab.title`）的影子仍可用：documentpreview 的
  title 注册不带 children。
- Slot 的子槽由唯一登记 owner 声明并持有 render 授权；对现有 cell 加 priority:-1 不会继承原登记项的 children。
  files 不重声明 `sidebar.right.tab.document`，不覆盖 `ui-sidebar-documentpreview` owner；ctx 级 renderSlot 只能渲染 root。
  因此不能把原生预览拆出来任意嵌入另一个 body。图片增强改在原生 text title slot 以 portal 控件定位已渲染 image frame，
  不复制 ImageBody 或通过 root 重新声明 document child slot。已安装 0.1.7 的 ZoomViewport 以
  `data-document-zoom-scrollport` 标识自身滚动容器；Space+鼠标平移只滚动当前图片的该容器，
  不移动原生 DOM。portal 内的交互控件必须同时阻止
  `pointerdown` 和 `click` 冒泡；dockkit 的原生 tab 会在 pointerdown 启动拖动/重建，若不阻止，浏览器可能把
  portal 按钮的后续 click 重定向到 tab。该行为与 `ui-dockkit` 的 TabMenu 处理一致，files 的图片工具栏遵循同一规则。

### 临时预览页签的可用接口

出处：`packages/client/ui-sidebar-right/src/client/{service.ts,tab-domain.ts,stores.ts,contract/slots.ts}`、
`packages/client/ui-sidebar-documentpreview/src/client/TextTitle.tsx`。
以下为当前基线源码事实，尚不表示项目 files 已实现临时页签。

- 原生没有临时/保留页签标志。`sidebar.right.pane.tab.title` keyed 槽可扩展标题，
  `useTabInfo()` 提供 tab id、panel id、navigation、actions、signal；原生 TextTitle 提供文件图标和名称。
- `ctx.sidebarRight.openResource(address, { replaceTab: tabId })` 可替换指定页签；tab 自身的
  `actions.openResource(address, { replaceTab: true })` 替换的是调用者自己，不能在文件树 tab 上直接调用后者。
- 替换是一次原子布局操作：借用旧 docked tab 的 pane 和 strip 位置，打开新 occurrence，再关闭旧 occurrence；
  不保证 tabId 不变。关闭会 abort 旧 signal，正文读取状态仍归原生预览管理，不手改 contentId。
- 原生资源按 `(kind, contentId)` 跨 pane 去重，默认 `revealIfOpened:true`。命中既有 tab 时也会关闭
  `replaceTab` 指定的另一 tab；因此“聚焦已打开文件”不应盲目附带 replaceTab。
- `openResource` 返回 void，没有公开的新 tabId 回调；增强需通过标题槽的 live 信息确认落点，不能猜 id
  或私读布局 store。tab signal 仅在 tab 消失/宿主插件卸载时 abort，切换 tab/会话或 body 卸载不等于关闭。
- 浮动 tab 的替换不继承浮动位置。移动/浮动后的临时页签需要明确策略，不能继续按旧 pane 关联替换。

### Sidebar 首次打开的默认页

出处：`packages/client/ui-sidebar-right/src/client/contract/seed.ts`、`tabs/guide/GuideBody.tsx`（同包 client 下）；
0.1.6 的子槽与终端定制入口另核对已安装包的 `@deepseek-ai/dsh-client-ui-sidebar-right/lib/client.js`、
`@deepseek-ai/dsh-client-ui-sidebar-terminal/lib/client.js`。

- `defaultSeed` 在仅有一个 guide 入口时直接选择该入口的页面 kind；零个或多个入口时选择 `guide`。
  不要为了强制显示 guide 增加虚假的页面类型与 guide 入口。
- guide 的原生正文从已登记的页面类型生成入口；`sidebar.right.tab.guide` 是 chain，非拒绝的
  插件项会**整体替换**原生正文，不会自动保留其它入口。已安装的 0.1.6 中每个入口还能经
  `sidebar.right.tab.guide.entry` keyed 子槽由登记方定制（新建终端有原生下拉），不能用单文件入口
  的整页替代品吞掉它。files 只增强原生文件树，不注册 guide chain/entry。
- guide 中选择入口通过该 guide tab 的 `actions.openTab(kind, { replaceTab:true })` 替换 guide 自身。

### 页签右键菜单与关闭范围

出处：`packages/client/ui-dockkit/src/components/{TabPanel.tsx,TabMenu.tsx}`、
`packages/client/ui-sidebar-right/src/client/{contract/slots.ts,stores.ts,shell/SidebarRight.tsx}`。

- 原生 TabMenu 提供关闭项，并在其后渲染 `sidebar.right.tab.menu.item` list 槽；该槽为 session scope，
  owner 提供右键目标 `tab` 与 `dismiss()`，没有 paneId 或分栏页签列表。动作必须自行 dismiss。
- 非激活页签的右键不会先激活它，故批量关闭必须以右键目标所在 pane 为准，不能使用 active pane 代替。
  `data-dockkit-pane`、`data-dockkit-tab` 可用于当前版本只读、局部归属核验，不是稳定的布局查询 API。
- 原生关闭拒绝不存在的 tab，并保护唯一 docked guide；关闭最后一个非 guide docked tab 会收起 Sidebar。
  增强应沿用关闭入口及布局规则，不直接删布局记录或循环清除新出现的默认页。
- 项目「关闭其他/关闭全部」仍为待实施方案：固定当前分栏 tabId 快照并逐项核对存活/归属，不越过分栏或会话边界。

## 主题与对齐

### 原生主题偏好的作用域

已按 0.2.0-rc.2 的 ui-theme、ui-settings、config-editor 源码核对；本地旧 checkout 不作为此结论基线。
出处：`packages/client/ui-theme/src/{index.ts,theme-settings.ts,boot-theme.ts,client/index.ts}`、
`packages/client/ui-settings/src/client/config-form.ts`、`packages/boot/config-editor/src/index.ts`。

- 三态为 `light/dark/system`，默认 `system`；宿主配置为原生 `ui-theme` 行的 volatile `config.preference`。
  ConfigEditor 写活动 profile 的 `cordis.patch.yml`，不是浏览器 localStorage。
- 客户端公开服务为 `ctx.theme`：`getTheme()` 读快照，`setTheme()` 改偏好，`theme/change` 通知变化；
  内部通过 `configForms.get('ui-theme')` 订阅配置。`setTheme()` 本身返回 void、先本地更新，不能当作持久化成功的回执。
- 可访问宿主设置的客户端共享同一宿主/profile 的持久化偏好；不是每个浏览器独立保存。
  缺少可写宿主设置时不能承诺跨客户端持久化同步。`system` 只共享选择，各设备自行按操作系统解析明暗。
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

图标与文字对齐先用嵌套 flex；外层 stretch，各块内部 align-items:center。
汉字墨迹中心与 SVG 几何中心仍可能相差约 1.5px，图标格可用 translateY(0.115em) 做光学补偿。
具体量法见 flex-centering skill；图标尺寸必须放入真实相邻导航行比较。

### 插件配置表单

出处：`packages/client/ui-settings-plugins/src/client/fields.module.css`、`fields.tsx`。
编写主题样式先加载项目 [dsh-theme skill](../../.agents/skills/dsh-theme/SKILL.md)，
其中包含级联、原生控件与深浅主题验证方法；新经验经验证后自动合并回技能。

- 字段使用 34px 内容高度、水平 12px padding、0.5px border-l4、8px 圆角、bg-layer-3，
  文字为 13px / 1.5 / label-primary；核对 content-box 与实际渲染高度，不能只抄 height。
- 内置字段 `:focus-visible` 取消 outline，只将原有边框改为 brand-primary，不叠加粗外圈。
  下拉触发按钮用 `:focus` 同时覆盖鼠标与键盘，`[aria-expanded='true']` 在菜单内获得焦点时保持边框色；
  不能移除轮廓后丢失可见焦点反馈。
- 默认与焦点/禁用态的 border、color 放在局部 CSS；inline border/color 会压过普通伪类规则。
  禁用态使用 label-tertiary、default cursor，同时保留原生 disabled 语义。
- `appearance:none` 不会自动移除 UA 焦点 outline，也不会统一 OS 原生 select 弹层的 hover。
  卡片 header 的 2px 键盘焦点圈不受字段规则影响。
- 设置 → 模型里的原生字段基准来自 `packages/client/ui-settings-models/src/client/ModelsSection.module.css`：
  `border-box`、32px、0.5px border-l4、8px、bg-layer-1、14px/22px、brand focus；select
  额外保留右侧 12px chevron。`model-capabilities` 的三个能力/协议 select 必须跟这个基准，
  不能退回 1px border-l1、透明背景或 UA focus。
- 设置 → 代理与全局提示词是项目自有原生 input/textarea；它们也必须给出局部 focus/disabled
  状态，避免实际页面出现黑色 UA outline。编辑器的等宽字体、较大高度和 textarea 语义可以保留。
  日志/终端输出等 code surface 则是有意的阅读容器，不按表单字段强行改成同一高度；终端实际输入框仍按 dsh
  字段处理，不能因为同在一个 dock 就沿用输出区的 l1/transparent 样式。

### 选项菜单

出处：`packages/client/locale/src/client/LanguageRow.tsx`、`packages/client/ui-primitives/src/Menu.tsx`、
`Menu.module.css`。选项菜单以 dsh external `Menu` 复用页面运行时。

- 选项 hover 使用 `--dsw-alias-interactive-bg-hover`，不要给原生 option 强套 CSS，或修改触发器背景来代替。
- 默认 `selection='check'` 以右侧勾号标记 `selectedId`，选中未 hover 时仍透明；`fill` 会常驻高亮，语义不同。
- 设置页使用 `portal` 避开滚动容器裁剪；Menu 的 `className` 仅给锚点 wrapper，不传给浮层。
- 当前 Menu 无选中项自动聚焦或方向键导航；替换原生 select 时由字段局部补齐箭头/Home/End、
  Enter/Space、Tab/Escape 和选择后焦点归还。外部点击关闭不抢焦点；禁用时关闭菜单并拒绝选择。
- Portal 首帧隐藏以测量尺寸；自动聚焦需等定位提交后（如可清理的下一帧），不能在同轮父 layout effect 中直接 focus。
- Portal 的 React 键盘事件仍到达字段 owner，局部 Escape 应阻止冒泡，避免同时关闭父设置窗口。

### 原生设置面板与桌面顶部留白

出处：`packages/client/ui-settings-general/src/client/SettingsRoot.module.css`；已对照
0.2.0-rc.2 源码核对本节公式。
设置 overlay 为 fixed 的居中 flex；面板高度为
`min(800px, calc(100vh - 2 * max(24px, var(--dsh-frame-overlay-top,24px))))`
（`--dsh-frame-overlay-top` 由 `packages/client/ui-layout/src/client/AppFrame.module.css` 发布：
桌面为 `--dsh-frame-top-clearance + 20px`，浏览器为 20px）；全屏 mask 顶部让出标题栏
（`inset: var(--dsh-frame-chrome-top,0px) 0 0`）。外部留白来自视口高度限制和居中，不是标题/header 的 padding。
dsh 文档未定义该项目变量，沿用36px占位和border-box，不改变原生设置样式。

### Modal 弹窗

出处：`packages/client/ui-primitives/src/Modal.tsx`、`Modal.module.css`。

- 插件传给 Modal 的 `className` 落在 `.dialog` 卡片上：`position:relative`、`overflow:hidden`，
  Modal 不提供自定义 header 插槽；要在关闭按钮旁加自绘按钮，只能绝对定位在卡片内。
- header 布局：padding `22px 14px 12px 24px`，close 按钮 28×28、圆角 8、右侧 14px；
  紧贴其左侧的新按钮用 `top:22px; right:50px`（14+28+8），样式复刻 `.close`：
  transparent 背景、`--dsw-alias-label-secondary`、hover `--dsw-alias-interactive-bg-hover`，保留 UA 焦点轮廓。
- 自绘按钮必须压过插件自己的移动热区（z-index 2）与 resize 手柄（3），公共实现取 `z-index: 4`；全屏图标用
  `IconFullscreenOutline16`（仅有展开方向，无收缩图标，两种状态共用并切换 aria-label）。
- 全屏能力由 `packages/plugin-ui/src/dialog-fullscreen.ts` 提供：`useDialogFullscreen`（进入前保存几何、
  退出写回、窗口 resize 跟随、按 `open`/`identity` 复位）、`dialogFullscreenButtonRule`、`DialogFullscreenButton`。
  几何写入与拖动 resize 共用同一组 custom properties；全屏时插件隐藏拖动与八向手柄。
- 实例：services 日志弹窗（`plugins/services/src/client/log-dialog.ts`）与
  turn-retry 原因弹窗（`plugins/turn-retry/src/client/reason-dialog.ts`）共用同一实现，
  只有 dialog class、data 属性名和图标不同。

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

@deepseek-ai/dsh-client-ui-primitives 必须 external，复用页面已有组件与 CSS。
dsh `0.1.5-rc.2` 将通用文件图标统一为 `FileTypeIcon`（用 `path` 或 `kind` 选择类型），不再导出旧的
`DocumentFileIcon`；项目浏览器插件应使用新接口，并在需要时显式传 `size`。该包带 CSS，不能在 environment:node
单元测试中直接 import 含它的浏览器模块。

## 插件包约定（dsh 0.1.7）

- **peer 版本准入**：dsh 在 profile 装载时校验插件 `peerDependencies` 里的
  `@deepseek-ai/dsh*` 声明与运行时版本，不匹配即拒载整行（官方豁免通道是 profile
  `compatibility.json`）。本项目插件对 dsh 包只有类型引用，统一放 devDependencies，
  **不得**把它们声明成 peerDependencies。
- **显示元数据**：插件页/设置清单的标题与描述来自各包 `locale/{en,zh}.json` 的
  `meta.title/description`（exports 需含 `./package.json` 与 `./locale/*.json`，
  files 带 `locale`）。文案与 docs/plugins.md 词表一致；`icon` 暂不声明，用默认图。
- **Bundle 静默跳过**：dsh 0.1.7 对解析/清单/patch 失败的 Bundle 不再启动即败。0.1.7-rc.2 起
  profile 装载把跳过项收进 `Profile.skippedBundles`（装载过程本身不打印），CLI 装载完成后调用
  `reportSkippedBundles` 每次启动向 stderr 打一次 `dsh: skipping profile bundle "<包名>": <原因>`。
  排查安装问题时先看这行输出；构建管线的「缺少宿主/浏览器产物」预检仍是必要的前置防线。
- **工具参数 schema**：`ctx.tools.register` 收原始 JSON Schema，只有 `defineTool` 会把属性表简写
  编译成对象根 schema（`parameterSchemaSpecToJsonSchema`，`packages/core/tools/src/schema.ts`）。
  裸注册的 `parameters` 必须自己写全 `type: 'object'` 与 `properties`，属性级 `required: true`
  简写在那里不生效；扁平属性表会原样进入模型请求，被服务端工具定义校验拒绝整轮请求
  （2026-10-09 实测：DeepSeek 返回 400 `invalid_function_parameters`，本地网关包装成
  503 `no_healthy_account`，与被测模型无关；terminal 插件因此改回对象根 schema）。
