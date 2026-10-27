# 工具状态

`@dsh-kit/dsh-plugin-tools-inspector` 在会话头部提供 **工具** tab。
查看当前 Agent 可见的工具、使用次数、失败次数，并可搜索、展开描述与参数；
展开条目后可一键复制工具名（悬停展开区出现「复制工具名」按钮，成功后短暂显示「已复制」）。

## 数据口径

- 可见工具来自 ctx.tools.schemas(agent)，包含当前会话预设与插件工具。
- 调用与失败次数回放整个会话日志，dsh 重启后不会归零。
- 状态只有已使用、未使用两档；dsh 没有独立的“已注册但未激活”工具层。
- 结果无法与 callId 配对时安全忽略，不把失败归给其他工具。
- 没有 live Agent 时无法给出完整的会话工具表。

## 只读边界

本页不注册工具、不 restrict、不 guard，不改变模型能力。
已使用工具按次数排列，未使用工具按名称排列；点击条目只展开信息。

## 维护与验证

统计与 scope 契约见 [工具与进程](../../docs/dsh/runtime.md)，
tab、主题与表格规则见 [插件机制](../../docs/dsh/plugins.md)。

```powershell
pnpm --filter @dsh-kit/dsh-plugin-tools-inspector test
pnpm --filter @dsh-kit/dsh-plugin-tools-inspector typecheck
node scripts/tools-inspector-check.mjs
```

修改插件后必须构建并重启 dsh。

## 分发与管理

本包不作为独立安装项分发，而是 `@dsh-kit/dsh-plugin-development-tools`（开发工具 Bundle）的组件。停用后，会话里的「工具」页签消失。
可在该 Bundle 详情中单独停用或重新启用本组件；安装、卸载和升级以整个开发工具 Bundle 为单位。
套件安装后本组件默认启用；后续升级以整个套件为单位，并保留 Bundle 与组件的停用状态；卸载后不会自动补回。
需要重装时，在 dsh「添加插件」中填写套件目录 `plugins/suite` 的绝对目录。
