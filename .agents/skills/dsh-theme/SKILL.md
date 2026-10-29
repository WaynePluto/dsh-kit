---
name: dsh-theme
description: 编写或调整 dsh 插件的主题样式，处理表单焦点、边框、背景、深浅主题、卡片、菜单与原生 UI 一致性。涉及 dsh UI/CSS/主题 token 时先加载；完成后自动将本次已验证、可复用的新经验合并回本技能。不适用于业务逻辑或独立于 dsh 的页面；图标文字对齐同时加载 flex-centering。
---

# dsh 主题样式

目标：插件看起来属于当前 dsh，而不是独立设计一套皮肤。保留语义、键盘可达性和既有业务行为。

## 开始前

1. 读取本仓库根的 `AGENTS.md`、`docs/dsh/plugins.md`、目标插件 README。
   本技能目录向上三级即仓库根；以上路径相对仓库根。
2. 加载相邻的 `../dsh-source/SKILL.md`，从中获取唯一的上游源码根与版本。
   下文所有 `packages/client/...` 路径相对 **dsh 源码根**，不是本仓库。
3. 找到用户对照的**同一类控件**的 TSX、CSS 和实际 DOM，再动手；不要凭截图颜色猜 token。
   通用 `Input`、插件配置字段、卡片 header 的焦点方案并不相同。
4. 涉及图标/文字对齐时加载 `../flex-centering/SKILL.md`，不要复制其量法或随意补位移。

## 官方样式查证入口

| 目标 | 上游相对路径 |
|---|---|
| 主题 token 的定义与主题覆盖 | `packages/client/ui-theme/src/styles/design-platform.css` |
| 插件设置表单（本次修复基准） | `packages/client/ui-settings-plugins/src/client/fields.module.css`、`fields.tsx` |
| 插件卡片与 header 焦点 | `packages/client/ui-settings-plugins/src/client/PluginCard.module.css`、`PluginCard.tsx` |
| 模型设置字段与原生 select | `packages/client/ui-settings-models/src/client/ModelsSection.module.css`、`ModelsSection.tsx` |
| 通用输入框 | `packages/client/ui-primitives/src/Input.module.css`、`Input.tsx` |
| 菜单与图标 | `packages/client/ui-primitives/src/Menu.tsx`、`Menu.module.css`、`icons/index.tsx` |
| 语言下拉（选项 hover 基准） | `packages/client/locale/src/client/LanguageRow.tsx` |
| Dock 样式基准 | `packages/client/ui-conversation/src/client/skeleton/TodoPanel.module.css`、`TodoPanel.tsx` |

当前表单结论核实于 `@deepseek-ai/dsh@0.1.5-rc.2` / `fb2c4b9e69`。升级需重新读对应源码，不能把数值当永久契约。

## 实施顺序

### 1. 复用组件，不跨包偷取私有 CSS

- 已有合适的公共 primitive 就复用。`@deepseek-ai/dsh-client-ui-primitives` 保持 external，
  让实际 dsh 页面提供组件与 CSS；不要把其运行时/CSS 再打一份进插件。
- 没有公共组件时，用插件命名空间 class 或 CSS module 复现该控件的最小样式契约。
  不引用上游构建后哈希类名，不全局覆盖 `input`、`select`、`button` 或 `:focus`。
- Node 单元测试不能直接 import 带上游 CSS 的浏览器模块；静态契约测试只作防退化检查，不宣称验证了视觉。

### 2. 区分默认、焦点、展开、禁用状态

`appearance: none` **不等于**移除 UA 焦点轮廓。
没有显式焦点规则的控件可能叠一圈粗黑边，而 dsh 插件字段仅变细边框颜色。
下拉触发按钮采用字段边框，选项弹层复用官方 `Menu`；二者不能混为同一层样式。

`plugins.bundle.config` 已经渲染在 Bundle 详情页自己的配置 section 中；该槽的组件应直接输出字段、状态和操作区，不要再套一张完整卡片、重复标题或折叠 header。`plugins.item` 才是需要自行提供 summary/page 内容的官方分组入口。依据：`packages/client/ui-plugin-manager/src/client/PluginManagerPage.tsx`。

官方插件配置字段契约：

| 属性 | 值 |
|---|---|
| 内容高度 / 水平 padding | `34px` / `12px` |
| 默认边框 | `0.5px solid var(--dsw-alias-border-l4)` |
| 圆角 / 背景 | `8px` / `var(--dsw-alias-bg-layer-3)` |
| 文字 | `font: inherit`，`13px`，`line-height: 1.5`，`--dsw-alias-label-primary` |
| 焦点 | `outline: none` + `border-color: var(--dsw-alias-brand-primary)`，不改变边框宽度 |
| 禁用 | `--dsw-alias-label-tertiary`、`cursor: default`，同时使用真正的 `disabled` |

官方文本字段使用 `:focus-visible`；下拉触发按钮需同时覆盖点击展开与键盘聚焦，使用 `:focus`，
并在 `[aria-expanded='true']` 保持主题色边框（菜单项获得焦点后触发按钮已不再 focus）。
不能只关 outline 而没有可见的替代焦点反馈。卡片 header 仍保留官方的 2px 键盘焦点轮廓，
不要把表单的「无外圈」规则扩散到按钮、卡片或整页。

- **状态属性不要写死在 React inline style。** 普通 class 的 `border-color`、`color` 覆盖不了
  inline `border`、`color`；把默认值与状态规则放在同一局部 CSS 中，不用 `!important` 补救。
  本次审计在 proxy 的 input/textarea、agents-md 的 textarea 和 terminal dock 的输入框实测到 1px border-l1/透明背景
  或黑色 UA outline；这与 dsh 主题字段不一致。移除 inline 的 border/background/color，让局部 class 同时管理默认、focus、disabled。
  terminal 的输出 `<pre>`/日志框仍是有意的 code surface，不应误套输入框高度；同一个 dock 内也要按交互语义区分。
- 模型设置页是另一套已核实的字段基准，不能把插件字段的 34px 直接套过去：
  `ModelsSection.module.css` 的 `.input` 为 `border-box`、32px、0.5px border-l4、8px、
  bg-layer-1、14px/22px；`.input:focus` 用 brand-primary，`.selectInput` 右侧 12px SVG chevron。
  插件注入模型设置的 select（如 model-capabilities）先对照这一套，再决定是否使用 Menu。
- 高度要连同 `box-sizing` 检查。官方此处是 content-box；直接给 border-box 控件写 `height:34px`
  并不等高。自定义字段须用 flex 分配宽度、`min-width:0` 和 content-box，避免 padding 撑出父容器。
  `0.5px` 可能按 DPR/缩放取整，不要拿截图物理像素反推 CSS 宽度。本次 Chromium DPR=1
  的真实 dsh 页面中，两者均测得 36px 外高、1px 渲染边框；深浅主题的字体、底色、默认/焦点颜色一致。
- 右侧原生 outline 图标留足 padding；图标 `pointer-events:none`，不要截走点击。
- 保留标签关联、当前值、禁用语义；换组件时不能仅保留外观而丢失键盘可用性。

### 3. 选项 hover：先区分 OS 弹层与 dsh Menu

用户反馈「下拉 hover 太深」，先看截图指的是**触发器**还是**展开后的选项行**。
只修输入框的焦点边框不能解决后者；原生 `<select>` 弹层受浏览器/OS 控制，
`option:hover`、`appearance:none`、给 select 换背景都不能可靠地统一其高亮。

以语言菜单为基准时，直接复用 external `Menu`，不复制一套选项 DOM / CSS：

- `items` 提供内容，`selectedId` 标记当前草稿值；默认 `selection='check'` 是右侧勾号，
  非 hover 时选中行仍透明。不要用 `selection='fill'` 伪装 hover，否则选中项会一直染底色。
- 菜单项 hover 由 `Menu.module.css` 的 `.item:hover:not(:disabled)` 提供，token 为
  `--dsw-alias-interactive-bg-hover`：当前浅色 `rgba(38,49,72,0.06)`，深色 `rgba(255,255,255,0.08)`。
  值仅用于核验，不硬编码覆盖；浮层背景、阴影、圆角也沿用 Menu。不要改触发按钮色来补偿选项色。
- 设置页有滚动裁剪时用 `portal`，跟语言菜单一样让 dsh 定位浮层、限制视口并处理滚动/resize；
  `className` 只作用于 Menu 的 anchor wrapper，不会传给 portaled list。
- **Menu 不等于完整的 select 行为。** 当前源码只提供原生可聚焦 menuitem 按钮、
  点击选择、外部点击/Escape 关闭；不自动聚焦选中项、不实现方向键导航、不自动归还焦点。
  换掉原生 select 后，在字段组件局部补齐 Enter/Space 打开、箭头/Home/End、Tab、选择/取消焦点归还。
- **Portal 的首帧是 `visibility:hidden` 测量态。** 父组件在同轮 layout effect 直接 `.focus()` 会失败，
  即使 ref 已经存在；应等 Menu 完成定位提交后再聚焦，例如可清理的 `requestAnimationFrame`。
  关闭/卸载时取消待执行帧，浏览器测试也要等待实际焦点，而不是只断言菜单已经渲染。
- Portal 的 React 键盘事件仍冒泡到字段所属组件。局部消费 Escape 并 `stopPropagation()`，
  防止关闭菜单同时触发宿主 document 的设置窗口关闭；外部点击关闭不能强行抢回焦点。
  不挂全页拦截器，不移动上游 React DOM，也不根据哈希类名查找菜单项。
- 禁用时关闭弹层，trigger 与 items 都禁用，`onSelect` 再拦一次；选择仍只更新草稿，保存语义不变。

已安装 dsh 的语言菜单与插件菜单共用 `Menu`：选中未 hover 时保持透明。
后续仍需在实际页面检查键盘焦点返回、滚动定位和父设置窗口是否仍在；静态 CSS 检查不能替代这些测试。

### 4. 用 token，但也检查真实值

- `border-l1/l2/l4` 的 `l` 是字母，不是数字 `1`；不能盲目选最淡的 `l1` 给所有表单。
  实际 CSS `0.5px` 在 Chromium DPR=1 可能显示成 1px；应比较 computed token/宽高，不要把渲染取整误判成代码写了 1px。
- `--dsw-alias-brand-primary` 随主题变化；不要为了浅色截图把焦点色写死为黑色。
- 浅色 `bg-layer-1/2/3` 都是白，`bg-layer-4` 无定义；嵌套面需要边框等额外层次，不靠虚构 token。
- 抬升面用 `--dsw-specific-tip`；文字按 primary/secondary/tertiary 层级。
- 等宽字体用 `var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)`；
  `--dsw-font-mono` 可能没有定义。
- 已有 Dock 规则以仓库根 `docs/dsh/plugins.md` 为准，图标光学补偿须先量后改。
- **0.1.x → 0.2.0 的 alias 层整体改名 `--dsh-alias-*` → `--dsw-alias-*`**（design-platform.css 已无任何
  `--dsh-alias-*` 定义）：插件样式里残留旧前缀会静默失效，无 fallback 时回落继承值（2026-10-14 在
  files 插件 styles.ts 实测九处残留）。但 `--dsh-content-font-size*`、`--dsh-scrollbar-*` 与
  `--ds-font-family-code`（字体族，非 alias）仍是合法前缀；升级或排查主题问题时先 grep 插件样式里的
  `--dsh-alias`。diff 行配色有专用 token：`--dsw-alias-file-diff-{added,deleted}-{bg,gutter,marker}`，
  空侧行用 `color-mix(in srgb, var(--dsw-alias-interactive-bg-hover) 50%, transparent)`。

### 复刻上游 CSS module 面板（组件不可 import 时）

上游组件不在发布物导出里（client 入口只导出 `apply`/`inject`，`files` 列表不含 `src`）时，
「复用原生面板」的正确形态是：按同版本上游 `*.module.css` 的规则逐条翻译成插件命名空间类
（前缀 + kebab-case），组件结构照抄、公开 primitives（Menu/Tooltip/PathLabel/`useCodeHighlighter`、图标）
照常 external 引用；不复制上游哈希类名、不深层 import 源码。data 属性换成插件自己的
（如 `data-dsh-files-gr-*`），选择器里的 `data-review-*` 等原生钩子同步改名。翻译时逐条核对
grid 列模板、`min-height` 行高、`white-space: pre` 与 wrap 分支选择器，这些是布局等价的关键。
实例：files 的 Git 变更面板 `plugins/files/src/client/{gitReviewTab.tsx,styles.ts}`
（对照 `ui-deliverables/src/client/{FileDiff,ReviewTab}.module.css`，0.2.0-rc.2）；
真实页面并排 computed 对比与深浅主题验收仍需单独做。

### Shadow 渲染器外包 wrapper 时不要复制官方的百分比宽度上限

官方 user 消息链路是「整行宽 `.userRow` → 收缩适配 `.userStack`（`max-width: min(calc(var(--dsh-chat-content-width) * 0.702), 82%)`）」。
插件 shadow renderer 曾在这层之外再包一个同上限 wrapper：每层都 `align-items: flex-end`（宽度收缩到内容），
内层官方 `.userStack` 的 82% 百分比改对「已收缩到内容自然单行宽」的 wrapper 解析，气泡被钳成 0.82 × 自然单行宽——
短消息反而必然折行（文件引用 chip 是 `display: inline` + `overflow-wrap: anywhere`，会在文件名中间断开）。
规则：官方 factory 输出根节点已自带布局上限时，插件行容器只做对齐与 gap，不重复任何 `max-width`，
让百分比上限对整行宽父级解析。依据 `packages/client/ui-chat/src/client/chat/{MessageItem.module.css,UserContent.tsx}`；
本仓库实例 `plugins/user-message-fork/src/client/styles.ts`（2026-10-21 源码定位，styles/component 单测锁定回归）。

### 设置导航与正文覆盖

当前 `settings.section` 的 priority shadow 只影响正文 renderer；`ui-settings-general/src/client/index.ts`
直接用原始 `slots.entries` 投影菜单，会把原条目和 shadow 条目都显示出来。增强现有页面时不能假定
“同 id 只出现一个菜单”，测试必须连同导航登记检查；不需要页面定制时不要添加登记项。
此导航例外核对于 0.1.6-alpha.2 产物，0.1.7-rc.1 待复测；不代表所有 list 槽的 owner 都有同样行为。

### 注入原生 portaled 菜单（无槽位表面）

给没有插件槽位的原生菜单（如工作区行 `···` 菜单，只有会话行菜单有
`sidebar.workspaces.session.menu.item`）加条目时，只能 DOM 注入，四条源码核实的契约
（`packages/client/ui-primitives/src/Menu.tsx`、`ui-workspace/src/client/rows/Rows.tsx`）：

- portal 菜单直接挂 `document.body`，形态 `MenuSurface[role=menu] > div[role=presentation]`（viewport）
  `> rows`；注入点选 viewport，行用 external `MenuItemButton` 渲染（micro `createRoot`，react-dom
  须进构建模块表；18.3.1 主出口含 `createRoot`，bundle 的 `require("react-dom")` shim 可用，
  files 的 menuHost 同款）。危险项收尾的原生次序用 `insertBefore` 最后一行保留。
- 方向键走查读 DOM（`querySelectorAll('button:not(:disabled)')`），注入的 `button[role=menuitem"]`
  自动加入导航；Escape 在 document 捕获层关闭并归还锚点焦点——注入项拿不到 owner 的
  onSelect，点击后用 `document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))` 代偿关闭。
- **`closeOnPointerLeave` 菜单必须补偿 enter/leave（两拍 + 离开）**：宿主 wrapper 的
  `onPointerLeave` 会 armClose（200ms 宽限，`pointer-grace.ts`），唯一取消路径是 wrapper 的
  `onPointerEnter`（React 从 pointerover 推导）。注入行在独立 React 根里，跨根 over/out 过渡
  没有共同祖先，React 把**离开侧整条祖先链**都派发 leave——它在两个事件上各发生一次：
  `pointerout`（离开原生行）和紧随其后的 `pointerover`（进入注入行本身，会**再次** armClose）。
  因此同步补偿不够（任何同一事件内的同步代码都先于 React 在 body 上的监听运行），必须：
  容器 `pointerenter` 立即向 viewport 合成派发 `pointerover`（bubbles、relatedTarget null）
  取消第一拍；`pointerover` 里 `setTimeout(0)` 再派发一次，覆盖 React 处理完该事件后挂上的
  第二拍（实机两度复现，第二拍是首版修复失败的原因）。移回原生行时宿主自己的 enter 会取消，
  无需处理；从注入行直接移出菜单时宿主收不到任何 leave（不关闭），需在 `pointerout`
  （relatedTarget 不在 viewport 内时）补一次 viewport 上的合成 `pointerout` 让宿主正常 armClose。
- 归因用宿主行的稳定 `data-*` 属性（工作区行 `data-row-key="workspace:<id>"`）：捕获点击开
  一次性短窗口（约 600ms），MutationObserver 认领窗口内出现的 `[role=menu]`；非行菜单
  （无 `button[role=menuitem]`）不消费归因。上游类名/结构变化会静默失效，升级需复核。
- 实例：`plugins/workspace-path/src/client/menuPath.ts`（工作区菜单「复制路径」）；
  契约细节记录在仓库根 `docs/dsh/workspace.md` 的「工作区列表与 ··· 菜单」。

### 0.2.0 菜单面是 MenuSurface 半透明磨砂，不要自绘背景

dsh 0.2.0 起菜单/下拉表面是半透明磨砂设计：`--dsw-specific-menu`（= `--dsw-menu-surface-fill`，
浅色 rgba(248,249,250,.58)/深色 rgba(67,69,74,.45)）必须搭配 primitives `MenuSurface` 组件内的
`z-index:-1` 材质层（`backdrop-filter: var(--dsw-menu-backdrop-filter)` = blur(40px) saturate(150%)，
定义在 ui-theme `gradient-shadow-text.css`；macOS 另有 body 侧 opaque backing 应对原生 vibrancy）。
插件自绘 `background: var(--dsw-specific-menu)` 而不用 MenuSurface = 无模糊纯透明，内容直接透出
（2026-10-10 实机定位 favorite-models 弹窗"变透明"）。正确做法：弹层根用 `<MenuSurface className={几何类}>`
（几何/阴影类保留，删自绘 background 与 border-radius——radius 由 MenuSurface 的 radius-lg 提供）；
分组列表用 `MenuGroup` + `observeStickyMenuGroups(viewport)`（组头 stuck 时由官方切
`--dsw-alias-menu-group-header-fill` 94% 不透明，viewport 须无 padding 直接子级为 MenuGroup）。
验证方式：与同页官方菜单（如账号菜单）对比材质层 computed 值应逐项一致。实例：
`plugins/favorite-models/src/client/FavoriteModelSelect.tsx`。
**静态断言必须随迁移同步**：`--dsw-specific-menu` token 本身仍有效（官方 TodoPanel/QueueDock 等
在用），但迁移到 MenuSurface 的插件 bundle 里不该再出现自绘 `background: var(--dsw-specific-menu)`；
断言应检查「用了 MenuSurface + 保留 `--dsw-elevation-prominent` 抬升阴影 + 无自绘菜单面背景」，
而不是要求已删除的背景 token（2026-10-14 favorite-models-check 陈旧断言实机修正）。

### 独立 React 根的 body 宿主必须零尺寸

插件自建 React 根（`react-dom/client` 的 `createRoot`）挂进 `document.body` 时，宿主 div 若留在文档流内，
哪怕只渲染一个空锚点 `<span aria-hidden>`，行盒也会把 body 撑高一行、触发页面滚动条——打开弹层的瞬间
整个工作台横移一个滚动条宽度（2026-10-10 桌面实测 5px，`bodyClientWidth` 1280→1275）。宿主必须
`position:fixed; top:0; left:0; width:0; height:0; overflow:hidden`；portal 弹层本身是 fixed 定位不受影响。
实例：`plugins/files/src/client/nativeFilesAdapter.tsx` 的 menuHost，回归断言在
`plugins/files/tests/nativeFilesAdapter.spec.ts`。

### 设置分区组件与 Button 原语

设置 `settings.section` 的正文组件沿用 agents-md 实例模式：inline CSSProperties + dsw token
（`--dsw-alias-label-secondary` 等），文字 13px；primitives `Button` 的紧凑档是 `size="sm"`
（无 `compact` 属性，2026-10-10 按 0.2.0-rc.2 类型核对），复制类操作用 `writeClipboard`。
实例：`plugins/agents-md/src/client/index.tsx` 与 `plugins/notify/src/client/NotifySection.tsx`。

### 设置导航的插件图标

当前 dsh `settings.section` 没有 icon 字段，`ui-settings-general` 在导航 cell 内直接渲染一个 SVG。
若插件必须补充语义图标，优先把这个现有 SVG 作为 16px mask 载体，隐藏其子路径，再用
`currentColor` 填充 mask；不要只依赖 `::before` 伪元素，否则 React 重建导航行或旧 WebKit 的
flex 计算可能留下空的图标盒。图标应直接调用 dsh primitives 的对应 component，再把返回的
SVG element 序列化为 mask；项目实例是 `packages/plugin-ui/src/navigation-glyph.ts`，上游依据为
`packages/client/ui-settings-general/src/client/SettingsRoot.tsx`。
0.1.7-rc.1 的 Medium 图标先返回以纯函数 Artwork 为 `type` 的 React element，再由 Artwork 返回 `<svg>`：
序列化时只对受控图标有界展开函数包装，不能直接把第一层当 SVG；递归包装须拒绝，避免页面插件激活失败。
依据为已安装 `@deepseek-ai/dsh-client-ui-primitives/lib/index.js` 与各插件导航图标的单元测试（如 `plugins/agents-md/tests/`）；
Chrome 实测相关插件激活正常，图标深浅主题的视觉效果仍需单独验收。

### Native Sidebar tab 标题包装层的对齐

原生 dock 的 `TabTitle` 本身已经是 `display:flex; align-items:center; gap:5px`，但插件若在 title slot 外包一层
用于斜体、双击或其它状态，新增的 wrapper 会变成外层 flex 的单个 item；不能继续让 SVG 和文本在普通 inline 行盒中按 baseline 对齐。
正确规则是 wrapper 自己 `display:inline-flex; align-items:center; gap:5px; min-width:0; max-width:100%; overflow:hidden;
line-height:1.4; white-space:nowrap`，SVG `display:block; flex:none`。这样既保持原生图标/标题间距，也不让 wrapper 的 inline baseline
把图标顶高或把标题压低。当前 files 实例是 `plugins/files/src/client/styles.ts` 的
`.dsh-files-preview-tab-title`；真实 dsh Chromium 页面测得 wrapper 18.2px，16px 图标 y=16..32，标题墨迹行盒
14.9..32.5，中心差约 0.3px，无需额外 `translateY`。若换字体/字号或出现新的 CJK 残差，仍按 flex-centering 的截图量法复核，
不要直接加 margin/top。

### Sidebar tab body 的高度

右侧 Sidebar 的 tab body 不能默认当作普通 flex 子项：上游 `ui-dockkit/src/components/TabPanel.tsx` 的 `paneBody` 子节点通过 `display: contents` wrapper 放入，`ui-dockkit/src/components/dockkit.module.css` 的 `.paneBody` 自身是带 `overflow:auto` 的 flex item，但不是 flex 容器。现象是 body 根节点若写 `height:0; flex:1`，实际页面中会得到零高度，内容只能溢出到不可滚动的区域。

正确规则：Sidebar 自有 body 的根节点给 `height:100%`、`min-height:0`，内部再用自己的 flex/grid 和滚动面；如果需要 `height:0` 的 flex 填充模型，先包一层明确的 `display:flex; flex-direction:column` 容器。用真实页面的 `getBoundingClientRect()` 同时核对根节点和主内容区高度，不要只看文字是否出现。本仓库 `plugins/files/src/client/styles.ts` 的 `.dsh-files-root` 是实例；本次用临时 dsh 页面验证根节点与树/预览区域均填满 Sidebar。

### 可滚动预览中的固定表头

需要让预览路径/操作栏在内容滚动时留在顶部时，`position: sticky; top: 0` 必须写在实际滚动容器的后代上，并配不透明的 `var(--dsw-alias-bg-base)` 背景和足够的 `z-index`，否则正文会穿过表头。滚动容器在表头上方不要保留 padding：sticky 会停在 padding edge，正文仍可能从表头上方露出；把上方留白移到 sticky 表头自身的 `padding-top`。不要改成 `position: fixed`，那会脱离 Sidebar pane 的滚动坐标和宽度。实例是 `plugins/files/src/client/styles.ts` 的 `.dsh-files-preview` / `.dsh-files-preview-head`；真实 dsh 页面滚动预览区 500px 后，表头 `getBoundingClientRect().top` 与滚动容器顶部一致。

### Modal 弹窗内自绘头部按钮

dsh Modal（`packages/client/ui-primitives/src/Modal.tsx`）没有自定义 header 插槽；插件传的
`className` 落在 `.dialog` 卡片上（`position:relative; overflow:hidden`）。要在关闭按钮旁加按钮，
只能作为 Modal children 绝对定位：close 按钮是 28×28、右距 14、header padding-top 22
（`Modal.module.css` 的 `.header`/`.close`），紧贴其左侧即 `top:22px; right:50px`（14+28+8）。
按钮样式复刻 `.close`：transparent 背景、`--dsw-alias-label-secondary` 图标色、hover 用
`--dsw-alias-interactive-bg-hover`（浅色实测 rgba(38,49,72,0.06)、深色 rgba(255,255,255,0.08)），不写死颜色、保留 UA 焦点轮廓；
base 与 :hover 放同一局部 stylesheet 规则，不用 inline style。若卡片上还有自绘移动热区
（z-index 2）与 resize 手柄（3），按钮要取更高层才能先收到点击（公共实现用 4）。dsh 图标集只有
`IconFullscreenOutline16`（展开方向），无收缩图标，两种状态共用图标、切换 aria-label 即可。
**第二次复用时就该提取**：services 与 turn-retry 的弹窗结构相同，全屏能力现由
`packages/plugin-ui/src/dialog-fullscreen.ts` 提供（`useDialogFullscreen` 负责保存/写回几何、
窗口 resize 跟随、按 `open`/`identity` 复位；`dialogFullscreenButtonRule` 生成样式；`DialogFullscreenButton`
接收调用方传入的图标，本包不依赖 dsh primitives）。插件只保留自己的 dialog class、data 属性名与 class 前缀。
真实页面实测两个弹窗按钮均与关闭按钮逐像素同高（28×28）、全屏 1872×815 对应 viewport−48、
退出后精确恢复原尺寸与位移，深浅主题下图标色跟随 `--dsw-alias-label-secondary`。

### Composer 模型座位旁的伴随控件（conversation.input.right）

要在模型选择按钮左侧放伴随内容，用 `conversation.input.right` list 槽（session 作用域，
官方 0.2.0-rc.2 无占用者）：它在 `ui-conversation` InputBar 的 `standardControls` 内、模型座位
之前渲染，与模型按钮共享 12px gap 与 `align-items:center`；文字基线与触发器对齐只需同节奏
13px/20px（`ModelSelect.module.css` 的 `.trigger`），实测标签中心 Y 与按钮中心 Y 完全一致，
不需要固定高度。两个可复用事实（2026-10-19 model-provider 实机验证）：

- **紧凑模式跟随**：composer 行宽不足时 `observeControlRow` 在 `.row`（CSS module 哈希类）
  上挂 `data-model-compact`，发布 `--dsh-composer-model-text-display: none`；自定义变量会
  级联进槽位占用者，伴随文本用 `display: var(--dsh-composer-model-text-display, inline-flex)`
  即可与模型文字一起隐藏（实测 flex→none→flex）。验证时可手动在 `.row` 上挂/摘该属性，
  不必真缩窗口。
- **主题快速采样**：dsh 深色主题的施加点是 `body[data-ds-dark-theme]`（ui-theme
  `design-platform.css`）。验证纯 token 控件的深色渲染时，在真实页面临时挂/摘该属性再读
  `getComputedStyle` 即可（model-provider 标签浅色 rgb(129,133,140)→深色 rgb(173,178,184)，
  背景 rgb(21,21,23)）；与原生控件的并排视觉验收仍按正常主题切换流程做。


### 原生设置卡操作区注入（模型页 provider-card 槽）

给设置 → 模型的供应商卡片补操作按钮时，槽位 `settings.models.provider-card`（keyed，key =
`settingsNs`）的座位在卡片 `li` 内 rowHead 之后，按钮要与原生「编辑/删除」同行必须 portal 进
操作区 span。定位只许结构化：锚点用隐藏 span，`anchor.closest('li')` 后取
`:scope > div:first-of-type`（rowHead）的 `lastElementChild`（tag 必须是 SPAN，否则是 setup
卡等无操作区形态，一律不渲染）；以 MutationObserver(childList, subtree) + setTimeout(0) 防抖
重扫，宿主 React 重建行时自动重新 portal。不引用构建后哈希类名（如 `zGbnIq_rowActions`），
槽位 props（provider/configured/keyConfigured）才是身份事实。
实例：`plugins/deepseek-official-switch/src/client/CardActions.tsx`、
`plugins/model-capabilities/src/client/ProviderCapabilitiesPortal.tsx`。

注入按钮逐项复刻模型页原生紧凑按钮（`packages/client/ui-settings-models/src/client/ModelsSection.module.css`
的 `.dangerButton` + `.rowActions .dangerButton`，源码核对 0.2.0-rc.2；真实页面深浅主题验收待做）：
`box-sizing:border-box`、28px 高、`padding: 0 10px`、`border-radius: var(--dsw-radius-sm)`、
`font: inherit` 12px/18px、transparent 背景、危险色 `var(--dsw-alias-state-error-primary)`、
hover `var(--dsw-alias-interactive-bg-hover-danger)`、禁用 `opacity: 0.4; cursor: default`、
`:focus-visible` 用 `box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary))`
（模型页按钮无 outline 而是焦点圈，与卡片 header 同案）。次级按钮把颜色换成 label-primary、
加 `0.5px solid var(--dsw-alias-border-l3)`、hover 用 `--dsw-alias-interactive-bg-hover-solid`。
rowActions 自带 `display:inline-flex; gap:4px; margin-left:auto`，portal 追加的按钮自动获得间距，
不要自带 margin。确认弹窗复用 primitives `Modal` + `Button variant="outline"`，危险确认键类名
`:not(:disabled)` 覆写 `border-color/color` 为 state-error-primary（同 `.deleteConfirm` 的最低
覆写强度，不加 `!important`）。

### 原生侧栏 section header 的伴随控件注入

给没有插件槽位的原生头部（如侧栏「工作区」标题栏，`ui-workspace` 的 sectionHeader）加控件时，
按源码核实的结构化注入规则（0.2.1-rc.2）：

- **定宽动作簇不能内插**：headerActions 是 `max-width:60px` 的两枚 28px 按钮簇，插第三枚会被
  `overflow:hidden` 裁剪。作为 sectionHeader 的独立 flex 项插在 searchSlot 之前，容器给
  `flex:none` 不参与收缩。
- **注意原生 auto margin 会顶走注入项**：searchSlot 自带 `margin-left:auto`，当其 `flex:1`
  被 `max-width` 钳住后剩余空间由 auto margin 吸收（优先级高于 `justify-content`），把插在
  它之前的注入项顶到标题旁（实机截图复现）。正确姿势：注入容器同样写 `margin-left:auto`
  接住剩余空间，并用兄弟选择器 `~ [class*="searchSlot"] { margin-left: 0 }` 归零原生 auto
  margin——覆写以注入节点的兄弟关系为前提，组件移除后自动失效，原生布局不受影响；容器
  `margin-left:auto` 只在搜索收起态起作用（展开态 searchSlot flex:1 吃满空间，auto margin
  自然归零），两个状态都不需要 JS 介入。
- **定位双信号**：类名后缀 `[class*="sectionHeader"]` 必须配合结构收窄——从带稳定 data 属性的
  行（工作区行 `[data-row-key^="workspace:"]`）向上找第一个拥有该直接子节点的祖先，避免跨包
  同名哈希类误命中；CSS module 产物类名是 `<hash>_<原名>`，前缀变化静默失效，升级需复核。
- **显隐跟随原生状态用纯 CSS `:has(~ …)`**：原生把退场类（如搜索展开时的
  `headerActionsHidden`）挂在与注入节点同辈、但排在其后的元素上，注入容器写
  `.dsh-xxx:has(~ [class*="…Hidden"])` 即可认领；镜像同一组 max-width/opacity/transform/
  visibility 过渡（含 `transition-delay` 末拍与负 margin 吃掉 gap），不需要监听 class
  attribute mutation，动画节奏与原生逐项一致。
- **Tooltip 气泡不被 overflow:hidden 祖先裁剪**：`ui-primitives` Tooltip 气泡是 fixed 定位
  （无 transform 祖先时没有 containing block），原生头部按钮的 Tooltip 都不加 portal，
  注入按钮照抄同参数（`side="bottom" delayMs={500}`）即可。
- **静态检查断言 bundle 字符串要容忍引号转义**：插件产物里字符串字面量的引号可能被 bundler
  转义成 `\"sectionHeader\"`，`source.includes('"…"')` 会假阴性；用 `/sectionHeader\\?"/`
  这类可选反斜杠正则。
- 实例：`plugins/workspace-collapse/src/client/collapse.ts`（对照
  `ui-workspace/src/client/rows/WorkspaceBrowser.module.css`）；契约细节在仓库根
  `docs/dsh/workspace.md` 的「工作区标题栏与分组折叠」。

### portal 插件的 react-dom 必须进构建模块表

portal 把内容渲染进页面 React 管理的原生 DOM，react 与 react-dom 必须是页面同一次实例；
构建工厂 `packages/plugin-build` 的 `DEFAULT_CLIENT_MODULE_TABLE` 只有 react 与
ui-primitives，portal 插件必须显式追加 `react-dom`，否则 tsdown 会内联第二份 react-dom
（曾产出 220KB bundle 且 portal 脱离页面 reconciler）。实例
`plugins/model-capabilities/tsdown.config.ts`、`plugins/deepseek-official-switch/tsdown.config.ts`；
契约记录在仓库根 `docs/dsh/plugins.md` 的「客户端产物」。
**不止 portal**：任何内联的第三方 React 库若在运行时 `import 'react-dom'`（如 @dnd-kit/core
的 createPortal/unstable_batchedUpdates），同样必须把 `react-dom` 加进
`clientModuleTable`——否则 bundle 内出现第二份 react-dom 实例与页面 reconciler 冲突。
实例：`plugins/task-board/tsdown.config.ts`（dnd-kit，2026-10-29 实机构建验证）。

### Dock 列表行的单行省略

dock 列表行要保证任何内容长度下都单行：行容器去掉 `flexWrap`，可变长文本格给
`min-width:0` + `overflow:hidden; text-overflow:ellipsis; white-space:nowrap`；行尾按钮组必须
包一层 `flex:none` 容器——dsh `Button`（`Button.module.css`）没有 `flex-shrink:0`，直接平铺
会被长文本压缩导致按钮文字换行。悬停全文用 `title` 补充。实例：
`plugins/services/src/client/ServiceRow.tsx`、`styles.ts` 的 `rowActionsStyle`；
真实页面实测长命令行 28px 单行、facts scrollWidth 1045 > clientWidth 641 出省略号。

多格共享收缩轴时要给「次要格」定死收缩优先级，否则全部格子按 flex 基础尺寸比例收缩、
主要格（如服务名）可能被压到只剩尾部省略号：次要长文本格用 `flex:1 1 0%`（基础 0、先被压），
主要格 `flex:0 1 auto`（保住内容宽、只在自身超宽时收缩）。

### 行内中间省略（CSS 做不到的 truncate middle）

CSS `text-overflow` 只有 start/end；两端都有辨识价值的名称要中间截断时按官方
`PathLabel`（`ui-primitives/src/PathLabel.tsx`）的思路自己测量：**隐藏的全文 span
（`visibility:hidden; white-space:pre`）留在文档流撑出列的 flex 基础尺寸**，截断后的可见文本
绝对定位覆盖（`position:absolute; inset:0; overflow:hidden`）——盒子宽度不随截断结果变化，
测量是纯函数、不会反馈振荡。字形数按 `getBoundingClientRect().width`（不是整数舍入的
`offsetWidth`/`clientWidth`）除以单字宽折算（本例名称被 `isValidName` 限为 ASCII + 等宽字体），
加 0.5 容差防 subpixel 误截；`ResizeObserver` 监听盒子与 sizer，未测量（capacity=null）时显示原文避免首帧闪省略号。
完整文本仍给 `title` + `aria-label`，隐藏 sizer 加 `aria-hidden`。实例：
`plugins/services/src/client/ServiceRow.tsx`（`useNameGlyphCapacity`）与 `shared.ts` 的 `midEllipsis`。

**验证闭环注意**：`ResizeObserver` 回调与渲染帧绑定——CDP `Emulation.setDeviceMetricsOverride`
或窗口 resize 在标签页 `visibility:hidden`（自动化持有、无法前台化）时布局变了但回调挂起，
「实现坏了」的假象。先确认 `document.visibilityState`；必须改截断结果时可以从 React fiber
hook 队列直接 dispatch setState 强制重渲染（`memoizedState` 第 N 个 hook 的 `queue.dispatch`）。
dsh 0.2.0 首启开发 home 的欢迎说明/API Key 向导会挡住面板交互，且欢迎确认写回在 profile patch
无 Include 结构时被 `settings/rejected` 拒绝；绕过方式是给 dev profile `cordis.patch.yml` 手写
`ui-settings-general`（welcomeNoticeVersion）、`ui-settings-account`（step: done）与
`ui-settings-models`（credentialOnboarding: false）三行（实例见 dev-suite 的 profile）。

services 面板（2026-10-23 起）是侧边栏「服务」全局面板：root 域常驻、不随会话切换，
点侧边栏行即达，无服务时显示空态而不是消失。用 `service_start` 起测试服务即可让页面出现；
**页面 `visibilityState=hidden` 时按契约停止轮询**，真实页面验收前先激活标签页。

### 全局面板（侧边栏行 + main keyed 页面，0.2.1-rc.2 核实）

给插件加一个与「插件」「自动化任务」并列的一级入口走官方双注册，不需要 DOM 注入：

- `sidebar.panellist`（root 域 list 槽）注册行：`{ id, order, label: () => t(key) }` + 图标组件。
  ui-sidebar 拥有按钮/标签/选中态，行按 order 升序（插件 0、自动化任务 10）；label 是 thunk，
  语言切换时 sidebar 重算。图标组件收到 `{ size, active }`，展开 16px / rail 18px——官方行都用
  `*OutlineRegular` 字形族（如 `IconApiOutlineRegular`），`*Medium`（1.3px 描边）是 14px dock 字形族。
- `main`（root 域 keyed 槽）注册页面：`key` = 面板 id，必须与行的 `id` 同串；先注册页面再注册行
  （`layout.selectPanel` 对未注册 key 抛错）。第三方 id 带包名前缀避免撞官方 key（plugins/schedules）。
  页面 props 组合 `PropsRuntime<'main'> & InjectFace<T> & PropsLocale<ns>`；store 可选。
- **选中面板时会话列卸载**（AppFrame `renderSlot('main', {}, { entryKey })` 是 keyed 换页），
  但 mainView 保留由工作区导航层持有，`ctx.uiSession.adapter.current` 仍解析到当前会话——
  页面要「当前工作区优先」类锚点时每次轮询/操作前现取，不要在 inject 工厂里缓存。
- 一级页面版式（`ui-schedule/src/client/TaskManagerPage.module.css`）：根节点 100% 填满主列 +
  `bg-base`；滚动区 `scrollbar-gutter:stable; --dsh-scrollbar-width:9px; --dsh-scrollbar-thumb-border:2px`；
  内容列 `max-width:960px; margin:0 auto; padding:0 clamp(24px,4vw,48px) 48px`；标题行
  `padding-top:28px`（darwin 加 `--dsh-frame-top-clearance`）、h1 `20px/28px/500`、右侧动作钮
  `Button size="sm"`。页面不能像 dock 卡那样「无数据即 return null」——给空态文案。
- 组件停用后行随槽注销消失；该面板正被选中时 layout store 自动把 activePanelId 回落 null。
- 实例：`plugins/services/src/client/{index.tsx,ServicesPage.tsx,ServicesPanelIcon.tsx}`；
  契约细节在仓库根 `docs/dsh/plugins.md` 的「全局面板」一节。

## 验证闭环

1. 运行目标插件 test/typecheck/build 和仓库 lint；读实际 diff，确认没有改业务写入逻辑。
2. **构建后重启对应 dsh，再刷新页面。** 套件所在 profile 没有 HMR，浏览器硬刷新也不会让
   宿主重读不可变客户端 bundle。先查服务管理器；用户管理的运行实例不要擅自停掉。
   可启动独立 loopback 验证实例，结束时清理，并明确提醒用户重启日常实例。
3. 在真实 dsh 页面并排比较内置控件与插件，不用孤立 HTML 预览代替宿主环境。
   用浏览器技能读 DOM、定位元素，再用 `getComputedStyle`/`getBoundingClientRect` 取值：

   ```javascript
   const css = getComputedStyle(element);
   const rect = element.getBoundingClientRect();
   ({
     height: rect.height, width: rect.width, boxSizing: css.boxSizing,
     border: css.border, outline: css.outline, boxShadow: css.boxShadow,
     background: css.backgroundColor, color: css.color,
     font: css.font, padding: css.padding, radius: css.borderRadius,
     brand: css.getPropertyValue('--dsw-alias-brand-primary').trim(),
     focused: element.matches(':focus'), focusVisible: element.matches(':focus-visible')
   });
   ```

4. 深色和浅色分别验证：默认 → 鼠标聚焦/展开 → 失焦、Tab 键盘聚焦 → 方向键/Enter/Escape、
   禁用/只读；看激活前后有无尺寸抖动、额外 outline/shadow、文字或箭头遮挡。
5. 检查窄屏无横向溢出，且剩余文字区仍可读；宿主导航挤占宽度时，仅控件不溢出不能算移动端通过。
   主题切换后颜色仍有层次；必要时截同一缩放、DPR 的真实页面图。
   不要把模拟禁用 DOM 的样式测试称为宿主只读权限验收，也不要为视觉测试写入用户设置。
6. 回答中区分构建/静态测试、真实浏览器自动检查、用户实机验收；未完成项如实列出。

## 自动吸收新经验（每次样式任务收尾执行）

这是编码助手的任务流程，不是后台监听器；以后命中本技能的任务，无需用户再次提醒即执行：

1. 判断本次是否出现**新且可复用**的主题、组件、CSS 级联、对齐或验证结论。
2. 只有读过源码或真实页面验证的结论才写入。记录「现象/原因 → 正确规则 → 上游相对路径或
   本仓库实例 → 验证方式与适用边界」，不能把猜测写成铁律。
3. 直接编辑本 `SKILL.md` 的对应章节，合并重复规则；修正过时结论，不追加流水账或失败尝试历史。
   对齐专属知识回写 `../flex-centering/SKILL.md`，这里保留入口，避免两份规则互相矛盾。
4. 若发现新的上游契约，同时更新仓库根 `docs/dsh/plugins.md` 对应主题；不把本地 dsh 绝对路径、
   token、cookie 或私密截图数据写进技能。产品边界/架构变化仍先与用户确认。
5. 无新增就不制造文档改动；有新增则在最终回复简述吸收了什么。确需拆分时在本文件明确链接，
   保持现行规则精简可加载。
