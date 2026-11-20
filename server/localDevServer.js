import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 之前这里不读 .env,导致 .env 里的 LEDGERFLOW_API_PROXY_TARGET / LEDGERFLOW_API_PORT
// 全部失效:代理固定打到 3000,如果 3000 上是别的服务,前端首屏只会显示
// 「初始化数据存储 HTTP 404」,很难定位。这里显式加载项目根目录的 .env。
const envFile = path.join(root, '.env');
if (existsSync(envFile)) {
  try {
    process.loadEnvFile(envFile);
  } catch {
    // 老版本 Node 没有 process.loadEnvFile,退化为不加载(保持原有行为)。
  }
}

const apiPort = process.env.LEDGERFLOW_API_PORT || '3000';
const proxyTarget = process.env.LEDGERFLOW_API_PROXY_TARGET || `http://127.0.0.1:${apiPort}`;

// 字体文件不随仓库分发,tokens.css 里引用的是同源 /cdn/fonts/*.woff2。
// 这里把它转发到 R2,浏览器只看到同源请求,因此不再需要 R2 的 CORS 响应头。
const cdnTarget = process.env.LEDGERFLOW_CDN_PROXY_TARGET || 'https://pub-7c333d8dd649422b8c267f82f1a9b4c4.r2.dev';

const host = process.env.LEDGERFLOW_DEV_HOST || '127.0.0.1';
const port = Number(process.env.LEDGERFLOW_DEV_PORT || 5175);

const server = await createServer({
  server: {
    host,
    port,
    strictPort: true,
    watch: {
      // 编辑器/工具以「临时目录 + rename」落盘时,Windows 的 watcher 会抛
      // EBUSY 并直接终止 dev server,统一忽略这些瞬时 tmp 文件。
      ignored: ['**/.*.tmpdir/**', '**/*.tmpdir/**']
    },
    proxy: {
      '/api': {
        target: proxyTarget,
        changeOrigin: true
      },
      // /cdn/* 去掉前缀后拼到 R2:同一份 tokens.css 在 dev、preview、nginx 下行为一致。
      '/cdn': {
        target: cdnTarget,
        changeOrigin: true,
        rewrite: (requestPath) => requestPath.replace(/^\/cdn/, '')
      }
    }
  }
});

await server.listen();
console.log(`[ledgerflow] dev server -> http://${host}:${port}`);
console.log(`[ledgerflow] /api proxy  -> ${proxyTarget}`);
console.log(`[ledgerflow] /cdn proxy  -> ${cdnTarget}`);
server.printUrls();
