# LedgerFlow 账号服务

LedgerFlow 的账号身份与财务资料分开保存：`auth_users` 管理登录身份，`ledger_users` 管理账本资料，
两者通过 `auth_users.ledger_user_id` 一对一关联。业务接口不会信任请求体或 URL 中的 `userId`，而是从
服务端校验过的 session cookie 获取当前账本用户。

## 首次启动

1. 服务启动后访问 `/`。
2. 如果没有 `LEDGERFLOW_DATA_DIR/database-provider.json`，页面会显示数据库初始化页。
3. `DATABASE_PROVIDER=auto` 时可选择 SQLite 或 MySQL；设置为 `sqlite` 或 `mysql` 时只允许对应类型。
4. 初始化成功后创建/升级 schema，随后进入注册页。
5. 第一个注册账号会绑定已有的 `default` 账本数据；后续账号拥有独立账本。

`LEDGERFLOW_REGISTRATION_MODE` 支持：

- `first-user`：默认值，只允许创建第一个账号，适合个人部署。
- `open`：允许创建多个账号，适合测试或明确需要多账号的部署。
- `closed`：关闭注册，只允许已有账号登录。

## 会话与安全

- 密码使用 Node `crypto.scrypt` 哈希，数据库不保存明文密码。
- Cookie 使用 `HttpOnly`、`SameSite=Lax`；生产环境默认加 `Secure`，本地 HTTP 测试可设置
  `LEDGERFLOW_COOKIE_SECURE=false`。
- 数据库只保存 session token 的 SHA-256 哈希，退出登录和撤销会话都会使 token 失效。
- 修改密码会撤销其他会话；可以单独撤销其他会话。
- 登录错误不区分“邮箱不存在”和“密码错误”，不存在的邮箱也会执行一次 dummy scrypt 校验。
- 同一来源和邮箱组合在 15 分钟内失败 8 次后暂时限流。该限流是单实例内存策略，多实例部署应
  在后续接入共享限流存储或网关限流。

## 忘记密码

- 重置令牌使用随机字节生成,数据库只保存令牌的 SHA-256 哈希。
- 令牌默认 30 分钟过期,只能使用一次;再次申请会作废旧令牌。
- 重置成功后撤销该账号的全部会话,并要求使用新密码重新登录。
- 申请接口不会透露邮箱是否已注册;同一来源和邮箱组合每小时最多申请 5 次。

## API

| 方法 | 路径                        | 说明                                     |
| ---- | --------------------------- | ---------------------------------------- |
| GET  | `/api/auth/status`          | 返回注册状态和当前会话用户，可未登录访问 |
| GET  | `/api/auth/me`              | 返回当前登录用户，未登录返回 401         |
| POST | `/api/auth/register`        | 创建账号并建立会话                       |
| POST | `/api/auth/login`           | 登录并建立新会话                         |
| POST | `/api/auth/logout`          | 撤销当前会话                             |
| POST | `/api/auth/forgot-password` | 发送密码重置邮件,不暴露邮箱是否存在      |
| POST | `/api/auth/reset-password`  | 使用一次性令牌设置新密码并撤销全部会话   |
| POST | `/api/auth/change-password` | 修改密码并撤销其他会话                   |
| POST | `/api/auth/revoke-sessions` | 撤销当前账号的其他会话                   |

## 忘记密码配置

忘记密码需要同时配置公开访问地址和 SMTP:

```dotenv
LEDGERFLOW_APP_URL=https://ledger.example.com
LEDGERFLOW_PASSWORD_RESET_MINUTES=30
LEDGERFLOW_SMTP_HOST=smtp.example.com
LEDGERFLOW_SMTP_PORT=587
LEDGERFLOW_SMTP_SECURE=false
LEDGERFLOW_SMTP_USER=no-reply@example.com
LEDGERFLOW_SMTP_PASSWORD=your-smtp-password
LEDGERFLOW_SMTP_FROM=LedgerFlow <no-reply@example.com>
```

`LEDGERFLOW_APP_URL` 用于生成邮件里的重置链接,必须是用户可访问的完整 HTTP(S) 地址。
SMTP 端口 `465` 通常搭配 `LEDGERFLOW_SMTP_SECURE=true`,端口 `587` 通常使用
STARTTLS 并保持 `false`。未配置 SMTP 时,登录页仍显示入口,服务端返回 503 并提示管理员配置。

`LEDGERFLOW_API_TOKEN` 仍然只用于服务级初始化、连接检查和 WebDAV 等管理/基础设施接口，
不作为用户登录凭证，也不应下发到前端。

## 持久化部署

SQLite 部署必须将 `LEDGERFLOW_DATA_DIR` 挂载到持久卷，例如容器内的 `/app/data`。Railway 使用
Dockerfile 部署时，需要在服务设置中新增 Volume，并将挂载路径设为 `/app/data`；Docker Compose
则使用仓库自带的 `./data:/app/data`。外部 MySQL 负责业务数据持久化，但 provider lock 仍建议
保存在持久卷中。

账号注销暂不开放自助删除，避免误删账本。需要注销时先导出备份，再由管理员执行冻结/保留策略。
