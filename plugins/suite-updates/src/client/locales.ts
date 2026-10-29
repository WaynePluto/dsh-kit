/** 浏览器半文案；`en` 是 key 的唯一来源，`zh` 必须逐键对应。 */

export const en = {
  title: 'Suite updates',
  currentVersion: 'Current version v{version}',
  checking: 'Checking…',
  check: 'Check for updates',
  upToDate: 'Already up to date.',
  foundUpdate: 'New version v{version} available.',
  copiedHint: 'Upgrade address copied — paste it into "Add plugin" to upgrade in place (no uninstall or restart needed).',
  copyFailed: 'Copy failed. Paste this upgrade address into "Add plugin": {url}',
  checkFailed: 'Check failed: {detail}',
} as const

export type LocaleKey = keyof typeof en

export const zh: Record<LocaleKey, string> = {
  title: '套件更新',
  currentVersion: '当前版本 v{version}',
  checking: '检查中…',
  check: '检查更新',
  upToDate: '已是最新版本。',
  foundUpdate: '发现新版本 v{version}。',
  copiedHint: '升级地址已复制，粘贴到「添加插件」即可原地升级（无需卸载或重启）。',
  copyFailed: '复制失败。请把这条升级地址粘贴到「添加插件」：{url}',
  checkFailed: '检查失败：{detail}',
}

/** 把 `{key}` 占位符替换为值；`values` 可省略（先取模板、再填值的用法），缺值时保留占位符原文。 */
export function fill(template: string, values?: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/gu, (match, key: string) => {
    const value = values?.[key]
    return value === undefined ? match : String(value)
  })
}
