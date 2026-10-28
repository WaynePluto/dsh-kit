# DSH 增强套件（suite）

dsh-kit 的唯一分发包（D3、D20）：在官方 dsh（桌面版或 web 版）的插件管理页
「+ 添加插件」输入一个地址即可安装或升级全部内容——23 个功能组件。
套件被停用或卸载时全部组件行一并禁用（组合包官方 disabled 表达式约定）。

## 安装地址（多形态同一产物）

| 形态 | 「添加插件」里填的地址 | 用途 |
|---|---|---|
| GitHub Release 固定名 | `https://github.com/WaynePluto/dsh-kit/releases/latest/download/dsh-kit.tar.gz` | 首次安装；latest/download 恒指最新 Release |
| GitHub Release 版本名 | `https://github.com/WaynePluto/dsh-kit/releases/download/v<版本>/dsh-kit-<版本>.tar.gz` | 升级：原地替换旧版并在线热生效（D21） |
| 本地 tarball | `release/dsh-kit-<版本>.tar.gz` 的绝对路径 | 无网络/发布前验证（与 Release 走 pnpm 同一条 plain-tarball 路径） |
| 本地目录（开发） | 本目录绝对路径 | pnpm `link:` 语义，直接用仓库里的构建产物 |

三种形态装的是同一棵自包含树：`package.json` 零 dependencies，23 个组件声明为
peerDependencies（精确版本），全部依赖闭包物化在本目录 `node_modules/`
（`@deepseek-ai/*` 由 dsh 运行时树提供，不复制第二份）。组件不发布 npm；
pnpm 安装 tarball 时不解析任何 registry 依赖，dsh 启动时沿 peers 闭包物理探测
套件内 `node_modules/` 解析组件行（runtime resolution 表）。

**Git 仓库地址（如 `https://github.com/WaynePluto/dsh-kit`）不可用**：pnpm 把
github.com 的仓库 URL 一律当 git 依赖处理——按 npm-packlist 重打包会剥掉
node_modules，且根包 `prepare` 脚本触发 pnpm 11+ 的
`ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`（2026-10-27 实测，见
[roadmap](../../docs/05-roadmap.md)）。这是远程安装只能走 Release 资产 tarball
的原因。

## 安装与升级

1. 本地构建：仓库根执行 `pnpm suite:pack`（= plugins:build + suite:build + 打包，
   产物 `release/dsh-kit.tar.gz` 与 `release/dsh-kit-<version>.tar.gz` 同内容双资产）。
2. 首次安装：官方 dsh → 插件 → 添加插件 → 输入上表任一地址 → 安装 → 启用 → 重启应用。
   在安装前就启动的 dsh 里点「启用」，组件行会整包延迟到重启装载（行上的可解析性
   守卫避免 failed to import 报错）；个别机器上首次启用还可能报一条 session-controller
   的重挂载竞态（dsh 上游已知，见 [roadmap](../../docs/05-roadmap.md)），同样重启即恢复。
3. 升级（无需卸载、无需重启）：到 Releases 打开新版本，复制 `dsh-kit-<版本>.tar.gz`
   资产地址，在「添加插件」输入即原地替换旧版并在线热生效（官方管理器对「与已存依赖
   值不同的 spec」放行替换；同一地址重复输入会被拒为 already-installed，因此升级地址
   必须带版本号，D21）。本地形态升级同理：输入新版本 tarball 的绝对路径。

远程发布走 CI：推送 `v<版本>` 标签（须与套件 `version` 一致），`release.yml`
自动构建、打包并创建 GitHub Release 上传双资产（固定名 `dsh-kit.tar.gz` +
版本名 `dsh-kit-<版本>.tar.gz`）。

## 组成

- `cordis.patch.yml`（生成物，勿手改）：全部组件 insert 行（裸包名 + 「套件成员 +
  组件包可解析」双条件 disabled 表达式，首次在线启用时整包延迟到重启装载）。
  套件层只有 insert 行，永不覆写官方行（D16）。
- `package.json`（手维护）：`dsh.bundle.patch` 声明、peerDependencies 组件闭包
  （`build-suite.mjs` 校验覆盖与版本一致）。
- `node_modules/`（生成物）：组件包 + workspace 共享包 + registry 依赖闭包，
  由 `build-suite.mjs` 整体改名换代物化（中断不留空目录）。
- `locale/`：套件自身在插件管理页的标题与描述。

## 验证

```powershell
pnpm suite:pack                       # 构建并打包
node scripts/suite-tarball-check.mjs  # tarball 安装端到端：不可达 registry 安装 +
                                      # 真实 dsh 冷启动，断言 23 组件行 ACTIVE + 客户端图完整
node scripts/suite-upgrade-check.mjs  # 在线原地升级：旧版冷启动 → 输入新地址热替换，
                                      # 断言 applied + 23 行重新 ACTIVE + 同 spec 被拒
node scripts/suite-toggle-check.mjs   # 在线停用/启用回归（本地目录 junction 形态）
node scripts/suite-first-enable-check.mjs  # 首次在线启用回归
```

## 行为要点

- 套件的安装/升级都是「添加插件」输入一个地址（首次用固定名地址，升级用版本名
  地址），不写项目专属数据目录，也不注入环境变量；
  配置全部存在 dsh 自己的 profile 与 settings 里。
- 组件行仍可单独停用（`plugins` 详情页的组件开关），停用事实写在 profile patch
  的 `disabled`；套件 Bundle 本身是安装/卸载/升级单位。
- 模型目录一对组件（models-catalog、model-capabilities）共享运行时服务，
  不能只停一行。
- 宿主升级 dsh 后按 [源码依据](../../docs/02-dsh-facts.md) 的各主题检查脚本复核。
