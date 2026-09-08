# DSH Mobile Control

电脑运行 DeepSeek Harness，手机扫码、电脑确认，继续同一个任务。
独立开源 Alpha 项目，非 DeepSeek 官方产品。

**0.2.0-alpha.1 · 仅适配 DSH 0.1.2-rc.1 · Node.js 24。**
默认公共中转尚未部署；已支持邀请码接入和自托管。
实机与发布门槛见 [验收记录](docs/ACCEPTANCE.md)。

## 功能

- 免账号、五分钟一次性二维码、电脑确认、设备独立授权与即时撤销。
- 工作区默认不共享；手机只访问电脑明确共享的工作区。
- 会话列表、创建、分页历史、文字聊天、流式回复、单次审批、结构化问题与取消。
- libsodium 端到端加密、每次重连新密钥、防篡改/重放、严格协议白名单。
- 重连补齐事件序号；提交持久化后确认，结果不确定时核对、不自动重发。
- 手机只保存设备密钥和配对信息，聊天不作离线持久化。

不包含文件管理、图片、全局/模型设置、推送、原生 App 或 P2P。

## 开发与测试

安装 Node.js 24、pnpm 11.19.0，在仓库根目录执行：

```powershell
pnpm install --frozen-lockfile
pnpm check
pnpm dev:relay
```

另开终端运行 `pnpm dev:mobile`。默认中转 http://127.0.0.1:4090，
网页 http://127.0.0.1:5173。HTTP 只允许回环地址；
手机跨网络使用需要已部署的 HTTPS 服务，普通用户使用服务提供的地址。

```powershell
pnpm exec playwright install chromium webkit
pnpm test:e2e
pnpm test:dsh
pnpm package
```

`test:e2e` 使用构建后的网页与本地模拟任务。
`test:dsh` 自动创建临时 DSH_HOME、工作区和随机端口，加载真实固定版本发布包，
模型网络层使用确定性夹具，不读取用户凭据/会话，不调用付费模型。
非全局安装可设置 DSH_PACKAGE_ROOT 指向发布包目录。
发行包验证：构建后设置 MOBILE_TEST_PACKAGED=1，再运行 test:dsh。

## 安装电脑插件

```powershell
dsh --version
dsh plugin --profile web add ./artifacts/dsh-mobile-host-0.2.0-alpha.1.tgz
```

安装包包含运行依赖，不依赖尚未发布的协议包；不安装或升级用户 DSH。
在 DSH 插件管理中配置 dsh-mobile-control：

| 配置 | 本地示例 |
| --- | --- |
| enabled | true |
| relayUrl | http://127.0.0.1:4090 |
| mobileUrl | http://127.0.0.1:5173 |

部署后填入服务提供的 HTTPS origin。地址不能包含路径、查询、fragment 或用户名密码。
Compose 部署的两个地址相同。

在电脑**本机已登录 DSH 的浏览器**点击“手机连接”，或访问相同端口下
`/mobile-control`。注册电脑、选择共享工作区、生成二维码。
手机扫码后，比对两端校验码，在电脑确认配对。
默认服务使用邀请码，自托管未限制注册时可留空。
管理页使用 DSH 原生浏览器认证，只允许回环连接和同源写入。

插件数据在 `$DSH_HOME/mobile-control/`，未设置时为用户目录下
`.dsh/mobile-control/`。不要提交该目录。清除浏览器数据后须重新配对。

## 发布与卸载

见 [部署文档](docs/DEPLOYMENT.md)、[安全模型](docs/SECURITY.md)。
`pnpm package` 生成电脑插件、手机网页两个 tgz 和 SHA256SUMS，位于 artifacts/。

卸载前撤销设备并禁用插件：

```powershell
dsh plugin --profile web remove @dsh-mobile/host
```

插件不主动取消 DSH 任务。若 profile 需要重启才能卸载，请等待任务结束。
插件停止后可删除其 mobile-control 数据，不能删除 DSH 的 sessions/credentials/profiles。

旧代理、VBS 和 CSS 补丁保存在 Git 基线提交 `0dc7ec1`；
实际运行目录与旧服务没有改动，迁移需另行验收。新旧授权不复用。

## 目录与许可

```text
apps/mobile/        React + Vite PWA
apps/relay/         Fastify + WebSocket + SQLite
packages/host/      DSH 插件与窄适配器
packages/protocol/  协议与加密通道
tests/              单元、真实 DSH、浏览器测试
scripts/            构建与测试辅助
deploy/             Caddy
docs/               安全、部署、验收
```

[MIT](LICENSE)。[第三方说明](docs/THIRD_PARTY.md)，发行包附带第三方许可证全文。
