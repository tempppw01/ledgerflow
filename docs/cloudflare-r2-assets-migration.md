# 阿里云 OSS 资源迁移到 Cloudflare R2

应用原先使用 `cloudreve-bei.oss-cn-guangzhou.aliyuncs.com` 的 `ledgerflow/`
前缀存放公开字体、图标和插画。当前迁移目标为 R2 的 `ledgerflow-public` Bucket,
资源直接存放在 Bucket 根目录。迁移工具只处理应用实际引用的公开对象,不会列举或迁移
私有备份对象。

## 迁移范围

迁移脚本会从源码中自动发现资源,并补充两个动态排序图标。目前共 73 个对象:

- `fonts/`:14 个字体文件
- `public/`:7 个品牌图与公众号图片
- `ui/`:48 个 SVG 图标
- `Illustrations/`:4 个插画

对象路径保持不变,例如:

```text
旧:https://cloudreve-bei.oss-cn-guangzhou.aliyuncs.com/ledgerflow/ui/chat.svg
新:https://<R2_PUBLIC_BASE_URL>/ui/chat.svg
```

## 1. 准备 R2

1. 创建独立的公开 R2 Bucket,不要把财务备份 Bucket 直接设为公开。
2. 创建具备 Object Read & Write 权限的 R2 API Token。
3. 为 Bucket 配置公开访问域名,可以使用 R2 自定义域名或 `r2.dev` 开发域名。
4. 记住账号 ID、Bucket 名称、Access Key ID 和 Secret Access Key。

生产环境建议使用自定义域名,不要长期依赖 `r2.dev` 域名。

## 2. 设置环境变量

PowerShell 示例:

```powershell
$env:R2_ACCOUNT_ID="<account-id>"
$env:R2_BUCKET="<bucket-name>"
$env:R2_PREFIX=""
$env:R2_PUBLIC_BASE_URL="https://assets.example.com"
$env:R2_ACCESS_KEY_ID="<access-key-id>"
$env:R2_SECRET_ACCESS_KEY="<secret-access-key>"
```

注意:

- `VITE_` 前缀只用于浏览器构建变量,不要把 R2 Secret 写成 `VITE_` 变量。
- 迁移凭据只应在部署机器或本地临时终端中使用。
- 当前部署使用 Bucket 根目录,R2 对象键不再带 `ledgerflow/` 前缀。
- `R2_PUBLIC_BASE_URL` 应填写域名根地址,不要附加资源目录。

## 3. 检查对象清单

```powershell
npm run assets:migrate:r2 -- --dry-run
```

脚本应输出 73 个对象 URL。可以先手动访问其中的字体、图标和图片,确认源对象正常。

## 4. 上传并校验

```powershell
npm run assets:migrate:r2
```

脚本会执行以下步骤:

1. 从旧 OSS 公开地址下载对象。
2. 按相同路径上传到 R2 的 `R2_PREFIX` 下;当前部署的 `R2_PREFIX` 为空。
3. 设置正确的 `Content-Type` 和长期缓存头。
4. 通过 `R2_PUBLIC_BASE_URL` 执行 HEAD 校验并比对文件大小。

默认并发数为 6,可以通过环境变量调整:

```powershell
$env:ASSET_CONCURRENCY="4"
```

重复运行会覆盖同名对象,可用于断点续传或重新同步。

## 5. 独立复验

```powershell
npm run assets:migrate:r2 -- --verify
```

该命令不需要 R2 写入密钥,只需要:

```powershell
$env:R2_BUCKET="<bucket-name>"
$env:R2_PUBLIC_BASE_URL="https://assets.example.com"
```

## 6. 前端切换

资源全部验证通过后再切换前端引用。需要替换:

- `index.html` 中的图标和 PWA 图标
- `vite.config.ts` 中的 PWA 缓存规则
- `src/shared/config/brandAssets.ts`
- `src/shared/config/app.ts`
- `src/pages/assistant/AssistantPage.tsx`
- `src/features/transactions/components/TransactionTable.tsx`
- `src/app/styles/tokens.css`
- `src/app/styles/global.css`
- `src/app/styles/assistant.css`

切换前必须提供最终的 R2 公开域名。迁移资源本身不会自动修改业务代码,以避免在域名未确定时
把生产资源地址改坏。

## 回滚

迁移期间旧 OSS 保持不变。若 R2 验证失败,不修改前端配置即可继续使用旧地址。
只有 73 个对象在 R2 全部返回 HTTP 200 且文件大小一致后,才建议执行前端切换。

## 7. 图标必须走同源 `/cdn`,不要直连 R2 公网域名(2026-11-27)

字体早就改成同源了(`@font-face` 的 `src` 里 `/cdn/fonts/*.woff2` 排第一、R2 绝对地址作兜底),
但**图标一直直连 `pub-*.r2.dev`**,包括侧栏导航图标(53 个常量)和三处 CSS `background-image`。
这不是风格问题,是可量化的缺陷。

同一会话、同一个文件、都带 cache-buster 的对照实测:

| 取法 | 耗时 |
| --- | --- |
| 同源 `/cdn/ui/chat.svg` | **461 ms** |
| 直连 `pub-*.r2.dev/ui/chat.svg` | **2833 ms** |

用 `curl` 单独量更明显(同源 0.45~1.05 s,直连 3.8~6.1 s):直连要为 R2 公网域名
单独建连接并做 TLS 握手,跨域还不能复用主站连接。

**表现到界面上**是侧栏图标延迟好几秒才出现,以及偶发完全不出现 ——
我自己在截图里就撞到过一次(同一份代码,前一张侧栏图标整列空白,后一张正常),
一开始还误以为是 CSS 改坏了,差点记成回归。R2 一个文件失败不影响页面其它部分,
所以这种失败既不会被闸门拦住,也不容易复现。

修法:`brandAssets.ts` 等处的 58 处绝对地址改成同源 `/cdn/...`。
`/cdn` 在三条服务路径上都已反代到 R2 —— `vite.config.ts`、`server/localDevServer.js`、`nginx.conf`,
所以 dev / preview / 生产都成立。`tokens.css` 里 13 处 R2 绝对地址**保持不变**:
那是 `@font-face src` 有意的第二候选,同源地址 404 时浏览器会回退过去。

验证:登录后 28 张图片全部加载成功、0 张裂图、页面里对 `r2.dev` 的请求数 0。
`check:r2-fetch` 只拦 `fetch()`,拦不住 `<img src>` —— 所以这条靠人看着,别改回去。

顺带修了两处测试:它们把绝对地址写死在选择器/断言里,改成引用同一个常量,
并按 jsdom 的行为用 `getAttribute('src')` 而不是 `.src`(后者会按文档 base URL 解析成绝对地址)。
