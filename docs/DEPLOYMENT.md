# 部署

本次开发未发布服务、配置 DNS 或使用生产凭据。

## 自托管

需要 Docker 与 Compose v2：

```powershell
Copy-Item .env.example .env
docker compose up --build -d
```

本地访问 http://localhost:8080/health 和 http://localhost:8080/。
手机不能通过自己的 localhost 访问电脑。

公网部署由维护者提供可信 HTTPS origin。Caddy 配置：
SITE_ADDRESS 为服务器主机名（如 mobile.example.com），
MOBILE_ORIGIN=https://mobile.example.com，HTTP_PORT=80、HTTPS_PORT=443。
准备 DNS、证书签发所需的 80/443 可达性，再启动容器。
普通用户只需填服务提供的地址，不必自己购买域名。

公共 Alpha **必须设置随机 RELAY_INVITE**。
空邀请码表示自托管开放注册。RELAY_INVITE_USES 默认 20；
配额首次写入 SQLite 后，重启或更改数字不会补充已消耗的次数。
轮换为新的随机邀请码可开放新一批配额；当前配置只接受当前邀请码。
邀请码只控制电脑注册，不授予设备控制权。

## 配额与监控

默认：100 个已注册电脑、500 条 WebSocket、每电脑 8 个手机、
每连接每分钟 6000 帧、512 KiB 最大外层消息、1 MiB 发送缓冲。
电脑端每手机排队最多 32 个业务请求，每次只订阅一个会话。
注册每分钟每来源 5 次，连接升级每分钟每来源 30 次。
超限明确拒绝或断开，不无限缓存。

中转不信任 X-Forwarded-For；在 Caddy 后，来源级限速按代理出口计算。
邀请码小范围测试需控制接入突发量；不要随意开启 trustProxy。
当前单实例，不能把 SQLite 放到多个中转后使用轮询负载均衡。

/health 提供存活状态；/metrics 仅在内部中转端口提供累计连接、
拒绝、帧、流量、活动连接、断开码与重连耗时汇总，重启清零，不包含会话内容。
监控系统可据此计算接入成功率与重连耗时；公开试运行仍需验证告警阈值。
Caddy 未启用访问日志，禁止在代理或应用启用 token、URL query、
请求体或 WebSocket payload 调试记录。

## 运维与发行

- 停止中转后备份整个 relay-data 卷，避免漏掉 SQLite WAL。
- 更换数据库需要电脑重新注册；更改 Web origin 需要手机重新配对。
- 更改插件中转地址会拒绝复用旧注册，需在插件停止后重置其独立数据并重新配对。
- 升级前备份插件 mobile-control 目录，不更改用户 DSH 版本。
- docker compose down 保留卷，不要无意使用删除卷参数。
- 生产应设置容器资源上限，并完成实机、故障恢复和小范围运行验证。

发布前运行 pnpm check、test:e2e、package、发行包 test:dsh、
docker compose config/build 和健康检查。
发布 artifacts 下的两个 tgz 与 SHA256SUMS，不发布 staging、测试诊断或 .env。
