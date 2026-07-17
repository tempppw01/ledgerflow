import { createServer } from 'vite';

const host = process.env.LEDGERFLOW_DEV_HOST || '127.0.0.1';
const port = Number(process.env.LEDGERFLOW_DEV_PORT || 5175);

const server = await createServer({
  server: {
    host,
    port,
    strictPort: true
  }
});

await server.listen();
server.printUrls();
