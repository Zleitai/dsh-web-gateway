# 手机实机临时测试

使用已安装的 cloudflared Quick Tunnel，不需要购买域名或租服务器。
此入口运行真实中转及构建后的手机网页；电脑仍需安装插件并运行 DSH。
它不会代理 DSH 桌面网页或本机设备管理页面。以下命令均在 PowerShell 执行。

## 1. 构建并获取临时地址

终端 A：

```powershell
cd C:\Users\Luis\Projects\dsh-mobile-control
pnpm build
cloudflared tunnel --url http://127.0.0.1:4180
```

复制输出中的 `https://随机名字.trycloudflare.com`，保持终端 A 运行。
此时本地入口尚未启动，提前打开网址可能出现 502；完成下一步后重试。
不要把隧道指向旧代理或 DSH 的端口。

## 2. 启动网页与中转

终端 B，把下面的示例地址替换为终端 A 的真实地址（末尾不带 `/`）：

```powershell
cd C:\Users\Luis\Projects\dsh-mobile-control
$env:MOBILE_TEST_ORIGIN = 'https://随机名字.trycloudflare.com'
$env:RELAY_INVITE = [Convert]::ToHexString([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(24))
Set-Clipboard -Value $env:RELAY_INVITE
pnpm test:entry
```

邀请码已复制到剪贴板，稍后在电脑管理页粘贴。它不写入命令历史或应用日志。
请保留这个终端会话，重启入口时直接再次运行 `pnpm test:entry`，不要重新生成邀请码。
脚本仅监听 `127.0.0.1:4180`，最多注册三台电脑，数据库位于忽略提交的 `data/test-entry/`。

手机打开临时地址，应看到手机页面；`https://临时地址/health` 应返回 `status: ok`。
若无法访问，先在电脑打开 `http://127.0.0.1:4180/health` 区分本地启动与隧道故障。

## 3. 安装插件与配对

终端 C（首次安装执行一次，已有新版插件则跳过）：

```powershell
cd C:\Users\Luis\Projects\dsh-mobile-control
dsh --version
dsh plugin --profile web add ./artifacts/dsh-mobile-host-0.2.0-alpha.2.tgz
```

版本必须为 `0.1.2-rc.1`。当前插件尚未提供 DSH 设置页中的可视化配置卡片，
不能在那里找到 `enabled`、`relayUrl`、`mobileUrl`。
编辑 `%USERPROFILE%/.dsh/profiles/web/cordis.patch.yml`
（自定义 DSH_HOME 时使用该目录下的 `profiles/web/cordis.patch.yml`），
在末尾添加下面的覆盖项，将两个地址都替换为终端 A 的真实 HTTPS origin：

```yaml
- id: dsh-mobile-control
  config:
    enabled: true
    relayUrl: 'https://随机名字.trycloudflare.com'
    mobileUrl: 'https://随机名字.trycloudflare.com'
```

保留原文件中的其他内容。如果已有相同 id 的覆盖项，修改该项，不要重复添加。
本机地址保存在用户配置中，不要把个人临时地址写入仓库的插件安装模板。

保存后，启用热重载的 DSH web profile 会重新加载插件配置；
如果当前运行方式未启用热重载，等现有任务结束后再重启。
在电脑本机已登录 DSH 的浏览器打开相同端口的 `/mobile-control`
（例如 `http://127.0.0.1:3080/mobile-control`，可添加书签）：

1. 粘贴邀请码，注册电脑。
2. 选择一个已有测试工作区并共享，生成二维码。
3. 手机扫码，比对校验码，在电脑确认设备。
4. 创建会话发文字，在电脑核对同一会话；模型调用使用这台 DSH 已有配置。
5. 验证审批、取消、锁屏恢复、Wi-Fi 与移动网络切换、撤销设备。

单独打开网页不会自动连接电脑，必须通过配对二维码。电脑端管理页始终通过本机 DSH 地址打开。

## 4. 停止与再次测试

两个终端分别按 Ctrl+C 停止入口和隧道；电脑原有 DSH 任务继续运行。
中转断开或重启不应取消任务；可保持终端 A 不动，只重启终端 B 验证恢复。

Quick Tunnel 重启通常会获得新地址，不能用来承诺稳定入口。
当前插件将授权绑定到中转地址，更换地址会显示 `RELAY_CHANGED_REPAIR_REQUIRED`。
此时需要停用插件、备份并重置**插件自己的** `$DSH_HOME/mobile-control/` 数据，然后重新注册与配对。
不要删除 DSH 的 sessions、credentials 或 profiles。要长期保留配对，请迁移到固定 HTTPS 地址。

实际手机、隧道可达性和真实模型流程需要实测；本地验证通过不表示这些项目已经通过。
Quick Tunnel 仅用于测试，不提供可用性保证；官方说明：
[Cloudflare Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/)。
