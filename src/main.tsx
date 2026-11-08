import React from 'react';
import ReactDOM from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './app/App';
import './app/styles/index.css';
import './i18n';

/**
 * 开发环境里如果之前用同一个端口跑过生产预览,浏览器可能残留旧的 Service Worker。
 * 它会继续接管请求并返回旧版 index.html / JS chunk,表现就是页面“加载不全”或中英文混杂。
 * 这里在每次会话首次加载时清一次,避免旧缓存污染开发环境。
 */
const DEV_SW_CLEANUP_FLAG = 'ledgerflow.dev-sw-cleanup';

async function clearStaleServiceWorkers() {
  if (!import.meta.env.DEV || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }

  try {
    if (window.sessionStorage.getItem(DEV_SW_CLEANUP_FLAG) === '1') {
      return;
    }
    window.sessionStorage.setItem(DEV_SW_CLEANUP_FLAG, '1');

    const registrations = await navigator.serviceWorker.getRegistrations();
    const cacheKeys = typeof caches === 'undefined' ? [] : await caches.keys();

    if (registrations.length === 0 && cacheKeys.length === 0) {
      return;
    }

    await Promise.all(registrations.map((registration) => registration.unregister()));
    await Promise.all(cacheKeys.map((key) => caches.delete(key)));

    // 旧缓存清掉后重新加载一次,确保拿到的是当前开发服务器的资源。
    window.location.reload();
  } catch (error) {
    console.warn('[pwa] Failed to clear stale service workers in development.', error);
  }
}

let refreshRequested = false;

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    // 新版本已就绪,直接激活并刷新一次,避免用户停留在旧 chunk 上。
    if (refreshRequested) return;
    refreshRequested = true;
    void updateSW(true);
  },
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return;
    // 长时间挂着的标签页定期检查一次更新,减少“界面停在旧版本”的情况。
    window.setInterval(
      () => {
        void registration.update();
      },
      60 * 60 * 1000
    );
  }
});

async function bootstrap() {
  await clearStaleServiceWorkers();

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

void bootstrap();
