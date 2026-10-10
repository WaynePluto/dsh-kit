# run_code 工具

`@dsh-remote/dsh-plugin-run-code` 参考 pi 的 codemode，把 dsh 官方 PTC 运行时的 `run_code`
工具开放为模型可自主选择的能力：原生工具照常直呼，模型也可以写一段 TypeScript 程序，
在程序里以 `await tools.name(args)` 组合调用工具，只有程序打印或返回的内容回到对话。

本包不是独立 Bundle，没有自己的 profile 行；它作为嵌套行挂在 Agent 预设的
`config.plugins` 里（当前由简洁模式预设使用）。装载后：

- 等待宿主的 `ptcRuntime` 服务（dsh-base 常驻提供），把所在预设作用域声明为
  `both` 展示模式——模型协议同时收到全部原生工具 schema 与 `run_code`；
- 在官方 `tools:sdk` section 之后追加一段何时优先用 `run_code` 的使用指引
  （批量并发、链式依赖、大结果过滤），单次简单调用仍建议直呼工具。

程序执行链完全复用 dsh：每个程序在全新受管 Node 子进程中运行，子调用走与原生相同的
审批与权限管线，SDK 声明由 dsh 生成。嵌套行名 `run_code` 是 dsh 保留的工具名，
本包不注册同名工具，也不含任何运行时实现。

预设里的 persona 必须保持 `complete: false`：`complete: true` 会以 persona 覆盖整个
system prompt，把 `tools:sdk` 的 SDK 声明一起过滤掉，模型将不知道 `tools.*` 绑定。

## 验证

```powershell
pnpm --filter @dsh-remote/dsh-plugin-run-code test
node scripts/concise-mode-check.mjs
```

修改后必须重启 dsh。源码依据见 [dsh 核实结论](../../../docs/02-dsh-facts.md)。
