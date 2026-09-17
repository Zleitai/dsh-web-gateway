# DSH Web Gateway

从手机或其他浏览器通过一个固定 HTTPS 地址，直接使用电脑上正在运行的
DeepSeek Harness Web 界面。

本仓库正在开发 V2。V2 不再维护一套独立的手机聊天客户端，而是保留 DSH
原生会话、设置、工具、审批和新版本功能，只负责安全接入、启动管理与移动布局适配。

## 当前状态

- 生产中的 `dsh.luisnode.com` 暂时继续使用旧网站代理，切换 V2 前不改动。
- V2 正在独立测试地址 `dsh-v2.luisnode.com` 验收，尚未接管生产地址。
- 当前适配目标为 DSH `0.1.5-rc.1` 及其公开的 `--trusted-host` 接入方式。
- 新版本会先在独立测试地址验收，再切换现有域名。

## 连接器原型

当前原型使用独立端口启动原生 DSH Web，并在本机管理页显示公网认证二维码。
它不会启动或配置公网隧道，也不会接管现有域名。

`plugins/mobile-layout` 是为 DSH `0.1.5-rc.1` 验证的可选窄屏增强插件。
它只注入本地 CSS，修复手机设置窗口过窄等布局问题；不添加悬浮按钮，也不实现第二套聊天界面。

```powershell
pnpm install --frozen-lockfile
pnpm check
pnpm test:dsh
pnpm install:layout
pnpm start -- --public-origin https://测试域名 --workspace C:\绝对\工作区路径
```

默认公网入口端口为 `3090`，内部 DSH 端口为 `3092`，本机管理页为 `http://127.0.0.1:3091/`。
测试域名必须已经通过受保护的出站隧道指向 `127.0.0.1:3090`。二维码只包含一个
十分钟有效、只能使用一次的高熵配对码；Cloudflare 登录完成后，本机网关才用它兑换
DSH 的签名 Cookie。DSH 启动凭据始终留在电脑内，不进入公网请求地址和访问日志。
连接器只验证 DSH `0.1.5-rc.1`，检测到其他版本会明确退出。
样式插件可用 `pnpm remove:layout` 从 web profile 移除；移除或安装后应在没有运行中任务时重启 DSH。
独立 hostname、Cloudflare Access 与回退步骤见 [docs/STAGING.md](docs/STAGING.md)。

## 历史版本

完整源码均保留在 Git 中：

| 分支或标签 | 内容 | 状态 |
| --- | --- | --- |
| `legacy/web-proxy-v1` / `web-proxy-v1` | 原网站代理与 DSH 移动样式插件 | 当前回退基线 |
| `archive/mobile-pwa` / `mobile-pwa-v0.2.0-alpha.2` | 独立 PWA、中转、配对和端到端加密原型 | 已冻结，不再作为产品主线 |
| `main` | 固定网址访问原生 DSH Web 的 V2 | 开发中 |

查看历史版本无需复制文件：

```powershell
git switch archive/mobile-pwa
git switch legacy/web-proxy-v1
git switch main
```

切换分支只用于查看和开发源码，不会改变已经运行的 Windows 进程或 Cloudflare 配置。

## V2 原则

- 普通用户只需要安装电脑端程序并打开固定网址。
- DSH 与隧道仍只监听或连接本机受控入口，不直接开放公网端口。
- 使用 DSH 自带的 Host、Origin 与进程令牌认证，不再伪造请求头绕过检查。
- 公网入口必须先经过独立身份验证；DSH 认证作为第二层保护。
- 移动适配失效时，原生 DSH 页面仍可访问，不让样式插件决定核心功能是否可用。
- DSH 更新先经过兼容测试，再更新支持范围。

架构和边界见 [V2 架构](docs/ARCHITECTURE.md)，安全切换步骤见
[迁移方案](docs/MIGRATION.md)。

本项目不是 DeepSeek 官方产品。[MIT](LICENSE)。
