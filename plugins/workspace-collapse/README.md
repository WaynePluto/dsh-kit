# 收起/展开全部工作区

`@dsh-kit/dsh-plugin-workspace-collapse` 在侧栏「工作区」标题栏（搜索按钮左侧）增加一个
动作按钮：只要还有展开中的工作区分组，按钮是「收起全部工作区」，点击后一键折叠下方
所有分组，列表里只剩各工作区标题行；全部分组收起后，按钮就地变成「展开全部工作区」，
点击后恢复全部展开。

两个方向都走原生分组头行的同一条路径：状态写入 dsh 自己的视图 store（persist
`dsh.workspace.view.v5`），重启后保持；当前会话所在分组同样参与收起/展开。

## 行为

- 按钮只在分组树展示时出现（flat 列表、搜索结果、空状态、rail 收起态都没有工作区
  分组行，按钮一并隐藏）；搜索框展开时按钮随原生动作簇一起退场，动画节奏与原生一致。
- 动作方向由列表实时决定：存在 `aria-expanded="true"` 的分组行就是收起方向，全部
  收起后切到展开方向；用户手动逐个折叠/展开分组时按钮文案与字形同步跟随。
- 收起时对全部展开中的分组行按文档逆序派发点击（树形模式下先子后父，避免祖先先
  折叠导致后代行被卸载后点击落空）；展开时按文档顺序多轮派发点击——父分组展开后
  子分组行才挂载，每轮之间等原生渲染落 DOM，逐层点开直到全部展开；未分组桶一并参与。
- 图标是上下双 chevron（两条原生 chevron 字形纵向叠放）：收起方向两箭头指向彼此
  （下箭头在上、上箭头在下），展开方向互换指向外侧；悬停有原生 Tooltip（「收起全部
  工作区」/「展开全部工作区」），样式复刻原生头部 28px 图标按钮契约（深浅主题走
  主题 token）。

## 实现边界

dsh 的 section header 与分组展开状态都是 ui-workspace 私有界面：header 没有插件槽位，
展开状态存在其私有 view store，插件拿不到实例。因此本组件按 DOM 注入工作：从工作区行
（`[data-row-key^="workspace:"]`）向上找带 `sectionHeader` 直接子节点的祖先，把按钮插在
搜索槽（`searchSlot`）之前；收起/展开都对分组行合成 click，由原生 onToggle 写回 store；
方向跟随靠观察器监听行内 `aria-expanded` 属性变化（叶子分组折叠/展开只改属性、不产生
childList mutation）。
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
