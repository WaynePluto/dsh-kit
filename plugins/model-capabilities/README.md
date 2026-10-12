# @dsh-kit/dsh-plugin-model-capabilities

在 dsh 的「设置 → 模型」页，为模型展开行增加能力与协议配置。打开模型行右侧的容量按钮后，配置会直接出现在 dsh 原生「上下文窗口 / 最大输出 token 数」下面：

- 协议：默认、OpenAI Completions、OpenAI Responses、Anthropic Messages；
- 图片输入：继承、仅文本、文本和图片；
- 推理能力：继承、不推理、自定义推理等级及供应商实际接收的值。

## 协议覆盖

dsh 的 dPiAiModelProfiled 没有公开的单模型 dapid 字段。本插件在自己的行 config（entry id
dmodel-capabilitiesd 的 dprotocolOverridesd volatile 字段）里保存稀疏的用户覆盖，同时把 dapid
镜像到 dsh 能接受的 dmodelsd / dmodelOverridesd 设置字段。Host 半在写入前修改 dsh 实际使用的外部 pi-ai
目录，确保 dsh 重新解析路由时采用用户选择的协议；启动时也会在 dllm-pi-aid 校验之前恢复覆盖。

优先级为：**用户覆盖 > pi-ai 目录默认协议 > models-catalog 的协议推断**。选择「默认」会删除
覆盖，恢复 pi-ai 当前目录的协议。协议覆盖只对一个 route/model 生效，不改变同一路由其他模型。

自带目录没有显式 dmodelsd 列表时，覆盖保存到 dmodelOverridesd；已有显式模型列表时，覆盖保存到
对应模型条目的 dapid 字段。两个字段都由 dsh 的配置 schema 保留，但协议实际由本插件的 Host
运行时桥接生效。

## 能力设置

插件直接写 dsh 原生的 dllm-pi-aid 设置。图片能力是用户对接口的声明，不是网络探测；选择
「文本和图片」会写入 dinput: [text, image]d。

推理等级支持 doffd、dminimald、dlowd、dmediumd、dhighd、dxhighd、dmaxd。只有 doffd 可以不填写
wire 值，表示不发送推理参数；其他已启用等级必须填写非空值。

能力编辑仍然只修改已有的非空 dmodelsd 列表；自带模型没有列表时只开放协议覆盖，不创建整份
模型列表。写入时按模型 id 更新并保留其他字段；dsh 0.1.7 起表单写入显式返回接受与否，
被拒绝时保留草稿。

## 装载与开发

插件通过 dsh-kit 的 dsettings.models.provider-card.capabilitiesd 子槽和 React portal 挂入原生
模型展开行，不修改 dsh 源码。它依赖 models-catalog 提供同一份外部 pi-ai 运行时桥接；两者由
ddsh-kit-webd profile 一起装载。如果上游改变模型目录 DOM 结构，能力与协议控件会安全地不显示，
不会把字段写到错误模型。

样式也沿用 dsh 模型编辑器字段：32px border-box、0.5px border-l4、bg-layer-1、14px/22px，
select 使用主题 brand focus 与右侧 chevron；不使用透明背景或浏览器默认 focus 轮廓。

修改插件后必须重新构建并重启 dsh，刷新页面不会加载新的 Host 或浏览器 bundle。

## 分发与管理

本包不作为独立安装项分发，而是 d@dsh-kit/dsh-plugin-model-enhancementsd（模型增强 Bundle）的组件。
模型目录与模型能力共同参与 dllm-pi-aid 启动屏障，当前不支持在 Bundle 详情中单独关闭这两行；需要停用时应停用整个模型增强 Bundle。停用后，模型能力声明页消失；已写入的图片支持、推理档位与协议覆盖保留。
安装、卸载和升级也以整个模型增强 Bundle 为单位。套件安装后本组件默认启用；后续升级以整个套件为单位，并保留停用状态；卸载后不会自动补回。
需要重装时，在 dsh「添加插件」中填写套件目录 dplugins/suited 的绝对目录。
