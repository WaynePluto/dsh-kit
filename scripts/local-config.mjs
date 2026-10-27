/**
 * 冒烟脚本与开发入口的共享设置（D27 后无独立 launcher/发行栈）。
 *
 * 开发与冒烟各自使用隔离的 dsh home 与错开的端口，可以与按官方方式安装套件的
 * 正式实例同时运行（见下方常量注释）。插件本身不再有项目专属数据目录。
 */

import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const ROOT = fileURLToPath(new URL('..', import.meta.url))
/** `.dev` 只供隔离冒烟脚本使用，开发栈本身不写这里。 */
export const DEV_DIRECTORY = join(ROOT, '.dev')

/** 开发栈的 dsh home，独立于日常使用的标准 `~/.dsh`，两个 dsh 实例不共享任何状态。 */
export const DSH_HOME_DEV = join(homedir(), '.dsh-dev')

// 开发端口与日常实例（dsh 3080）错开，两套栈可同时运行。
export const DSH_PORT = 3180
/** 开发栈由 scripts/dev-suite.mjs 创建的 profile；冒烟脚本从它复制隔离副本。 */
export const DSH_PROFILE = 'dsh-kit-dev'

// 冒烟脚本直接装载每个源码组件，便于精确归因；这不是对外分发的安装清单。
// 产品分组与默认顺序以根目录 plugin-catalog.json 为准。
export const DEFAULT_PROFILE_BUNDLES = [
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-web-app',
  '@dsh-kit/dsh-plugin-proxy',
  '@dsh-kit/dsh-plugin-copilot-auth',
  '@dsh-kit/dsh-plugin-models-catalog',
  '@dsh-kit/dsh-plugin-model-capabilities',
  '@dsh-kit/dsh-plugin-favorite-models',
  '@dsh-kit/dsh-plugin-turn-retry',
  '@dsh-kit/dsh-plugin-chat-scroll',
  '@dsh-kit/dsh-plugin-user-message-fork',
  '@dsh-kit/dsh-plugin-agents-md',
  '@dsh-kit/dsh-plugin-notify',
  '@dsh-kit/dsh-plugin-services',
  '@dsh-kit/dsh-plugin-terminal',
  '@dsh-kit/dsh-plugin-tools-inspector',
  '@dsh-kit/dsh-plugin-skills-inspector',
  '@dsh-kit/dsh-plugin-files',
]

// pnpm run dev 会先在仓库外生成不含功能插件的 dsh 运行环境，避免安装锚
// 从工作区 node_modules 抢先解析同名插件；单独运行脚本时保留源码回退用于诊断。
const runtimeDescriptorPath = join(DEV_DIRECTORY, 'runtime.json')
const runtimeDescriptor = existsSync(runtimeDescriptorPath)
  ? JSON.parse(readFileSync(runtimeDescriptorPath, 'utf8'))
  : undefined
// 解析锚点用根 package.json：工作区 hoisted node_modules 里同样有 @deepseek-ai/dsh 与 pnpm。
const sourceRequire = createRequire(join(ROOT, 'package.json'))
// dsh 本体不是 workspace 依赖（发布打包等脚本不需要它）：解析不到时返回 undefined，
// 让真正需要启动 dsh 的脚本在使用处报错，而不是任何 import local-config 的脚本在
// 模块加载期就失败（如 tag 检出下的 pack-suite）。
function resolveDshModule(subpath) {
  try {
    return sourceRequire.resolve(subpath)
  } catch {
    return undefined
  }
}
export const DSH_BIN = runtimeDescriptor?.dshBin
  ?? (resolveDshModule('@deepseek-ai/dsh/lib/bin.js') === undefined
    ? undefined
    : fileURLToPath(pathToFileURL(resolveDshModule('@deepseek-ai/dsh/lib/bin.js'))))
export const DSH_INSTALL_ANCHOR = runtimeDescriptor?.installAnchor ?? resolveDshModule('@deepseek-ai/dsh/package.json')
export const PNPM_CLI = runtimeDescriptor?.pnpmCli ?? join(dirname(sourceRequire.resolve('pnpm')), 'bin', 'pnpm.cjs')

/** 所有 dsh-kit 插件所在的位置。 */
export const PLUGINS_DIRECTORY = join(ROOT, 'plugins')

export { dirname }
