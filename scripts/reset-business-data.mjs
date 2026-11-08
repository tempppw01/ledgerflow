import { copyFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const databasePath = path.resolve('data/ledgerflow.sqlite');
const backupDirectory = path.resolve('data/backups');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');

const businessTables = [
  'ai_workflow_context_refs',
  'ai_workflow_messages',
  'ai_workflow_runs',
  'ai_workflows',
  'investment_analysis_runs',
  'investment_watch_tags',
  'investment_watchlists',
  'investment_position_history',
  'investment_positions',
  'investment_goals',
  'investment_instruments',
  'ledger_debt_repayments',
  'ledger_debts',
  'ledger_subscriptions',
  'ledger_balance_changes',
  'ledger_transaction_attachments',
  'ledger_transaction_tags',
  'ledger_transactions',
  'ledger_categories',
  'ledger_accounts',
  'ledger_user_settings',
  'ledger_snapshots',
  'market_news',
  'market_news_summaries',
  'market_quotes'
];

await mkdir(backupDirectory, { recursive: true });

for (const suffix of ['', '-wal', '-shm']) {
  const source = `${databasePath}${suffix}`;
  try {
    await access(source);
  } catch {
    continue;
  }
  const target = path.join(backupDirectory, `ledgerflow-${stamp}.sqlite${suffix}`);
  await copyFile(source, target);
  console.log(`backed up ${path.basename(source)} -> ${path.relative(process.cwd(), target)}`);
}

const db = new DatabaseSync(databasePath);
db.exec('PRAGMA foreign_keys = OFF');
db.exec('BEGIN IMMEDIATE');
try {
  for (const table of businessTables) {
    db.exec(`DELETE FROM ${table}`);
  }
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
} finally {
  db.exec('PRAGMA foreign_keys = ON');
}

for (const table of businessTables) {
  const { count } = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get();
  if (count !== 0) console.warn(`${table} still has ${count} rows`);
}

console.log('business data cleared; auth users and sessions preserved');
db.close();
