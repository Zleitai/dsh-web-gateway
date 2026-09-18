# 迁移方案

## 已归档的版本

- `legacy/web-proxy-v1` 与标签 `web-proxy-v1` 保存原网站代理和移动样式插件。
- `archive/mobile-pwa` 与标签 `mobile-pwa-v0.2.0-alpha.2` 保存独立手机端原型。
- 原代理进程、开机启动项、`@dsh-mobile/host` 插件和对应配置覆盖已从电脑移除。
- 原域名 `dsh.luisnode.com` 的 Access 应用与 Tunnel 路由在退役时删除。

归档分支只接受安全修复和恢复所需说明，不继续增加产品功能。

## 已完成的切换

1. `main` 提供连接器、受支持的 DSH 启动方式和移动增强层。
2. V2 使用 `127.0.0.1:3090`，本机管理页使用 `127.0.0.1:3091`，内部原生 DSH 使用 `127.0.0.1:3092`。
3. Cloudflare Access 与 Tunnel 只保留 `dsh.luisnode.com`，上游指向 `http://127.0.0.1:3090`。
4. Windows 计划任务 `DSH Web Gateway` 管理 V2；Cloudflared 继续由独立 Windows 服务管理。
5. 旧代理的 `127.0.0.1:3088`、启动脚本和旧域名不再作为回退路径。

需要排查历史实现时，可以查看归档分支或标签。恢复旧代理必须作为一次新的部署执行，不能假设电脑仍保留其运行环境或边缘路由。

## PWA 原型退出

独立 PWA 临时入口已经停止。`@dsh-mobile/host` 与对应的
`dsh-mobile-control` 配置覆盖已经从 web profile 删除；DSH 的 sessions、credentials 和其他 profile 数据均保留。

PWA 中的加密、设备授权、撤销、请求去重和断线恢复实现保留在归档分支，未来若建设
托管连接服务，可按需提取，而不是继续维护整套替代界面。
