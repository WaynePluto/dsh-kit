# 系统提示词段落过滤

`@dsh-kit/dsh-plugin-prompt-filter` 在预设作用域里按名摘掉 dsh 部署级注册的
system-prompt section。它没有自己的 profile 行，作为嵌套行挂在 Agent 预设的
`config.plugins` 里（当前由简洁模式预设使用）。

## 为什么需要它

dsh 的 persona 行只有 `complete` 一个开关，表达不了「只保留 persona + 工具 section」：

- `complete: false` 只替换 persona 槽位（`deployment:persona-prefix`）：身份行、`@` 文件引用、
  deliverables 的 `present` 展示指引、harness 源码、web surface 等部署级 section 一条也过滤不掉；
- `complete: true` 把整个 system prompt 覆盖成 persona 那一句，连 `tools:sdk` 与工具指引一起滤掉，
  run_code 就看不到 `tools.*` 声明。

本插件补上中间态：`dropSections` 点名的 section 不进本预设的提示词，其余原样保留。

## 机制

`system-prompt/assemble` 是按作用域路由的 waterfall：注册在祖先作用域的监听器收得到每个后代
agent 的组装（`@deepseek-ai/dsh-scope` 的 `scopeTarget` 祖先准入），其返回值即最终 assembly
（只有 complete section 会在之后被还原）。本行挂在预设的 `config.plugins` 里，所以只影响该预设
作用域下的 agent；其他预设与部署全局的提示词不变，`scripts/concise-mode-check.mjs` 在隔离宿主里
断言这一点。

只摘 section，不动能力：被摘掉文案的插件、服务与工具仍在，模型仍能正常调用。
section 名是 dsh 定义的（如 `tool:pwsh`、`harness:identity`），升级 dsh 时用冒烟脚本复核，
不要按记忆改名单。

## 配置

| 字段 | 含义 |
|---|---|
| `dropSections` | 要摘掉的 section 名清单（必填）；空清单在装载时响亮失败 |

## 验证

```powershell
pnpm --filter @dsh-kit/dsh-plugin-prompt-filter test
node scripts/concise-mode-check.mjs
```

修改后必须重启 dsh。
