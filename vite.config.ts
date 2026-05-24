import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const appLogoUrl = 'https://cloudreve-bei.oss-cn-guangzhou.aliyuncs.com/ledgerflow/ui/logo.webp';

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
  plugins: [
    react(),
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
            sizes: '720x720',
            type: 'image/webp',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        globIgnores: ['**/assets/NotoSansSC-Regular-*.ttf']
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
