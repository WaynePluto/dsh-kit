/** 设置页「远程」分区经 `/remote-runtime/status` 读取的只读投影（宿主与浏览器共享）。 */
export interface RemoteRuntimeStatus {
  readonly relayRunning: boolean
  readonly connectorRunning: boolean
  /** 远程管理页地址：域名模式为公网裸域名，局域网模式为本机 loopback。 */
  readonly adminUrl: string
  /** 其他设备访问本机 dsh 的远程入口。 */
  readonly entryUrl: string
  /** 入口模式文案键：lan（每机器端口）或 domain（公网子域名）。 */
  readonly mode: 'lan' | 'domain'
}
