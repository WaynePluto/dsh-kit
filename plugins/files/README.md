# @dsh-kit/dsh-plugin-files

给 dsh 原生右侧 Sidebar 文件能力增加 Git 状态、文件树右键菜单和 Git 变更面板。
本插件不再提供第二套目录树或文件预览；原生 `ui-sidebar-files` 负责树，原生
`ui-sidebar-documentpreview` 负责文件资源预览。

## 使用

打开右侧 Sidebar，在原生「开始」页选择「工作区文件」，进入原生「文件」页；「新建终端」和「浏览器」入口仍由 dsh 提供，不受本插件影响。

- 文件树与预览同住一个分栏：点击文件走原生打开行为（打开到树所在分栏，不拆分栏；重复点击同一文件只定位已有页签）；
- 文件在原生文档预览 tab 中打开，支持 dsh 已有的 Markdown、代码、纯文本、图片、PDF 和 HTML 预览；
- 预览页签首次出现时自动展开原生目录树（预览头部的目录树开关），每个分栏只自动展开一次；之后用户手动收起即视为接管，不再代点（刷新页面或重启后重新计）；
- 单击文件使用 VS Code 式临时预览：标题为斜体，后续单击会复用同一页签；双击文件或页签（含标题两侧空白）后转为保留页签；
- 图片预览提供缩小、放大、100%、适应窗口和 Ctrl/⌘+滚轮缩放，原生滚动用于查看放大内容；按住 Space 后在图片滚动区域按鼠标左键拖动可平移溢出的图片（输入框、选中文字、其他页签和触摸操作不受影响）；
- 页签标题右键菜单的「关闭其他」「关闭全部」只作用于右键目标所在分栏。

最终用户只看到一个「文件」入口，不再有「文件 pro」。插件不注册额外入口，也不覆盖「开始」页。
原生文件树由插件以 DOM 级方式增强（观察原生树根），插件不复制上游树源码。

## 行右键菜单

树行右键完全使用 dsh 原生菜单（`ctx.contextMenus` 贡献机制，0.2.2 起）：
原生已提供在侧边栏打开、在浮窗中打开、在文件夹显示、使用默认应用打开、复制文件/目录路径、另存为等，
插件只补充只读项，追加在原生项之后（首项带分隔线）：

- **复制完整路径**（文件与目录行，2026-11-13 恢复）：以会话工作区根的分隔符归一拼接，
  Windows 下输出纯反斜杠路径。官方 ui-open-in-app 的目录「复制路径」用
  `resolveWorkspacePath` 拼接时不归一相对段的分隔符，会产出 `D:\repo/plugins/suite`
  这类混排路径；上游修复后本项撤下（D28）。工作区根行也提供本项（复制根路径本身）；
- **复制相对路径**（文件与目录行）：复制相对于当前 Session 工作区根的 slash 路径；
- **查看 Git 变更**（仅文件行）：在右侧 Sidebar 打开「Git 变更」页签（见下一节）。

会话没有工作区、或目标越出工作区根时不出这些条目；复制走剪贴板并复用原生菜单的反馈提示。
右键不会触发展开、预览或任何写入操作。

## Git 状态

Git 状态在树加载和点击原生刷新时读取。宿主执行无 shell 的：

```text
git -c core.fsmonitor=false --no-optional-locks -C <session cwd> status --porcelain=v2 -z --untracked-files=all -- .
```

另以无 shell 的 `git rev-parse --show-prefix` 将仓库根路径投影回 Session cwd。状态包括：

- `M` 修改、`A` 新增、`D` 删除、`R` 重命名、`C` 复制、`?` 未跟踪、`U` 冲突；
- 文件按自身状态显示，目录聚合后代中优先级最高的状态；
- 字符、颜色、`aria-label` 和 `title` 同时表达状态；
- 不向树中插入已删除文件的虚拟行；
- 缺少 Git、非仓库、失败、超时或输出截断只显示降级状态，不阻断原生文件浏览。

status 命令总预算为 3 秒、stdout 1 MiB、最多投影 2000 项。Git 状态不是完整实时信号；
原生 dsh 的 `fs/observed` 不覆盖所有 shell、Git 或外部编辑器操作。

## Git 变更面板

文件右键的「查看 Git 变更」打开一个独立资源页签（每会话一个，`dsh-resource://files-git-review/session/<sessionId>`），
视觉与交互复刻 dsh 原生每轮「已编辑 n 个文件」的改动面板（文件选择器、增删计数、左右对比/自动换行切换、
在侧边栏打开文件、带行号与语法高亮的 diff 正文），但内容口径是**工作区对 HEAD 的 Git 变更**：

- 清单 = 已暂存 + 未暂存 + 未跟踪文件（与树上的 Git 状态同源），右键的文件自动预选；
  右键到未变更文件时，该文件会临时列入清单并显示「无未提交的改动」；
- 单文件 diff 为 `git diff --no-renames HEAD -- <path>`（未跟踪与空仓库文件按整文件新增合成）；
- 二进制显示「二进制」、超过输出上限显示「过大」，纯重命名按删除旧文件 + 新建新文件呈现；
- 页签按 Sidebar 原生去重：同一会话右键不同文件会复用页签并切换预选；每次右键导航都会重新读取清单，
  Sidebar 的刷新入口也会重新拉取；切换文件时 diff 单独读取。

数据走插件私有通道的两个只读端点，采集无 shell、有界（每命令 3 秒、stdout 1 MiB）：

```text
/files/review { sessionId } → { available, files: [{ path, status, added, deleted, binary?, oversized? }], truncated }
/files/diff   { sessionId, path } → { kind: 'text' | 'binary' | 'oversized', ... }
```

未跟踪文件的行数统计来自有界单文件读取（最多统计 200 个未跟踪文件，之后计为 0/0）。
Git 状态不承诺实时；面板每次导航与刷新时重新采集。

## 读取边界

文件正文和目录列表完全由 dsh 原生 `workspaceFiles` 提供，不再经过本插件的 `/files/list` 或 `/files/read`。
因此跟随 dsh 原生边界：目录列举限制在 Session 工作区；文件读取使用 dsh 组合文件系统授权，可能读取
工作区外路径；文本分页、完整字节上限、变更观察和 HTML 隔离 iframe 均以 dsh 版本为准。
这不再声称旧 files 实现的逐段 symlink 拒绝和读取前后身份复核。

本插件的私有通道只保留：

```text
/files/snapshot { sessionId } → { workspacePath, git }
/files/review   { sessionId } → Git 变更清单（右键面板用）
/files/diff     { sessionId, path } → 单文件对 HEAD 的比较（右键面板用）
```

它不提供写入、新建、重命名、删除、Git 修改或模型工具。

## 开发检查

```powershell
pnpm --filter @dsh-kit/dsh-plugin-files test
pnpm --filter @dsh-kit/dsh-plugin-files typecheck
pnpm --filter @dsh-kit/dsh-plugin-files build
node scripts/files-check.mjs
```

源码依赖当前 dsh `0.2.2-rc.1` 的 Sidebar/slot 契约、原生 contextMenus 贡献、目录树开关
`data-files-navigator-toggle` 与图片滚动容器 `data-document-zoom-scrollport`。插件通过 `dsh.client.inject`
声明对 `@deepseek-ai/dsh-client-ui-sidebar-files`、`@deepseek-ai/dsh-client-ui-sidebar-documentpreview` 与
`@deepseek-ai/dsh-client-ui-context-menu` 的模块图依赖，但不深层 import 上游源码；Git 变更面板按同版本
`ui-deliverables` 的 changes-review 结构与样式复刻（该包的组件不在发布物导出里，无法直接 import），并经页面冻结模块表
复用 `@deepseek-ai/dsh-client-store` 与 `@deepseek-ai/dsh-client-ui-primitives`。
如果上游登记项、行 data 属性、目录树开关属性或 Sidebar 导航契约变化，检查必须响亮失败并重新适配。

`dsh-kit-web` 没有 HMR。修改宿主、浏览器代码或样式后，必须重新构建并重启 dsh；只刷新页面不会
重新加载冻结的浏览器产物。

## 分发与管理

本插件作为独立 Bundle 分发，可单独停用、卸载和升级。停用后，Git 状态、右键补充项、Git 变更面板、目录树默认展开与预览增强消失，回到 dsh 原生文件树（原生菜单与打开行为不受影响）；本插件不提供写入接口的性质不变。
套件安装后本插件默认启用；后续升级以整个套件为单位并保留停用状态，卸载后不会自动补回。
需要重装时，在 dsh「添加插件」中填写套件目录 `plugins/suite` 的绝对目录，而不是源码目录或 `dist/index.js`。

原生插件列表中的标题是 **plugin-files**，详情页显示完整包名 `@dsh-kit/dsh-plugin-files` 与 Bundle 行 `files`。副标题来自 package.json 的中文 `description`；标题仍由 dsh 根据 npm 包名生成。
