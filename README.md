# LedgerFlow

> 面向个人长期财务管理的 AI-native 记账系统。快速记一笔、看懂现金流、管理负债和预算，并把 AI 深度接入账单识别、信贷整理、投资分析与财务复盘。

LedgerFlow 当前版本：`0.5.8`

在线体验：<https://ledgerflow.up.railway.app>

> 说明：项目仍处于快速迭代阶段，功能、界面和数据结构会持续调整。重要数据请务必保留本地 JSON / WebDAV / OSS / MySQL 快照等备份。

<table>
  <tr>
    <td><img src="docs/images/screenshot-1.png" alt="LedgerFlow screenshot 1" /></td>
    <td><img src="docs/images/screenshot-2.png" alt="LedgerFlow screenshot 2" /></td>
  </tr>
  <tr>
    <td><img src="docs/images/screenshot-3.png" alt="LedgerFlow screenshot 3" /></td>
    <td><img src="docs/images/screenshot-4.png" alt="LedgerFlow screenshot 4" /></td>
  </tr>
</table>

## 产品定位

LedgerFlow 的目标不是做一个传统流水表，而是做一个更适合年轻用户日常使用的个人财务工作台：

- 记账要快：手动录入、账单导入、AI 识别都能进入同一套交易数据。
- 信息要少而准：默认展示关键结论，详情按需展开。
- AI 要能真正介入：不仅聊天，还能识别账单、整理负债、分析基金、生成复盘建议。
- 数据要可控：本地优先，支持 JSON、WebDAV、对象存储和 MySQL 快照备份。
- 结果要能追溯：交易、还款、附件、导入来源和备份版本尽量保留上下文。

## 主要能力

### 记账与数据概览

- 收入、支出、转账、还款、调整等流水管理。
- 微信 / 支付宝账单导入，支持重复处理与导入来源标记。
- 分类、账户、标签、余额变动和回收站管理。
- Dashboard 展示本月结余、净资产、趋势、分类结构、异常提醒和可排序模块。

### AI 助手

- AI 记账：从自然语言、截图、账单文本中提炼结构化交易。
- AI 问答：基于当前账本上下文做财务分析、趋势解释和行动建议。
- AI 信贷管家：识别花呗、信用卡分期、消费贷、贷款账单，并可带去还款管理。
- 支持 OpenAI-compatible 接口、自定义 Base URL / API Key / Model。
- 支持全局记忆：长期偏好可沉淀、查看、启用/停用和管理。

### 预算、负债与分析

- Smart Budget：预算方案、分类预算追踪、超预算提醒。
- Repayment Management：负债清单、还款计划、实际还款记录、信贷识别预填。
- Financial Analysis：围绕过去 / 现在 / 未来生成财务分析与下一步行动。
- 订阅管理、汇率工具、工资工具等辅助页面。

### 投资理财

- 投资持仓、自选基金和持仓流水。
- AI 基金分析与基金持仓分析。
- 自选基金可沉淀历史业绩、资产分布、行业分布、重仓股票、费率、基金公司等信息。
- 投资 AI 聊天支持图片、联网核验开关、停止请求、复制 / 重试 / 删除等消息操作。

### 备份与同步

- 本地 JSON 导出 / 导入。
- WebDAV 备份与恢复，支持版本列表。
- 阿里云 OSS / S3 兼容对象存储备份。
- MySQL 快照同步：把完整备份快照写入 MySQL，恢复前校验 checksum。
- 生产镜像内置 Nginx + Node API，`/api/*` 走同容器内部 API。

## 快速部署

推荐使用 Docker Compose。当前镜像是一体化部署：Nginx 提供前端，Node API 负责 MySQL 快照、连接检查和受保护的 WebDAV 同源代理。

```yaml
services:
  ledgerflow:
    image: 34v0wphix/ledgerflow:latest
    container_name: ledgerflow
    ports:
      - '18080:80'
    environment:
      LEDGERFLOW_API_PORT: '8787'
      LEDGERFLOW_MAX_BODY_BYTES: '52428800'
      LEDGERFLOW_API_TOKEN: '${LEDGERFLOW_API_TOKEN:?Set LEDGERFLOW_API_TOKEN to a long random value}'
      LEDGERFLOW_WEBDAV_ALLOWED_HOSTS: '${LEDGERFLOW_WEBDAV_ALLOWED_HOSTS:-}'
      MYSQL_HOST: 'rm-xxxx.mysql.rds.aliyuncs.com'
      MYSQL_PORT: '3306'
      MYSQL_USER: 'ledgerflow'
      MYSQL_PASSWORD: 'CHANGE_ME'
      MYSQL_DATABASE: 'ledgerflow'
      MYSQL_SSL: 'false'
    restart: unless-stopped
```

启动：

```bash
docker compose up -d
```

升级：

```bash
docker compose pull
docker compose up -d
```

访问：

```text
http://localhost:18080
```

## 必填与可选环境变量

### 必填

`LEDGERFLOW_API_TOKEN`

用于保护 MySQL 快照 API 和 WebDAV 同源代理。请使用足够长的随机字符串，并在页面里的 MySQL 快照令牌 / WebDAV 代理令牌输入同一个值。

### MySQL 快照

```env
MYSQL_HOST=rm-xxxx.mysql.rds.aliyuncs.com
MYSQL_PORT=3306
MYSQL_USER=ledgerflow
MYSQL_PASSWORD=CHANGE_ME
MYSQL_DATABASE=ledgerflow
MYSQL_SSL=false
```

MySQL 目前用于保存完整账本快照，不会直接替代浏览器本地数据。详见 [docs/mysql-snapshot-sync.md](docs/mysql-snapshot-sync.md)。

### WebDAV 代理白名单

```env
LEDGERFLOW_WEBDAV_ALLOWED_HOSTS=dav.example.com
```

可选但推荐。填写后，WebDAV 同源代理只允许访问这些域名。多个域名用英文逗号分隔。

如果不填写，服务端仍会强制：

- 只允许 HTTPS 上游。
- 拒绝 localhost / 内网 / 链路本地 / 保留网段。
- 请求必须带 `X-LedgerFlow-Api-Token`。

## 本地开发

要求：

- Node.js 20+
- npm 10+

安装依赖：

```bash
npm install
```

启动前端：

```bash
npm run dev
```

如果需要本地测试 MySQL 快照 API：

```bash
LEDGERFLOW_API_TOKEN=replace-with-a-long-random-token \
MYSQL_HOST=127.0.0.1 \
MYSQL_PORT=3306 \
MYSQL_USER=ledgerflow \
MYSQL_PASSWORD=change-me \
MYSQL_DATABASE=ledgerflow \
npm run server:mysql
```

常用命令：

```bash
npm run test
npm run build
npm run lint
```

## 安全说明

- LedgerFlow 是个人财务工具，请不要把测试令牌、AI Key、MySQL 密码提交到仓库。
- `LEDGERFLOW_API_TOKEN` 不是登录系统，只是保护当前内置 API 的访问令牌。
- WebDAV 同源代理已做服务端鉴权和公网 HTTPS 校验，但仍建议配置 `LEDGERFLOW_WEBDAV_ALLOWED_HOSTS`。
- AI 结果只作为辅助分析，涉及投资、借贷、还款等决策时请自行核对来源和数字。
- 当前数据仍以浏览器本地持久化为主，远程备份建议作为安全副本使用。

## 项目结构

```text
src/
  app/                 应用入口、路由、全局样式
  pages/               页面级模块
  features/            业务功能组件与模型
  shared/              共享 API、状态、工具与 UI
server/                内置 Node API
docker/                容器启动脚本
docs/                  部署与同步文档
plans/                 版本计划与主线任务
release-notes/         历史版本说明
```

## License

This repository is released under **CC BY-NC-SA 4.0**.

See:

- [LICENSE](LICENSE)
- [LICENSES/CC-BY-NC-SA-4.0.md](LICENSES/CC-BY-NC-SA-4.0.md)
