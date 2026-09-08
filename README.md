# DSH Mobile Control

用于从手机浏览器访问电脑上 DeepSeek Harness 的代理与移动端样式插件。

## 功能

- 转发 HTTP 和 WebSocket 请求到本机 DSH，并改写 Host / Origin。
- 通过 DSH 插件提供手机样式，适配窄屏布局、弹窗、输入框和安全区域。
- 提供 Windows 隐藏窗口启动器。

## 目录

```text
src/proxy.mjs              HTTP / WebSocket 代理
plugins/mobile-fix/        DSH 手机样式插件及挂载配置
scripts/start-proxy.vbs    Windows 隐藏窗口启动器
```

## 启动代理

需要 Node.js 22 或更高版本，以及已启动的 DSH Web 服务。代理仅使用 Node.js 标准库，无需执行 `npm install`。

```sh
npm start
```

| 服务 | 地址 |
|---|---|
| DSH Web | `127.0.0.1:3080` |
| 本项目代理 | `127.0.0.1:3088` |

端口目前定义在 `src/proxy.mjs` 中。启动前确认 3088 未被其他代理占用。在 Windows 上，也可双击 `scripts/start-proxy.vbs`；需要 PATH 中存在 `node.exe`。

## 手机插件

`plugins/mobile-fix` 是独立的 DSH bundle，包含 `package.json`、`cordis.patch.yml` 和 `index.mjs`。将此本地包安装到目标 DSH Web profile 后，通过其 bundle patch 挂载。只启动代理不会加载手机插件。

插件依赖 DSH 的 `webServer.register` 和 `webServer.tapIndex` 接口，提供 `/__dsh_mobile_fix.css` 并向页面注入样式链接。CSS 内联在 `index.mjs` 中，主要在屏幕宽度不超过 640px 时生效。修改插件后需重新加载插件或重启 DSH。

此仓库保留既有实现，尚未建立 DSH 版本兼容矩阵。样式依赖 DSH 页面类名，升级 DSH 后需要重新检查手机布局。远程目录选择还需要 DSH 提供适合浏览器使用的目录选择器。

## 远程访问与认证

原部署方式为：手机 → Cloudflare Access → Cloudflare Tunnel → 本机代理 → DSH。

本项目不配置 Cloudflare，也不包含隧道令牌。代理自身没有登录功能，必须在公网入口配置身份验证，并保持代理与 DSH 仅监听回环地址。Host / Origin 改写不是身份验证；DSH 自身要求的登录仍需完成。

## 检查

```sh
npm run check
```

该命令检查代理及插件的 JavaScript 语法，不启动服务。HTTP / WebSocket 转发、DSH 插件加载和手机布局需要在兼容的 DSH 环境中另行验证。

此目录作为重构源码使用。修改这里不会自动替换其他目录中已部署的代理或插件。
