# Sidebar 扩展与页签

右侧边栏（ui-sidebar-right）的 tab 类型注册、文件增强、页签与关闭契约。宿主半私有 RPC
与流式响应通道见 [插件机制](plugins.md) 的「宿主半私有 RPC」段；插件适配基线见
[源码依据](02-dsh-facts.md)。

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
  正文可用 `tab.actions.bindCommands({ refresh })` 接上刷新入口。`ctx.sidebarRightTabs` 来自
  `ui-sidebar-right` 的 reflect provide，需加进插件 client `inject`。
- 原生「已编辑 n 个文件」改动面板（`ui-deliverables` 的 changes-review）**不能被插件 import**：
  已发布包外层导出只有 `apply`/`inject`，`files` 列表不含 `src`，且两包不在页面冻结模块表；
  复用只能按其组件结构与 CSS 规则在插件内复刻，公开 primitives 与 `dsh-client-store` 不受影响。
- **inject hooks 的 observable 必须发布不可变快照**：渲染层把 hooks observable 绑定成
  `useSyncExternalStoreWithSelector`（`ui-renderer/src/client/bind.ts`），Object.is 比较快照
  引用，引用不变就不重跑 selector——插件拿原地修改的 Map/对象当快照时，通知照发但组件永远
  停在首次渲染（2026-10-14 files Git 变更面板实机定位；回归测试
  `plugins/files/src/client/gitReviewBinding.spec.tsx` 守护）。
- 页面包的 `package.json` 用 `dsh.client.inject` 声明对 `@deepseek-ai/dsh-client-ui-sidebar-right` 的模块关系；Cordis 运行时仍把 `sidebarRightTabs` 放进插件 `inject`，两者不是同一种依赖。
- **跨会话打开与 keepMounted（0.2.2-rc.1 核实，交互终端 tab 实例）**：`openTabIn(sessionId, kind, options?)` 可为任意已装配会话打开页面 tab（含休眠会话，未装配时静默）；`close(tabId)` 只作用于前台会话（非前台抛错）；`openTabs`（observable）发布窗口内全部已开 tab 的 `{ sessionId, tabId, kind, contentId }`（含 localStorage 恢复的休眠布局）；tab 的导航 params 经 `ctx.sidebarRight.tabDomain.occurrence(sessionId, { id }).navigation.getSnapshot()` 读回。`multiple: true` 的 page 每次 open 铸全新 `sidebar://<kind>/<uuid>` contentId，**永不去重**——tab↔内容的绑定靠插件自己的持久化（官方 TerminalBindings / 本仓库 bindings 同款：localStorage 按 (sessionId, contentId) 存资源 id，布局恢复后 params 丢失时找回）。`keepMounted: true` 让访问过的 body 跨收起/切会话/停靠保持挂载；`useTabInfo().tab.visible` 仅前台会话且展开且为 active chip 时 true。
- **`useTabInfo` 由槽声明方自动绑定**（`rightbar.session` 的 children 声明自带 `hooks.tabInfo`），插件注册 body 只需提供业务 inject；`title(address)` 在 tab 打开时捕获一次，动态标题才注册 `sidebar.right.pane.tab.title`；`registerCloseHandler(kind, handler)` 在显式关闭前同步运行，**抛错即否决关闭**（保留 tab）——可用于二次确认，收起/切会话/插件卸载都不触发它，occurrence 的 abort signal 只在记录消失或插件卸载时触发；definition `guide: [{ id, order, title, description?, icon }]` 的 icon 是 `ComponentType<IconProps>`（primitives `*OutlineRegular` 16px 族）。

### 原生文件增强的复用边界

出处：`ui-sidebar-right/src/client/{tab-registry.ts,service.ts,contract/slots.ts}`、
`ui-renderer/src/client/registry.ts`、`ui-slots/src/index.ts`、`web/src/platform.ts`。文件能力见 [工作区](workspace.md)。

- 同 kind 共存只允许一组 builtin + extension；原生 `files` 可以这样接管，guide 只列生效项，
  卸载 extension 后恢复 builtin。`text` 属于 fallback，不能用 extension 同 kind 重注册，二者会冲突。
- `ctx.sidebarRight.split(paneId)` 返回新 pane id 或 undefined；dockkit 默认预算四个 docked pane，
  controller 在已有两个时拒绝分栏。`tab.actions.openResource(address, { paneId })` 可指定 pane，
  但分栏本身不会改变原生树「在自己的 pane 打开文件」的行为。
- `FilesBody` 与 `TextPreview` 没有从各包 client 入口导出为运行时值，两包也不在平台共享模块表；
  不能仅添加 external 就假定浏览器能 import 它们。发布 files 列表也不包含源码，不能依赖 `./src/*` 导入。
- `slots.entries` 是登记快照，不是通用组件嵌入 API；files 增强只把它作为版本受控的适配 seam：
  shadow 登记完整复用原 entry 的 component、store、inject、locale，并只在外层观察/事件委托。
- **0.2.0-rc.2 起原生 FilesBody 声明 children 并在渲染期调用 `props.renderSlot`**（`sidebar.right.tab.files.actions`，
  list/session，官方 ui-open-in-app 往里注册「打开方式」）。影子条目不声明 children 就拿不到 renderSlot prop，
  内嵌的原生组件抛 `TypeError: renderSlot is not a function`，增强静默丢失（`standardKit` 只给声明
  children 的条目装配 renderSlot/SessionProvider，无公开途径借得原生绑定）；重复声明同一 child slot
  会在 register 抛错，影子包装在 0.2.0 契约下不可行。files 已改为 DOM 级挂载（MutationObserver 发现
  `[data-files-state]` 树根 + 捕获事件，`nativeFilesAdapter.tsx`；2026-11-10 起右键也交给原生
  `ctx.contextMenus` 贡献，自绘菜单已删除）；
  title 座位（`sidebar.right.pane.tab.title`）的影子仍可用：documentpreview 的 title 注册不带 children。
- Slot 的子槽由唯一登记 owner 声明并持有 render 授权；对现有 cell 加 priority:-1 不会继承原登记项的 children。
  files 不重声明 `sidebar.right.tab.document`，不覆盖 `ui-sidebar-documentpreview` owner；ctx 级 renderSlot 只能渲染 root，
  不能把原生预览拆出来任意嵌入另一个 body。图片增强改在原生 text title slot 以 portal 控件定位已渲染 image frame，
  不复制 ImageBody。ZoomViewport 以 `data-document-zoom-scrollport` 标识自身滚动容器；Space+鼠标平移只滚动该容器。
  portal 内的交互控件必须同时阻止 `pointerdown` 和 `click` 冒泡——dockkit 的原生 tab 会在 pointerdown
  启动拖动/重建，不阻止时浏览器可能把 portal 按钮的后续 click 重定向到 tab（与 `ui-dockkit` TabMenu 同规则）。

### 临时预览页签的可用接口

出处：`ui-sidebar-right/src/client/{service.ts,tab-domain.ts,stores.ts,contract/slots.ts}`、
`ui-sidebar-documentpreview/src/client/TextTitle.tsx`。以下为基线源码事实，尚不表示项目 files 已实现临时页签。

- 原生没有临时/保留页签标志。`sidebar.right.pane.tab.title` keyed 槽可扩展标题，
  `useTabInfo()` 提供 tab id、panel id、navigation、actions、signal；原生 TextTitle 提供文件图标和名称。
- `ctx.sidebarRight.openResource(address, { replaceTab: tabId })` 可替换指定页签；tab 自身的
  `actions.openResource(address, { replaceTab: true })` 替换的是调用者自己，不能在文件树 tab 上直接调用后者。
- 替换是一次原子布局操作：借用旧 docked tab 的 pane 和 strip 位置，打开新 occurrence，再关闭旧 occurrence；
  不保证 tabId 不变。关闭会 abort 旧 signal，正文读取状态仍归原生预览管理，不手改 contentId。
- 原生资源按 `(kind, contentId)` 跨 pane 去重，默认 `revealIfOpened:true`；命中既有 tab 时也会关闭
  `replaceTab` 指定的另一 tab，因此“聚焦已打开文件”不应盲目附带 replaceTab。
- `openResource` 返回 void，没有公开的新 tabId 回调；增强需通过标题槽的 live 信息确认落点，不能猜 id
  或私读布局 store。tab signal 仅在 tab 消失/宿主插件卸载时 abort，切换 tab/会话或 body 卸载不等于关闭。
  浮动 tab 的替换不继承浮动位置，移动后的临时页签需要明确策略。

### Sidebar 首次打开的默认页

出处：`packages/client/ui-sidebar-right/src/client/contract/seed.ts`、`tabs/guide/GuideBody.tsx`（同包 client 下）。

- `defaultSeed` 在仅有一个 guide 入口时直接选择该入口的页面 kind；零个或多个入口时选择 `guide`。
  不要为了强制显示 guide 增加虚假的页面类型与 guide 入口。
- guide 的原生正文从已登记的页面类型生成入口；`sidebar.right.tab.guide` 是 chain，非拒绝的
  插件项会**整体替换**原生正文，不会自动保留其它入口。每个入口还能经
  `sidebar.right.tab.guide.entry` keyed 子槽由登记方定制（新建终端有原生下拉），不能用单文件入口
  的整页替代品吞掉它。files 只增强原生文件树，不注册 guide chain/entry。
- guide 中选择入口通过该 guide tab 的 `actions.openTab(kind, { replaceTab:true })` 替换 guide 自身。

### 页签右键菜单与关闭范围

出处：`packages/client/ui-dockkit/src/components/{TabPanel.tsx,TabMenu.tsx}`、
`packages/client/ui-sidebar-right/src/client/{contract/slots.ts,stores.ts,shell/SidebarRight.tsx}`。

- 原生 TabMenu 提供关闭项，并在其后渲染 `sidebar.right.tab.menu.item` list 槽；该槽为 session scope，
  owner 提供右键目标 `tab` 与 `dismiss()`，没有 paneId 或分栏页签列表。动作必须自行 dismiss。
- 非激活页签的右键不会先激活它，故批量关闭必须以右键目标所在 pane 为准，不能使用 active pane 代替。
  `data-dockkit-pane`、`data-dockkit-tab` 可用于当前版本只读核验，不是稳定的布局查询 API。
- 原生关闭拒绝不存在的 tab，并保护唯一 docked guide；关闭最后一个非 guide docked tab 会收起 Sidebar。
  增强应沿用关闭入口及布局规则，不直接删布局记录或循环清除新出现的默认页。
- **工作区分组排序（0.2.2-rc.1，user-message-fork 落位实例）**：出处
  `packages/client/ui-workspace/src/client/{tree.ts,stores.ts,pin-order.ts,navigation.ts,rows/WorkspaceBrowser.tsx}`。
  - 视图菜单两模式：`manual`（手动）/ `updated`（按更新时间，**默认**）。渲染顺序都经过
    `sectionMembers`：blank 占位 → **pin 段** → 其余（按所选顺序）→ 归档位；即 pin 在两种模式下都
    领跑分区（旧版结论「updated 无视 pin」已按源码更正）。
  - `updated` 模式走 `orderByRecency`（`summary.updatedAt = max(header.createdAt,
    sessionListMetadata.lastPromptAt)`，`packages/api/session-controller/src/list.ts`）。fork 子会话的
    header `createdAt` 是 fork 时刻（`core/session/src/index.ts`：`createdAt: meta?.createdAt ?? Date.now()`，
    fork 不传 `createdAt`），所以该模式本来就把子会话排在最前。
  - `manual` 模式走 `reconcileManualOrder`：已存顺序保持相对次序 → 再按 pin → 新成员按 recency →
    归档。**新会话因此追加在已存条目之后**（fork 子会话在会话多的分组里会沉到靠后位置）。
  - 手动顺序是浏览器本地状态：`defineStore({persist:'dsh.workspace.view.v5'})` 的
    `sessionOrderByAccount`（账户键 = 工作区 id、`''`（未分组）、`'__flat_session_order__'`）。
    拖动排序（`setSessionOrder`）只写它；宿主 `workspace.insertSessionBefore` 不参与显示顺序。
    原生置顶按钮 = 宿主 `pinSession` + 视图 store 的 `pinSessionOrder`（把该会话在分组与扁平账户前置）。
  - 因此「fork 后排在第一位、但不置顶」只能复用视图 store 的 `pinSessionOrder`（不调宿主 pin）：
    插件从 `sidebar.workspaces` 槽位条目拿到同一个 store 句柄（`entry.store.create()` 返回
    单例实例），见 [用户消息分叉](../plugins/user-message-fork/README.md)。
- 项目「关闭其他/关闭全部」仍为待实施方案：固定当前分栏 tabId 快照并逐项核对存活/归属，不越过分栏或会话边界。
