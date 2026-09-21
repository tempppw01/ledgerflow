import { createServer } from 'vite';

const host = process.env.LEDGERFLOW_DEV_HOST || '127.0.0.1';
const port = Number(process.env.LEDGERFLOW_DEV_PORT || 5175);

const server = await createServer({
  server: {
    host,
    port,
    strictPort: true,
    proxy: {
      '/api': {
        target: process.env.LEDGERFLOW_API_PROXY_TARGET || 'http://127.0.0.1:3000',
        changeOrigin: true
      }
    }
  }
});

await server.listen();
server.printUrls();
