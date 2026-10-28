# 套件更新（suite-updates）

套件自身的检查更新入口：在插件管理页「套件」详情页的配置区显示当前已装版本，
点「检查更新」由宿主半经 kit 私有 /api 通道（`/api/suite-updates`，kit 信封，D16）
查询 GitHub `releases/latest` 公开 API。发现新版本时自动把新版本资产地址复制到
剪贴板，粘贴到「添加插件」即可原地升级（D21：无需卸载、无需重启）。

## 行为要点

- 当前版本来自插件管理器的 Bundle 清单（profile 依赖闭包里套件 manifest 的
  `version`），不是本组件自己的版本。
- 检查是手动触发的（打开详情页自动查一次，可重复点击）；GitHub 无认证限额
  60 次/小时，超时 10 秒，失败显示原因不阻塞页面。
- 只做查询与复制：安装动作完全走官方「添加插件」流程，本组件不实现第二套
  插件管理器，不写任何 profile/设置。
- 升级地址形式与发布产物一致：`https://github.com/WaynePluto/dsh-kit/releases/
  download/<tag>/dsh-kit.tar.gz`（固定名资产，tag 变化即地址变化）。

## 验证

```powershell
pnpm --filter "@dsh-kit/dsh-plugin-suite-updates" test   # 版本比较/地址构造纯函数
node scripts/suite-upgrade-check.mjs                     # 在线升级整链路（含本组件行 ACTIVE）
```

浏览器验收：插件管理页 → 套件详情页出现「套件更新」配置区；断网或清空网络时
显示检查失败原因；深浅主题各验收一次。
