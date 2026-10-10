/** 设置页「远程」分区的中英文案。 */
export type RemoteRuntimeKey =
  | 'nav' | 'intro' | 'relayLabel' | 'connectorLabel' | 'running' | 'stopped'
  | 'entryLabel' | 'entryLanHint' | 'entryDomainHint'
  | 'adminLabel' | 'adminHint' | 'openAdmin' | 'copy' | 'copied' | 'refresh' | 'loadFailed'

export const NS = 'dsh-plugin-remote-runtime'

export const zh: Record<RemoteRuntimeKey, string> = {
  nav: '远程',
  intro: '本机的远程访问能力：其他设备经远程入口使用这台机器的 dsh，管理页负责账号、设备与入口配置。',
  relayLabel: '远程服务',
  connectorLabel: '远程连接器',
  running: '运行中',
  stopped: '未运行',
  entryLabel: '远程入口',
  entryLanHint: '同一局域网内的设备经此地址访问本机 dsh（局域网模式，按机器端口）。',
  entryDomainHint: '任意设备的浏览器经此地址访问本机 dsh（公网域名模式，按机器子域名）。',
  adminLabel: '远程管理页',
  adminHint: '管理账号、设备与远程入口；从本机打开时免登录直达。',
  openAdmin: '打开远程管理页',
  copy: '复制',
  copied: '已复制',
  refresh: '刷新',
  loadFailed: '状态读取失败',
}

export const en: Record<RemoteRuntimeKey, string> = {
  nav: 'Remote',
  intro: 'Remote access on this machine: other devices use this dsh through the remote entry; the management page handles accounts, devices and entry configuration.',
  relayLabel: 'Remote service',
  connectorLabel: 'Remote connector',
  running: 'Running',
  stopped: 'Not running',
  entryLabel: 'Remote entry',
  entryLanHint: 'Devices on the same LAN reach this dsh via this address (LAN mode, per-machine port).',
  entryDomainHint: 'Any browser reaches this dsh via this address (public domain mode, per-machine subdomain).',
  adminLabel: 'Management page',
  adminHint: 'Manage accounts, devices and remote entries; opens without login from this machine.',
  openAdmin: 'Open management page',
  copy: 'Copy',
  copied: 'Copied',
  refresh: 'Refresh',
  loadFailed: 'Failed to load status',
}
