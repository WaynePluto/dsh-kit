# 模型与代理

基线见 [源码依据](../02-dsh-facts.md)。使用入口见 [插件索引](../plugins.md)。
以下路径相对 dsh 仓库根，项目实现明确标注。

## Copilot 登录

出处：`packages/llm/llm-pi-ai/src/{adapter,catalog,auth,login}.ts`、
`packages/credentials/authorization/src/index.ts`。

dsh-llm-pi-ai 基于 @earendil-works/pi-ai，内置 github-copilot 的设备码 OAuth、刷新和目录。
项目插件提供登录界面，通过 pi-ai CredentialStore 适配器写 ctx.credentials。

- 凭据键 llm-pi-ai/github-copilot，值为 kind:grant 与 pi-ai 原始 payload，持久化到 DSH_HOME/.credentials.yaml。
- payload 不能带显式 undefined，保存前需 JSON 化去掉此类字段。
- 路由不需要 apiKeyEnv；未配置该引用时由 pi-ai 使用 grant，刷新通过 store.modify 写回。
- 若配置 apiKeyEnv，adapter.ts 的请求级 apiKey 会优先于 OAuth grant。
	copilot-auth 在登录成功或 configure 时移除该引用，回读确认后删除不再被其他路由引用的旧密钥；
	没有引用时清理遗留 GITHUB_COPILOT_API_KEY。未登录不清理，失败显示警告并保留 OAuth grant。
- `dsh-base` 的 `authorization` 行已装载服务，但 Web 没有现成的 Copilot 登录 UI；copilot-auth 提供设备码入口。出处：`packages/bundle/base/cordis.patch.yml`。
- copilot-auth 只写“账号可用模型 ∩ 已描述目录”；models-catalog 恢复的运行时目录条目也参与交集。

settings.models.provider-card 按 ProviderDirectoryEntry.settingsNs 分派，包含草稿卡。
它是卡片内附加区域，没有原生密钥替换接口。项目通过限定在 Copilot OAuth 面板所在编辑器的 CSS
隐藏原生密码字段块，不移动或删除 React 节点，其他提供方不受影响。项目自己的子槽可供其他插件组合内容。

## 模型目录配置

出处：`packages/llm/llm-pi-ai/src/config.ts`、`src/catalog.ts`、`src/discovery.ts`、
`tests/dynamic-config.spec.ts`、`packages/client/ui-settings-models/src/client/ModelListEditor.tsx`。

- providers.<route>.models 是整份目录替换，每项再按 id 合并内置模型字段。
- modelOverrides 只能覆盖内置已有模型，不能新增未知 id。
- settings 写入会热更新路由，无需重启 dsh；插件代码变化仍需重启。
- 内置供应商的模型发现从目录回答；自定义端点可请求 GET /models。
- schemastery 会物化空 models:[]，是否显式配置要判断数组且长度大于 0。
- listConfigurableProviders 包含未配置供应商，已配置路由应从 settings.providers 取。
- listModels/resolveModelInfo 返回生效后的目录，不能当纯净内置快照。

pi-ai 的 providers/data/<provider>.json 按 api → modelId 分组，含 input、reasoning、cost、
contextWindow、maxTokens、thinkingLevelMap 等；.manifest.json 记录生成时间。

### 删空模型列表会让该供应商卡片消失

出处：`packages/client/ui-settings-models/src/client/{store.ts,ModelsSection.tsx}`、
`packages/llm/llm-deepseek/src/{config.ts,models.ts}`、
`packages/api/session-controller/src/catalog.ts`。

`models` 是整份替换：schema 只在字段缺失时回退 `DEFAULT_MODELS`，把卡片里的行全部删掉会写入
`models: []`，该 route 从此不再 advertise 任何模型。dsh 自带的两条 DeepSeek route
（`deepseek-account` = 账号登录，显示名「DeepSeek 账号」、无凭据点；`deepseek-official` =
API key，显示名「DeepSeek」、无 key 时红点）的目录都取自自身 config 的 `models`，
而 `buildModelCatalog` 丢弃空组、模型页又只保留目录非空的 account 行——删空登录账号的目录后
整行卡片消失，卡片里的「恢复默认模型」也随之不可达；`deepseek-official` 是整段供应商，
卡片仍在，能自行「恢复默认模型」自救。登录/登出不会重写该配置，唯一恢复路径是删掉 profile
patch 里对应 entry 的 `models`（等价于该按钮的 deletePath），HMR 监听 profile patch 会自动重算。
卡片不给整段供应商（`settingsPath` 为空）提供「删除」。出处另见
`packages/llm/llm-deepseek-api-key/src/index.ts`、`packages/llm/llm-deepseek-account/src/index.ts`。

项目 deepseek-official-switch 因此以官方 `pluginManager` 停用 base bundle 的 `llm-deepseek`
行实现「删除」（`registerConfigurableProviders` 随行装载，行停用即整卡消失），恢复入口挂在
`settings.models.footer`；只操作该行，不触碰 `llm-deepseek-account`、`web-search-deepseek`
（独立向 `ctx.web` 注册搜索 provider，见 `packages/web/web-search-deepseek/src/index.ts`）
与已存凭据。目录采纳的第三方 `deepseek` 路由由 `llm-pi-ai` 行从 pi-ai 目录声明
（`packages/llm/llm-pi-ai/src/index.ts` 的 `directoryEntries`），与 `llm-deepseek` 行无关。

## Models.dev 与协议

PiAiModelProfile 没有 api 字段，解析顺序是路由 api → 同 id 内置模型 → 路由唯一 sharedCatalogApi。
混合协议路由直接添加目录未知模型会导致 settings 校验拒绝。

项目 models-catalog 的兼容流程：

1. 按模型 id 查同一份外部 pi-ai 目录，目标路由优先。
2. 无匹配则按 gpt-* → openai-responses、claude-* → anthropic-messages、其他 → openai-completions。
3. 先扩展同一份 pi-ai 运行时 map，再写 dsh models；不是给单个模型增加 api 字段。套件内的 pi-ai 必须与 dsh-llm-pi-ai 实际解析的是同一个包目录（Node ESM 按真实路径缓存）；复制一份同版本包也会让 dsh 校验看不到新增模型。`build-suite.mjs` 物化时跳过 `@deepseek-ai/*`，就是为了不做第二份单例。
4. 将推断与新增条目归属存入 dsh-plugin-models-catalog，apply 时同步恢复（D16 后不再有启动屏障行；持久化的是自包含 `providers.*.models` 条目，llm-pi-ai 校验读的是恢复后的完整条目，启动顺序无关；pi-ai model map 为共享可变状态，晚注册同样生效）。
5. dsh 自带该模型后只清理本插件拥有的条目，用户及其他插件配置原样保留。

models.dev 提供 reasoning_options，但 effort/toggle/budget_tokens 形态不同，且档位名单不等于 wire 拼写。
不能直接把其 values 写成 reasoningEfforts。pi-ai 同一路由同系列的近邻可提供协议、thinkingLevelMap 与兼容性依据；
仅在 models.dev 声明 reasoning 且 effort 名单与近邻的 wire 值交集非空时才能按近邻的实际 wire 拼写开放交集档位。
Copilot 中 gpt-6-astra 是 openai-completions、gpt-5.6-sol 是 openai-responses；直连 OpenAI 与 Copilot 的同名模型也可能有不同的 off/minimal 映射。
因此不能按 GPT/Claude/Grok 前缀直接复用直连供应商的推理档位。用户覆盖优先；无可信近邻时保留无档位并提示。
已有插件条目在源检查后仅展示可更新项，须用户显式应用才更新；官方目录收录时仍只回收插件溯源，不自动补回被用户卸载的包。
模型同系列的事实取 pi-ai `providers/data/<route>.json`，新模型推理候选取 models.dev `reasoning_options`；dsh 解析依据为 `packages/llm/llm-pi-ai/src/{catalog,config}.ts`。

models 是持久的整份替换，卸载插件不会自动撤销配置。切回未加载该插件的官方 profile 前，
应使用“删除本插件添加的模型”，避免未知混合协议模型无法恢复。

在 dsh `0.1.7-rc.1` 中，`llm-pi-ai` 读取已存但因目录漂移而不可服务的模型配置时（`assertServiceable` 只校验新建或变更路由），会保留该路由和编辑入口，
并在提供方目录显示诊断；只有新建或实际变更的路由仍按完整目录严格校验。项目 models-catalog 的恢复流程仍须先于
写入校验运行，copilot-auth 使用的 `llm-pi-ai/github-copilot` 凭据格式不变。升级后的项目构建与冒烟验证见
[源码依据](../02-dsh-facts.md)。

## 自定义模型能力

出处：`PiAiModelProfile`、`modelFields`、`resolveModelReasoning`、`declaredInput`。

| 字段 | 语义 |
|---|---|
| input 省略或空数组 | 继承同名内置模型，再回退到路由 defaultInput |
| input:['text'] | 明确只接收文本 |
| input:['text','image'] | 用户声明支持图片，不自动探测 |
| reasoningEfforts 省略 | 继承目录；纯自定义模型没有默认推理档位 |
| reasoningEfforts:false | 明确关闭推理 |
| reasoningEfforts 字典 | dsh 档位映射实际 wire 值，仅 off 可为 null，至少一个非 off 档位 |

model-capabilities 编辑已有非空 models 列表的图片/推理字段；自带模型没有显式列表时不创建整份替换，
只开放单模型协议覆盖。协议覆盖保存在 dsh-plugin-model-capabilities，Host 先修改同一份外部
pi-ai 运行时 map，再将 api 镜像到 dsh 保留的 models/modelOverrides 字段，优先级为用户覆盖 >
pi-ai 默认 > models-catalog 推断。使用项目 provider-card 子槽与 React portal 挂到原生模型展开行，
保存后按 mutate 布尔结果确认；原生 DOM 不匹配时不显示附加控件，不能把字段写到错误模型。

## 常用模型

favorite-models 在 settings.models.footer 保存 provider+model 收藏，只影子覆盖 conversation.input.model。
目录与选择动作复用 dsh modelDirectories；/model 保持完整目录。
当前模型不因不在收藏中而自动切换，收藏全部失效时需回退到可用目录。
具体契约由项目 favorite-models 测试与 scripts/favorite-models-check.mjs 维护。

## 模型提供商标签

出处：`packages/client/ui-conversation/src/client/skeleton/InputBar.tsx`（composer 尾部
`conversation.input.right` list 槽渲染在模型座位左侧，当前无官方占用者）、
`packages/client/ui-model-selection/src/client/{service.ts,directory.ts,ModelSelect.tsx}`
（`ctx.modelDirectories.directoryFor(sessionId)` 返回与模型座位、/model 弹窗共享的 per-session
目录 store；原生触发器只显示模型名，菜单组头才显示供应商组名）。

项目 model-provider 只占用 `conversation.input.right` 的一个 list 条目，在模型选择按钮左侧渲染
当前选择的提供商显示名：目录组 `group.name`，`deepseek-account` 特判为账号显示名（对齐原生菜单
组头），组缺失（目录未装载）时回退原始 provider id；无当前选择或寻址 subagent 会话
（`ctx.sessions.subagentAddress(sessionId) !== undefined`，与原生座位同判）不渲染。纯浏览器半、
无宿主服务、无设置项；不调用 `load()`（服务构造已自发装载，store 订阅覆盖目录刷新、凭据/设置
变更与选择切换全部更新源）。样式跟原生触发器同节奏（13/20、label-tertiary、省略号在内层
span）；composer 行宽不足进入紧凑模式时复用 `--dsh-composer-model-text-display` 显示变量
（ui-conversation `control-row-layout.ts` 在 `.row[data-model-compact]` 上发布）随模型文字一起
隐藏。组件与纯函数测试见 `plugins/model-provider/tests/`。

## 出网代理

出处：`apps/cli/src/profile-boot.ts`、`packages/util/http-proxy/src/{policy,install}.ts`、
`packages/web/web-fetch-http/src/index.ts`；项目实现见 `plugins/proxy/src/{dispatcher,settings,shared}.ts`。
已安装 `0.1.7-rc.1` 产物对应 `@deepseek-ai/dsh/lib/profile-boot-*.js`、
`@deepseek-ai/dsh-http-proxy/lib/index.js` 和 `@deepseek-ai/dsh-web-fetch-http/lib/index.js`。

dsh 在 profile 插件装载前通过 `installProxyFromEnvironment` 解析启动环境中的
HTTP_PROXY、HTTPS_PROXY、ALL_PROXY、NO_PROXY（大小写均支持），安装进程级策略与 undici 全局 dispatcher。
原生 `web-fetch-http` 按目标 URL 调用 `proxyRouteFor`，代理路由与直连时的安全检查分别处理；
不能把网页抓取描述成只依赖普通 `fetch` 的 dispatcher。loopback 始终绕过代理。

项目的「设置 → 代理」在官方策略之上叠加可热更新的策略，配置保存在 profile 的 `proxy` 插件行
volatile Config（`dsh-plugin-proxy` 是文案命名空间）：

| 模式 | 行为 |
|---|---|
| 跟随环境（默认） | 不叠加策略；沿用 dsh 启动时安装的环境策略，环境未配置代理则直连 |
| 使用插件代理 | 以指定 HTTP/HTTPS 地址覆盖两种请求协议的代理出口，并应用绕过列表 |
| 强制直连 | 在该层安装直连策略，同时影响原生 `fetch` 与 `proxyRouteFor` 路由 |

显式 `mode` 优先；未设置 `mode` 的配置按 `enabled=true` → 插件代理、
`enabled=false` 且地址非空 → 强制直连、关闭且地址为空 → 跟随环境解释，不自动改写配置。
模式切换先释放当前叠加层，再安装新层；停用/卸载时释放叠加层，恢复下层官方环境策略。
测试按钮按测试 URL 报告实际代理路由，不能推断其它目标都走相同出口。
地址禁止 userinfo、不提供跳过 TLS 验证的选项；不承诺控制独立 WebSocket、自建 Agent、
独立网络库或所有子进程。models-catalog 与 copilot-auth 不另设代理。
保存遵守 [设置写入契约](plugins.md)：共享校验器先校验，mutate 返回 false 即拒绝并保留草稿。