# 远程运行时（remote-runtime）

在官方 dsh 宿主内托管本机的远程能力：拉起并认领 relay 与 connector、写入 dsh 登录令牌文件、
向 connection 行提供 `dshRemoteTrust` 信任投影。随 DSH Remote 套件安装，不可单独停用。

## 使用入口：设置 → 远程

设置页的「远程」分区显示（经 `/remote-runtime/status` 只读 RPC）：

- **远程服务 / 远程连接器**：relay 与 connector 的运行状态（按 pid 注册表探测存活）。
- **远程入口**：其他设备访问本机 dsh 的地址——局域网模式为 `http://<本机IP>:<端口>`
  （默认 30809），公网域名模式为 `https://<机器名>.<域名>`；可一键复制。
- **打开远程管理页**：跳转 relay 管理页（账号、设备、远程入口配置）。从本机打开时
  loopback 免登录直达；远程浏览器打开时需正常登录。

远程管理页没有官方桌面版原生菜单入口（Electron 菜单归官方壳所有，插件只在网页层运行），
该设置分区即桌面端的常驻管理入口。

## 行为要点

- relay/connector 由两级分离启动器拉起（L1 即退、L2 常驻并脱离 taskkill /T 树枚举），
  日志在 `<dsh-remote home>/logs/`；宿主重启后按 `processes/*.json` 的 pid 认领仍存活的
  子进程，不重复拉起。
- dsh 登录令牌写入 `<dsh-remote home>/dsh-token`，relay 首访 401 时读取并代发一次
  token 重定向。
- 状态 RPC 只读，不提供启停操作：远程能力随宿主常驻（D27），停止远程服务即退出 dsh。
