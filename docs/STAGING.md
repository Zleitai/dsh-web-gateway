# 独立测试入口

V2 必须先使用独立 hostname 验收。不要直接修改现有生产 hostname，也不要把新入口裸露在公网。

## 边缘配置

本机现有 `cloudflared` 以 Windows 服务运行，并使用 token-file 接入远程管理的 Tunnel。
因此测试入口应在 Cloudflare 控制台完成以下配置，不需要再启动第二个 Quick Tunnel：

1. 先为测试 hostname 建立 Cloudflare Access 应用和允许策略；
2. 在同一 Named Tunnel 中新增 Public Hostname；
3. Service 指向 `http://127.0.0.1:3090`；
4. 不设置 HTTP Host Header 改写；
5. 保留现有生产 hostname 与 `127.0.0.1:3088` 的路由。

Access 登录方式使用 **One-time PIN**，应用内关闭“接受所有可用的标识提供程序”，
只选择 `onetimepin` 并开启即时身份验证。新版 Cloudflare Zero Trust 账号会默认添加
Cloudflare 账号登录；若保留该默认方式，未登录控制台的手机会被带到
`dash.cloudflare.com`，不符合本项目的邮箱验证码体验。允许策略仍须限制到明确的邮箱，
不能只依赖 OTP 登录方式本身。

连接器会把测试 hostname 作为 DSH 的 `--trusted-host`。普通 HTTP 与 WebSocket 因此使用
同一个公开 authority，不再经过旧代理的 Host/Origin 改写。

## 本机启动

在没有运行中任务时安装可选布局插件：

```powershell
pnpm install --frozen-lockfile
pnpm install:layout
```

启动独立 V2 实例，其中 public origin 必须和 Cloudflare 中的测试 hostname 完全一致：

```powershell
pnpm start -- --public-origin https://<test-hostname> --workspace C:\<workspace>
```

启动成功后只在本机打开 `http://127.0.0.1:3091/`。该页面显示认证二维码；二维码包含
当前 DSH 进程的登录凭据，不应截图、转发或写入工单。凭据保存在二维码 URL 的
fragment 中，Cloudflare 请求和普通访问日志不会收到它；登录完成后由本机入口兑换为
DSH 的签名 Cookie。

## 验收与回退

在 iPhone Safari 与 Android Chrome 上至少验证：

- 首次打开经过 Access，再由二维码完成 DSH 登录；
- 刷新页面和 WebSocket 重连；
- 打开已有会话、发送文字、取消任务和处理审批；
- 设置窗口、插件页、长文本、代码块和屏幕旋转；
- 锁屏与 Wi-Fi/移动网络切换后的恢复。

测试失败时先删除或停用测试 Public Hostname，再停止 V2。现有生产 hostname 仍指向
`127.0.0.1:3088`，无需改动。不要在任务运行期间重启 DSH 或安装、移除插件。
