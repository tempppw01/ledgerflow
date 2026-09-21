import React from 'react';
import ReactDOM from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './app/App';
import './app/styles/index.css';
import './i18n';

registerSW({
  immediate: true,
  onNeedRefresh() {
    console.info('检测到新版本，刷新后生效。');
  }
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
