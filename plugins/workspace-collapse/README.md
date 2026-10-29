# 聚焦/折叠工作区

`@dsh-kit/dsh-plugin-workspace-collapse` 在侧栏「工作区」标题栏（搜索按钮左侧）增加一枚
双态动作按钮（三线 + 上下 chevron 组合图标）：

- **折叠所有工作区**：只要还有展开中的工作区分组，按钮就是这个方向，点击后一键折叠
  下方所有分组，列表里只剩各工作区标题行。
- **仅展开活动的工作区**：全部分组收起后，按钮就地切到这个方向，点击后先展开全部分组，
  再收起子树里没有任何活动会话的工作区——活动指会话行带运行中（含子代理）、待用户操作
  （审批/计划确认/提问）或完成未读状态点；当前选中会话所在的分组始终保留展开。
  列表最终只剩有活动的工作区。

所有动作都走原生分组头行的同一条路径：状态写入 dsh 自己的视图 store（persist
`dsh.workspace.view.v5`），重启后保持；当前会话所在分组同样参与折叠。

## 行为

- 按钮只在分组树展示时出现（flat 列表、搜索结果、空状态、rail 收起态都没有工作区
  分组行，按钮一并隐藏）；搜索框展开时按钮随原生动作簇一起退场，动画节奏与原生一致。
- 按钮方向由列表实时决定：存在 `aria-expanded="true"` 的分组行就是折叠方向，全部收起后
  切到聚焦方向；用户手动逐个折叠/展开分组时按钮文案与字形同步跟随。
- 折叠时对全部展开中的分组行按文档逆序派发点击（树形模式下先子后父，避免祖先先
  折叠导致后代行被卸载后点击落空）；聚焦的展开阶段按文档顺序多轮派发点击——父分组
  展开后子分组行才挂载，每轮之间等原生渲染落 DOM，逐层点开直到全部展开；未分组桶
  一并参与。
- 聚焦动作分两阶段：先按文档顺序多轮点开全部收起分组（收起分组的会话行不在 DOM——
  上游 deriveGroups 对收起分组输出空 sessions，必须展开后状态点才可判定），随后按
  文档逆序收起子树完全无活动状态点、也不含当前选中会话的分组；子树含活动的祖先链
  保留展开，不会把活动分组重新藏起来。已知局限：分组会话超过原生水位线（默认 5 条）
  时，深处会话行由 overflow 行替代，其活动状态判定不到；当前会话所在分组始终展开。
- 聚焦完成后把仍展开（活动）的工作区按显示标题字母序移到列表最前，其余工作区保持
  现有相对顺序：从幸存的展开行取工作区 id，对官方 `workspaces` 服务的 `insertBefore`
  （原生拖拽排序同一条宿主路径）按最小移动计划逐条执行，顺序持久化；任一步被宿主
  拒绝即告警并停止剩余移动，不影响已完成的聚焦。树形模式下重排作用于宿主清单，
  呈现按父子嵌套投影（活动分组不会跳出自己的父分组）；未分组桶不参与重排（原生
  恒定渲染在末尾）。
- 提醒的判定依据是会话行内的原生状态点（`StateDot` 的 `data-state` 属性）：
  `ongoing` = 运行中、`warning` = 待用户操作、`done` = 完成未读；空闲会话不渲染
  状态点，天然不算活动。
- 图标是三条工作区分组线 + 右侧上下 chevron 的组合字形（Regular 1px 描边与相邻头部
  `*OutlineRegular` 字形族同规范，显示尺寸 16px）：折叠方向两箭头指向彼此（下箭头在
  上、上箭头在下），聚焦方向互换指向外侧。悬停有原生 Tooltip，样式复刻原生头部 28px
  图标按钮契约（深浅主题走主题 token）。

## 实现边界

dsh 的 section header 与分组展开状态都是 ui-workspace 私有界面：header 没有插件槽位，
展开状态存在其私有 view store，插件拿不到实例。因此本组件按 DOM 注入工作：从工作区行
（`[data-row-key^="workspace:"]`）向上找带 `sectionHeader` 直接子节点的祖先，把按钮插在
搜索槽（`searchSlot`）之前；折叠与聚焦都对分组行合成 click，由原生 onToggle 写回 store；
方向跟随靠观察器监听行内 `aria-expanded` 属性变化（叶子分组折叠/展开只改属性、不产生
childList mutation）。
聚焦动作的会话归属按上游 renderGroup 的 section 结构判定（`groupSection > HoverCard
span > 行`，子分组包在 `div[role=group]` 里），结构与上游不符时动作整体退化为无操作。
聚焦后的置前重排不移动 DOM：走官方 `workspaces` 客户端服务的 `insertBefore`
（`packages/api/workspace-controller/src/client/service.ts` 的 `IWorkspaces`），与原生
拖拽排序同一条宿主路径；活动集合来自幸存展开行的 `data-row-key`。
上游依据：`packages/client/ui-workspace/src/client/rows/{WorkspaceBrowser.tsx,Rows.tsx}`。
头部定位用 CSS module 类名后缀匹配（构建产物类名是 `<hash>_<原名>`），哈希前缀随版本
变化会静默失效，升级需按 dsh-upgrade 流程复核。

## 维护与验证

```powershell
pnpm --filter @dsh-kit/dsh-plugin-workspace-collapse test
node scripts/workspace-collapse-check.mjs
```

纯浏览器半、无宿主服务；构建落盘后由官方 client-hmr 自动热替换（宿主半无改动、组件行已
装载时无需重启 dsh），实机验收深浅主题与中英文界面。

## 分发与管理

本包不作为独立安装项分发，而是 `@dsh-kit/dsh-plugin-conversation-enhancements`（会话增强 Bundle）
的组件。停用后按钮消失，不影响原生折叠与展开行为。
可在该 Bundle 详情中单独停用或重新启用本组件；安装、卸载和升级以整个 Bundle 为单位。
套件安装后本组件默认启用；后续升级以整个套件为单位，并保留 Bundle 与组件的停用状态。
需要重装时，在 dsh「添加插件」中填写套件目录 `plugins/suite` 的绝对目录。
