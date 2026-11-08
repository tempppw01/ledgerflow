import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const appLogoUrl =
  'https://cloudreve-bei.oss-cn-guangzhou.aliyuncs.com/ledgerflow/public/logo.png?v=2';

const apiProxyTarget = process.env.LEDGERFLOW_API_PROXY_TARGET || 'http://127.0.0.1:8787';

const DEV_SW_CLEANUP_SOURCE = `
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheKeys = await caches.keys();
    await Promise.all(cacheKeys.map((key) => caches.delete(key)));
    await self.registration.unregister();
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    await Promise.all(clients.map((client) => client.navigate(client.url)));
  })());
});
`;

function devServiceWorkerCleanup(): Plugin {
  return {
    name: 'ledgerflow-dev-service-worker-cleanup',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/sw.js', (_request, response) => {
        response.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        response.setHeader('Cache-Control', 'no-store');
        response.end(DEV_SW_CLEANUP_SOURCE);
      });
    }
  };
}

const apiProxy = {
  '/api': {
    target: apiProxyTarget,
    changeOrigin: true
  }
};

function manualChunks(id: string) {
  if (!id.includes('node_modules')) {
    return undefined;
  }

  // 手动分包策略不要轻易合并：
  // 1. pdf-lib / fontkit 体积大且只在导出、拆 PDF 等场景使用，必须单独留在 vendor-pdf；
  // 2. React 运行时、路由、表单、i18n、query 状态库拆开后，更容易定位包体回退；
  // 3. 新增重依赖时优先补到这里，而不是让其重新落回默认 vendor。
  if (id.includes('/node_modules/pdf-lib/') || id.includes('/node_modules/fontkit/')) {
    return 'vendor-pdf';
  }

  if (
    id.includes('/node_modules/react/') ||
    id.includes('/node_modules/react-dom/') ||
    id.includes('/node_modules/scheduler/') ||
    id.includes('/node_modules/use-sync-external-store/')
  ) {
    return 'vendor-react';
  }

  if (id.includes('/node_modules/zustand/')) return 'vendor-state';
  if (id.includes('i18next') || id.includes('react-i18next')) return 'vendor-i18n';
  if (id.includes('react-hook-form') || id.includes('@hookform/resolvers') || id.includes('zod')) {
    return 'vendor-form';
  }
  if (id.includes('react-router-dom')) return 'vendor-router';
  if (id.includes('@tanstack/react-query')) return 'vendor-query';

  return 'vendor';
}

export default defineConfig({
  server: {
    proxy: apiProxy
  },
  // 构建产物预览时同样需要把 /api 转发到后端，否则前端无法完成数据库初始化。
  preview: {
    proxy: apiProxy
  },
  plugins: [
    react(),
    devServiceWorkerCleanup(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'LedgerFlow 记账软件',
        short_name: 'LedgerFlow',
        theme_color: '#0f172a',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: appLogoUrl,
            sizes: '1254x1254',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        // 新版本构建完成后立即接管,避免旧 Service Worker 继续返回过期的 chunk。
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern:
              /^https:\/\/cloudreve-bei\.oss-cn-guangzhou\.aliyuncs\.com\/ledgerflow\/fonts\/.*\.(?:woff2?|ttf)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'ledgerflow-oss-fonts',
              expiration: {
                maxEntries: 16,
                maxAgeSeconds: 60 * 60 * 24 * 365
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            urlPattern:
              /^https:\/\/cloudreve-bei\.oss-cn-guangzhou\.aliyuncs\.com\/ledgerflow\/(?:ui|Illustrations)\/.*\.(?:gif|png|svg|webp)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'ledgerflow-oss-assets',
              expiration: {
                maxEntries: 96,
                maxAgeSeconds: 60 * 60 * 24 * 90
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          }
        ]
      }
    })
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks
      }
    }
  }
});
