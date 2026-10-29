# 侧栏面板行回会话

`@dsh-kit/dsh-plugin-panel-toggle` 让侧栏的面板行（插件、自动化任务、服务等）支持
「再点一次回到会话」：当某个全局面板盖住会话列时，再次点击侧栏里高亮的那个面板行，
即返回当前会话——不需要去找会话或新建入口。

上游的这些行没有 toggle：`ui-sidebar` 的 `PanelRow` 点击无条件 `selectPanel(id)`，
对已选中的行只是无效重选。本组件在 document 捕获阶段拦截活动面板行（
`aria-current="page"` 且位于面板列表 `nav` 内、类名含 `panelRow`）的点击，改调官方
`layout.selectPanel(null)`——与上游关闭面板回会话（`clearMain`）同一条路径，会话列
重新挂载时仍是原来的 mainView 会话，不切换、不重建会话。

## 行为与边界

- 拦截只针对**当前选中**的面板行；未选中行、气泡菜单里的选中项（上游 `Menu` 的
  菜单项同样使用 `aria-current="page"`，但 portal 在 body、不在面板列表 `nav` 内）
  一律放行。键盘 Enter/Space 走同一 click 路径，天然生效。
- 「更多」是菜单启动器（`aria-haspopup="menu"`），不占主列，不在本组件范围内。
- 已知边界：面板页展示期间会话结束时，上游 status-controller 因 mainView 保留仍在
  而不记「完成未读」绿点（`isMain` 判定，见 docs/dsh/workspace.md）；本组件只提供
  顺手的返回动作，不改变未读判定。
- 定位依赖 CSS module 类名后缀（`panelRow`/`panelList`）与 `aria-current` 属性，
  哈希前缀变化会静默失效，升级需按 dsh-upgrade 流程复核。

## 移除条件（重要）

**上游 dsh 若原生实现了面板行 toggle（再次点击活动行返回会话），请删除本组件**：
停用并从 conversation-enhancements 组合包移除该行即可，无任何数据或配置残留。

## 维护与验证

```powershell
pnpm --filter @dsh-kit/dsh-plugin-panel-toggle test
```

纯浏览器半、无宿主服务；构建落盘后由官方 client-hmr 自动热替换（宿主半无改动、
组件行已装载时无需重启 dsh）。

## 分发与管理

本包不作为独立安装项分发，而是 `@dsh-kit/dsh-plugin-conversation-enhancements`
（会话增强 Bundle）的组件。停用后行为恢复原生（面板行无 toggle），安装、卸载和
升级以整个 Bundle 为单位。套件安装后本组件默认启用；需要重装时，在 dsh「添加插件」
中填写套件目录 `plugins/suite` 的绝对目录。
