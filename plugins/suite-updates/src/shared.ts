/** 套件更新的共享常量与纯函数；宿主半、浏览器半与测试共用。 */

/** 本插件拥有的文案命名空间。 */
export const NAMESPACE = 'dsh-plugin-suite-updates'

/** 本插件在 cordis.patch.yml insert 行的 id，即插件行稳定身份。 */
export const ENTRY_ID = 'suite-updates'

/** 套件 Bundle 完整包名，也是 plugins.bundle.config keyed 槽的 key。 */
export const SUITE_PACKAGE = '@dsh-kit/dsh-plugin-suite'

/** kit 私有 RPC 通道（宿主半注册 + 浏览器半调用，kit 信封，D16）。 */
export const CHANNEL = '/suite-updates'

/** 检查更新端点。 */
export const CHECK_ENDPOINT = 'check'

/** {@link CHANNEL} 的全部端点。 */
export const ENDPOINTS = [CHECK_ENDPOINT] as const

/** {@link CHANNEL} 的一个端点名。 */
export type SuiteUpdatesEndpoint = typeof ENDPOINTS[number]

/** 通道对未知端点报告的故障码。 */
export const UNKNOWN_ENDPOINT_CODE = 'suite-updates/unknown-endpoint'

/** profile 里解析不到套件 Bundle 时报告的故障码。 */
export const SUITE_NOT_FOUND_CODE = 'suite-updates/suite-not-found'

/** GitHub Release 查询失败（网络、限流、形态变化）时报告的故障码。 */
export const GITHUB_UNREACHABLE_CODE = 'suite-updates/github-unreachable'

/** dsh-kit 仓库（owner/name）；发布资产与 latest 查询都指向它。 */
export const GITHUB_REPO = 'WaynePluto/dsh-kit'

/** 去掉 Release tag 的 `v` 前缀；无前缀时原样返回。 */
export function stripLeadingV(tag: string): string {
  return tag.startsWith('v') ? tag.slice(1) : tag
}

/** 把 Release tag 拼成固定名资产地址：`releases/download/<tag>/dsh-kit.tar.gz`。 */
export function buildUpgradeUrl(tag: string): string {
  return `https://github.com/${GITHUB_REPO}/releases/download/${tag}/dsh-kit.tar.gz`
}

/** 把版本号拆成数值段与可选 prerelease；无法解析的段按 0 处理。 */
function parseVersion(version: string): { core: readonly number[]; pre?: string } {
  const [core, pre] = version.split('-', 2)
  return {
    core: (core ?? '').split('.').map(part => Number.parseInt(part, 10) || 0),
    ...(pre === undefined ? {} : { pre }),
  }
}

/** prerelease 标识按 `.` 分段比较：纯数字段比数值，其余按字符串；缺段一侧更低。 */
function comparePre(a: string, b: string): number {
  const left = a.split('.')
  const right = b.split('.')
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const leftPart = left[index]
    const rightPart = right[index]
    if (leftPart === undefined) return -1
    if (rightPart === undefined) return 1
    const leftNumber = /^\d+$/u.test(leftPart) ? Number(leftPart) : undefined
    const rightNumber = /^\d+$/u.test(rightPart) ? Number(rightPart) : undefined
    if (leftNumber !== undefined && rightNumber !== undefined && leftNumber !== rightNumber) {
      return leftNumber < rightNumber ? -1 : 1
    }
    if (leftPart !== rightPart) return leftPart < rightPart ? -1 : 1
  }
  return 0
}

/** 语义化版本的朴素比较：a<b 返回 -1，a=b 返回 0，a>b 返回 1；prerelease 低于同版本正式版。 */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a)
  const right = parseVersion(b)
  const length = Math.max(left.core.length, right.core.length)
  for (let index = 0; index < length; index += 1) {
    const diff = (left.core[index] ?? 0) - (right.core[index] ?? 0)
    if (diff !== 0) return diff < 0 ? -1 : 1
  }
  if (left.pre === undefined && right.pre === undefined) return 0
  if (left.pre === undefined) return 1
  if (right.pre === undefined) return -1
  return comparePre(left.pre, right.pre)
}

/** 一次检查更新的结果；浏览器半据此渲染状态与复制升级地址。 */
export interface UpdateCheck {
  /** 已装套件版本（profile 依赖闭包里套件 manifest 的 version）。 */
  readonly current: string
  /** 最新 Release 的版本（tag 去掉 `v` 前缀）。 */
  readonly latest: string
  /** 最新 Release 的原始 tag（构造升级地址用）。 */
  readonly tag: string
  /** latest 是否比当前版本新。 */
  readonly hasUpdate: boolean
  /** 新版本资产地址（固定名资产，带 tag）。 */
  readonly url: string
}
