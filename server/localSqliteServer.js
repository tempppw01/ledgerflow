import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLedgerFlowServer, resolveApiPort } from './mysqlSnapshotServer.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.env.DATABASE_PROVIDER ||= 'sqlite';
process.env.LEDGERFLOW_DATA_DIR ||= path.join(root, 'data');
process.env.SQLITE_PATH ||= path.join(process.env.LEDGERFLOW_DATA_DIR, 'ledgerflow.sqlite');
process.env.LEDGERFLOW_API_HOST ||= '127.0.0.1';
process.env.LEDGERFLOW_API_PORT ||= '3000';
process.env.LEDGERFLOW_API_TOKEN ||= 'local-dev-token';

const host = process.env.LEDGERFLOW_API_HOST;
const port = resolveApiPort(process.env);
createLedgerFlowServer().listen(port, host, () => {
  console.log(`LedgerFlow local SQLite API listening on http://${host}:${port}`);
  console.log(`SQLite database: ${process.env.SQLITE_PATH}`);
});
