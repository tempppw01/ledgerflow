import { DatabaseSync } from 'node:sqlite';
import { getSqliteDatabasePath } from './databaseProvider.js';
import { withMysqlConnection } from './databaseConnection.js';

const SETTING_KEYS = {
  globalMemories: 'global-memories',
  rssSubscriptions: 'rss-subscriptions',
  investmentAiMessages: 'investment-ai-messages',
  investmentWatchlistExtras: 'investment-watchlist-extras',
  monthlyIncome: 'monthly-income',
  categoryLearningRules: 'category-learning-rules',
  categoryLearningEvents: 'category-learning-events'
};

function now() {
  return new Date().toISOString();
}

function list(value) {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') : [];
}

function strings(value) {
  return Array.isArray(value) ? value.map((item) => text(item).trim()).filter(Boolean) : [];
}

function text(value, fallback = '') {
  return typeof value === 'string' ? value.slice(0, 10000) : fallback;
}

function id(value) {
  return text(value).slice(0, 64);
}

function authenticatedUserId(value) {
  const userId = id(value).trim();
  if (!userId) throw new Error('Authenticated ledger user ID is required.');
  return userId;
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullable(value) {
  const result = text(value).trim();
  return result || null;
}

function bool(value) {
  return value ? 1 : 0;
}

function date(value) {
  const parsed = new Date(value || now());
  return Number.isNaN(parsed.getTime()) ? now() : parsed.toISOString();
}

function toMysqlDate(value) {
  return date(value).replace('T', ' ').replace('Z', '');
}

function fromDbDate(value) {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString();
  const valueText = String(value);
  const parsed = new Date(valueText.includes('T') ? valueText : `${valueText.replace(' ', 'T')}Z`);
  return Number.isNaN(parsed.getTime()) ? valueText : parsed.toISOString();
}

function parseJson(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function openSqlite(env) {
  const database = new DatabaseSync(getSqliteDatabasePath(env));
  database.exec('PRAGMA foreign_keys = ON;');
  return database;
}

async function withDatabase(provider, handler, env = process.env) {
  if (provider === 'sqlite') {
    const database = openSqlite(env);
    try {
      return await handler({
        dialect: 'sqlite',
        query: async (sql, params = []) => database.prepare(sql).all(...params),
        run: async (sql, params = []) => database.prepare(sql).run(...params),
        begin: async () => database.exec('BEGIN IMMEDIATE'),
        commit: async () => database.exec('COMMIT'),
        rollback: async () => database.exec('ROLLBACK'),
        date: (value) => date(value)
      });
    } finally {
      database.close();
    }
  }

  return withMysqlConnection(async (connection) =>
    handler({
      dialect: 'mysql',
      query: async (sql, params = []) => {
        const [rows] = await connection.execute(sql, params);
        return rows;
      },
      run: async (sql, params = []) => {
        const [result] = await connection.execute(sql, params);
        return result;
      },
      begin: async () => connection.beginTransaction(),
      commit: async () => connection.commit(),
      rollback: async () => connection.rollback(),
      date: (value) => toMysqlDate(value)
    }),
  env);
}

async function setSetting(database, userId, key, value) {
  const timestamp = database.date(now());
  const payload = JSON.stringify(value);
  if (database.dialect === 'sqlite') {
    await database.run(
      `INSERT INTO ledger_user_settings (user_id, setting_key, setting_value, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = excluded.updated_at`,
      [userId, key, payload, timestamp]
    );
    return;
  }
  await database.run(
    `INSERT INTO ledger_user_settings (user_id, setting_key, setting_value, updated_at)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_at = VALUES(updated_at)`,
    [userId, key, payload, timestamp]
  );
}

async function getSettings(database, userId) {
  const rows = await database.query(
    'SELECT setting_key, setting_value FROM ledger_user_settings WHERE user_id = ?',
    [userId]
  );
  return Object.fromEntries(rows.map((row) => [row.setting_key, parseJson(row.setting_value, null)]));
}

function splitTrashed(rows) {
  const active = [];
  const trashed = [];
  rows.forEach((row) => (row.trashedAt ? trashed : active).push(row));
  return [active, trashed];
}

function watchlistExtra(item) {
  const {
    id: _id,
    name: _name,
    code: _code,
    platform: _platform,
    tags: _tags,
    note: _note,
    holdingShares: _holdingShares,
    investmentAdvice: _investmentAdvice,
    lastVerdict: _lastVerdict,
    lastSummary: _lastSummary,
    lastRiskLevel: _lastRiskLevel,
    lastAnalysisAt: _lastAnalysisAt,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...extra
  } = item;
  return extra;
}

async function clearUserData(database, userId) {
  // Child rows must be cleared before their referenced business records.
  const statements = [
    'DELETE FROM ai_workflow_context_refs WHERE run_id IN (SELECT id FROM ai_workflow_runs WHERE user_id = ?)',
    'DELETE FROM ai_workflow_messages WHERE run_id IN (SELECT id FROM ai_workflow_runs WHERE user_id = ?)',
    'DELETE FROM ai_workflow_runs WHERE user_id = ?',
    'DELETE FROM ai_workflows WHERE user_id = ?',
    'DELETE FROM investment_analysis_runs WHERE user_id = ?',
    'DELETE FROM investment_watch_tags WHERE watchlist_id IN (SELECT id FROM investment_watchlists WHERE user_id = ?)',
    'DELETE FROM investment_watchlists WHERE user_id = ?',
    'DELETE FROM investment_position_history WHERE position_id IN (SELECT id FROM investment_positions WHERE user_id = ?)',
    'DELETE FROM investment_positions WHERE user_id = ?',
    'DELETE FROM investment_goals WHERE user_id = ?',
    'DELETE FROM ledger_debt_repayments WHERE debt_id IN (SELECT id FROM ledger_debts WHERE user_id = ?)',
    'DELETE FROM ledger_debts WHERE user_id = ?',
    'DELETE FROM ledger_subscriptions WHERE user_id = ?',
    'DELETE FROM ledger_balance_changes WHERE user_id = ?',
    'DELETE FROM ledger_transaction_attachments WHERE transaction_id IN (SELECT id FROM ledger_transactions WHERE user_id = ?)',
    'DELETE FROM ledger_transaction_tags WHERE transaction_id IN (SELECT id FROM ledger_transactions WHERE user_id = ?)',
    'DELETE FROM ledger_transactions WHERE user_id = ?',
    'DELETE FROM ledger_categories WHERE user_id = ?',
    'DELETE FROM ledger_accounts WHERE user_id = ?',
    'DELETE FROM ledger_user_settings WHERE user_id = ?'
  ];
  for (const sql of statements) {
    await database.run(sql, [userId]);
  }
}

export async function replaceRelationalData(
  provider,
  payload,
  env = process.env,
  authenticatedLedgerUserId
) {
  const userId = authenticatedUserId(authenticatedLedgerUserId);
  const finance = payload?.finance && typeof payload.finance === 'object' ? payload.finance : payload || {};
  const preferences = payload?.preferences && typeof payload.preferences === 'object' ? payload.preferences : {};
  const globalMemories = list(payload?.globalMemories);
  const accounts = [...list(finance.accounts), ...list(finance.trashedAccounts)];
  const categories = [...list(finance.categories), ...list(finance.trashedCategories)];
  const transactions = [...list(finance.transactions), ...list(finance.trashedTransactions)];
  const subscriptions = [...list(finance.subscriptions), ...list(finance.trashedSubscriptions)];
  const balanceChanges = list(finance.balanceChangeEntries);
  const positions = list(preferences.investmentPositions);
  const histories = list(preferences.investmentPositionHistory);
  const goals = list(preferences.investmentGoals);
  const watchlist = list(preferences.investmentWatchlist);
  const debts = list(preferences.debts);
  const repayments = list(preferences.repaymentRecords);

  const validAccountIds = new Set(accounts.map((item) => id(item.id)).filter(Boolean));
  const validCategoryIds = new Set(categories.map((item) => id(item.id)).filter(Boolean));
  const validTransactionIds = new Set(transactions.map((item) => id(item.id)).filter(Boolean));
  const timestamp = now();

  await withDatabase(provider, async (database) => {
    await database.begin();
    try {
      await clearUserData(database, userId);
      await database.run(
        `INSERT INTO ledger_users (id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)
         ${provider === 'sqlite' ? 'ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at' : 'ON DUPLICATE KEY UPDATE updated_at = VALUES(updated_at)'}`,
        [userId, 'Default user', database.date(timestamp), database.date(timestamp)]
      );

      for (const item of accounts) {
        if (!id(item.id)) continue;
        await database.run(
          `INSERT INTO ledger_accounts (id, user_id, name, account_type, initial_balance, balance, sort_order, trashed_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id(item.id), userId, text(item.name, 'Untitled account'), nullable(item.type), number(item.initialBalance), number(item.balance), Math.floor(number(item.sortOrder)), nullable(item.trashedAt), database.date(timestamp), database.date(timestamp)]
        );
      }
      for (const item of categories) {
        if (!id(item.id)) continue;
        await database.run(
          `INSERT INTO ledger_categories (id, user_id, name, category_kind, color, icon, sort_order, trashed_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id(item.id), userId, text(item.name, 'Untitled category'), item.kind === 'income' ? 'income' : 'expense', nullable(item.color), nullable(item.icon), Math.floor(number(item.sortOrder)), nullable(item.trashedAt), database.date(timestamp), database.date(timestamp)]
        );
      }
      for (const item of transactions) {
        if (!id(item.id) || !validAccountIds.has(id(item.accountId)) || !validCategoryIds.has(id(item.categoryId))) continue;
        await database.run(
          `INSERT INTO ledger_transactions (id, user_id, account_id, category_id, transaction_type, amount, occurred_at, note, source, order_no, merchant_order_no, transaction_status, adjustment_kind, refund_of_transaction_id, trashed_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id(item.id), userId, id(item.accountId), id(item.categoryId), text(item.type, 'expense'), number(item.amount), database.date(item.date), text(item.note), nullable(item.source), nullable(item.orderNo), nullable(item.merchantOrderNo), nullable(item.status), text(item.adjustmentKind, 'normal'), null, nullable(item.trashedAt), database.date(item.date), database.date(item.updatedAt || item.date)]
        );
        for (const tag of strings(item.tags)) {
          const value = tag.slice(0, 64);
          if (value) await database.run('INSERT INTO ledger_transaction_tags (transaction_id, tag) VALUES (?, ?)', [id(item.id), value]);
        }
        for (const attachment of list(item.attachments)) {
          if (!id(attachment.id) || !text(attachment.remotePath)) continue;
          await database.run(
            `INSERT INTO ledger_transaction_attachments (id, transaction_id, name, remote_path, mime_type, byte_size, uploaded_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [id(attachment.id), id(item.id), text(attachment.name, 'Attachment'), text(attachment.remotePath), nullable(attachment.mimeType), Math.floor(number(attachment.size)), database.date(attachment.uploadedAt)]
          );
        }
      }
      // A refund can appear before its original transaction in a legacy export.
      // Linking it in a second pass keeps the import valid for both SQL engines.
      for (const item of transactions) {
        if (!id(item.id) || !validTransactionIds.has(id(item.refundOfTransactionId))) continue;
        await database.run(
          'UPDATE ledger_transactions SET refund_of_transaction_id = ? WHERE id = ? AND user_id = ?',
          [id(item.refundOfTransactionId), id(item.id), userId]
        );
      }
      for (const item of balanceChanges) {
        if (!id(item.id) || !validAccountIds.has(id(item.accountId))) continue;
        await database.run(
          `INSERT INTO ledger_balance_changes (id, user_id, account_id, transaction_id, related_transaction_id, change_type, amount, before_balance, after_balance, note, remark, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id(item.id), userId, id(item.accountId), validTransactionIds.has(id(item.transactionId)) ? id(item.transactionId) : null, validTransactionIds.has(id(item.relatedTransactionId)) ? id(item.relatedTransactionId) : null, text(item.type, 'manual-adjustment'), number(item.amount), number(item.beforeBalance), number(item.afterBalance), nullable(item.note), nullable(item.remark), database.date(item.createdAt)]
        );
      }
      for (const item of subscriptions) {
        if (!id(item.id)) continue;
        await database.run(
          `INSERT INTO ledger_subscriptions (id, user_id, account_id, name, subscription_kind, amount, currency, billing_cycle, custom_cycle_days, provider, note, renewal_date, expire_date, auto_renew, subscription_status, last_generated_at, last_generated_transaction_id, trashed_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id(item.id), userId, validAccountIds.has(id(item.accountId)) ? id(item.accountId) : null, text(item.name, 'Untitled subscription'), text(item.kind, 'other'), number(item.amount), text(item.currency, 'CNY').slice(0, 16), text(item.billingCycle, 'monthly'), Math.floor(number(item.customCycleDays)) || null, nullable(item.provider), nullable(item.note), nullable(item.renewalDate), nullable(item.expireDate), bool(item.autoRenew), text(item.status, 'active'), nullable(item.lastGeneratedAt), validTransactionIds.has(id(item.lastGeneratedTransactionId)) ? id(item.lastGeneratedTransactionId) : null, nullable(item.trashedAt), database.date(item.createdAt), database.date(item.updatedAt)]
        );
      }
      for (const item of debts) {
        if (!id(item.id)) continue;
        await database.run(
          `INSERT INTO ledger_debts (id, user_id, name, debt_type, debt_status, balance, annual_rate, remaining_months, total_periods, paid_periods, loan_principal, total_repayment, custom_min_payment, bill_day, repayment_day, repayment_method, repayment_record_mode, payment_account_id, grace_days, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id(item.id), userId, text(item.name, 'Untitled debt'), text(item.type, 'credit-card'), text(item.status, 'active'), number(item.balance), number(item.annualRate) || null, Math.floor(number(item.remainingMonths)) || null, Math.floor(number(item.totalPeriods)) || null, Math.floor(number(item.paidPeriods)) || null, number(item.loanPrincipal) || null, number(item.totalRepayment) || null, number(item.customMinPayment) || null, Math.floor(number(item.billDay)) || null, Math.floor(number(item.repaymentDay)) || null, nullable(item.repaymentMethod), nullable(item.repaymentRecordMode), validAccountIds.has(id(item.paymentAccount)) ? id(item.paymentAccount) : null, Math.floor(number(item.graceDays)) || null, database.date(item.createdAt), database.date(item.updatedAt)]
        );
      }
      const debtIds = new Set(debts.map((item) => id(item.id)));
      for (const item of repayments) {
        if (!id(item.id) || !debtIds.has(id(item.debtId))) continue;
        await database.run(
          `INSERT INTO ledger_debt_repayments (id, debt_id, transaction_id, amount, paid_at, payment_account_id, note, record_mode, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id(item.id), id(item.debtId), validTransactionIds.has(id(item.transactionId)) ? id(item.transactionId) : null, number(item.amount), database.date(item.paidAt), validAccountIds.has(id(item.paymentAccount)) ? id(item.paymentAccount) : null, nullable(item.note), text(item.recordMode, 'manual'), database.date(item.createdAt)]
        );
      }
      for (const item of positions) {
        if (!id(item.id)) continue;
        await database.run(
          `INSERT INTO investment_positions (id, user_id, instrument_id, linked_account_id, name, category, platform, invested_amount, current_value, holding_shares, monthly_contribution, target_allocation, risk_level, note, is_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id(item.id), userId, null, validAccountIds.has(id(item.linkedAccountId)) ? id(item.linkedAccountId) : null, text(item.name, 'Untitled investment'), text(item.category, 'other'), nullable(item.platform), number(item.investedAmount), number(item.currentValue), number(item.holdingShares) || null, number(item.monthlyContribution) || null, number(item.targetAllocation) || null, text(item.riskLevel, 'medium'), nullable(item.note), bool(item.isActive !== false), database.date(item.createdAt), database.date(item.updatedAt)]
        );
      }
      const positionIds = new Set(positions.map((item) => id(item.id)));
      for (const item of histories) {
        if (!id(item.id) || !positionIds.has(id(item.positionId))) continue;
        await database.run(
          `INSERT INTO investment_position_history (id, position_id, action, invested_amount, current_value, profit, profit_rate, invested_amount_delta, current_value_delta, note, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id(item.id), id(item.positionId), text(item.action, 'snapshot'), number(item.investedAmount), number(item.currentValue), number(item.profit), number(item.profitRate), number(item.investedAmountDelta) || null, number(item.currentValueDelta) || null, nullable(item.note), database.date(item.createdAt)]
        );
      }
      for (const item of goals) {
        if (!id(item.id)) continue;
        await database.run(
          `INSERT INTO investment_goals (id, user_id, name, goal_kind, target_amount, current_amount, monthly_contribution, target_date, priority, note, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id(item.id), userId, text(item.name, 'Untitled goal'), text(item.kind, 'other'), number(item.targetAmount), number(item.currentAmount), number(item.monthlyContribution) || null, nullable(item.targetDate), text(item.priority, 'medium'), nullable(item.note), database.date(item.createdAt), database.date(item.updatedAt)]
        );
      }
      for (const item of watchlist) {
        if (!id(item.id)) continue;
        await database.run(
          `INSERT INTO investment_watchlists (id, user_id, instrument_id, name, code, platform, note, holding_shares, investment_advice, last_verdict, last_summary, last_risk_level, last_analysis_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id(item.id), userId, null, text(item.name, 'Untitled watch item'), nullable(item.code), nullable(item.platform), nullable(item.note), number(item.holdingShares) || null, nullable(item.investmentAdvice), nullable(item.lastVerdict), nullable(item.lastSummary), nullable(item.lastRiskLevel), nullable(item.lastAnalysisAt), database.date(item.createdAt), database.date(item.updatedAt)]
        );
        for (const tag of strings(item.tags)) {
          const value = tag.slice(0, 64);
          if (value) await database.run('INSERT INTO investment_watch_tags (watchlist_id, tag) VALUES (?, ?)', [id(item.id), value]);
        }
      }

      await setSetting(database, userId, SETTING_KEYS.globalMemories, globalMemories);
      await setSetting(database, userId, SETTING_KEYS.rssSubscriptions, list(preferences.rssSubscriptions));
      await setSetting(database, userId, SETTING_KEYS.investmentAiMessages, list(preferences.investmentAiMessages));
      await setSetting(database, userId, SETTING_KEYS.investmentWatchlistExtras, Object.fromEntries(watchlist.map((item) => [id(item.id), watchlistExtra(item)])));
      await setSetting(database, userId, SETTING_KEYS.monthlyIncome, number(preferences.monthlyIncome));
      await setSetting(database, userId, SETTING_KEYS.categoryLearningRules, list(finance.categoryLearningRules));
      await setSetting(database, userId, SETTING_KEYS.categoryLearningEvents, list(finance.categoryLearningEvents));
      await database.commit();
    } catch (error) {
      await database.rollback();
      throw error;
    }
  }, env);

  return getRelationalDataStatus(provider, env, userId);
}

export async function getRelationalDataStatus(provider, env = process.env, authenticatedLedgerUserId) {
  const userId = authenticatedUserId(authenticatedLedgerUserId);
  return withDatabase(provider, async (database) => {
    const tables = ['ledger_accounts', 'ledger_categories', 'ledger_transactions', 'ledger_subscriptions', 'ledger_debts', 'investment_positions', 'investment_watchlists'];
    const counts = {};
    for (const table of tables) {
      const rows = await database.query(`SELECT COUNT(*) AS count FROM ${table} WHERE user_id = ?`, [userId]);
      counts[table.replace(/^ledger_/, '')] = Number(rows[0]?.count || 0);
    }
    const rows = await database.query('SELECT MAX(updated_at) AS updated_at FROM ledger_user_settings WHERE user_id = ?', [userId]);
    return { ok: true, hasData: Object.values(counts).some((count) => count > 0), counts, updatedAt: fromDbDate(rows[0]?.updated_at) || null };
  }, env);
}

export async function getRelationalBootstrap(provider, env = process.env, authenticatedLedgerUserId) {
  const userId = authenticatedUserId(authenticatedLedgerUserId);
  return withDatabase(provider, async (database) => {
    const [accounts, categories, transactions, tags, attachments, balanceChanges, subscriptions, debts, repayments, positions, histories, goals, watchlists, watchTags, settings] = await Promise.all([
      database.query('SELECT * FROM ledger_accounts WHERE user_id = ? ORDER BY sort_order, created_at', [userId]),
      database.query('SELECT * FROM ledger_categories WHERE user_id = ? ORDER BY sort_order, created_at', [userId]),
      database.query('SELECT * FROM ledger_transactions WHERE user_id = ? ORDER BY occurred_at, created_at', [userId]),
      database.query('SELECT t.* FROM ledger_transaction_tags t JOIN ledger_transactions x ON x.id = t.transaction_id WHERE x.user_id = ?', [userId]),
      database.query('SELECT a.* FROM ledger_transaction_attachments a JOIN ledger_transactions x ON x.id = a.transaction_id WHERE x.user_id = ?', [userId]),
      database.query('SELECT * FROM ledger_balance_changes WHERE user_id = ? ORDER BY created_at', [userId]),
      database.query('SELECT * FROM ledger_subscriptions WHERE user_id = ? ORDER BY created_at', [userId]),
      database.query('SELECT * FROM ledger_debts WHERE user_id = ? ORDER BY created_at', [userId]),
      database.query('SELECT r.* FROM ledger_debt_repayments r JOIN ledger_debts d ON d.id = r.debt_id WHERE d.user_id = ?', [userId]),
      database.query('SELECT * FROM investment_positions WHERE user_id = ? ORDER BY created_at DESC', [userId]),
      database.query('SELECT h.* FROM investment_position_history h JOIN investment_positions p ON p.id = h.position_id WHERE p.user_id = ? ORDER BY h.created_at DESC', [userId]),
      database.query('SELECT * FROM investment_goals WHERE user_id = ? ORDER BY created_at DESC', [userId]),
      database.query('SELECT * FROM investment_watchlists WHERE user_id = ? ORDER BY updated_at DESC', [userId]),
      database.query('SELECT t.* FROM investment_watch_tags t JOIN investment_watchlists w ON w.id = t.watchlist_id WHERE w.user_id = ?', [userId]),
      getSettings(database, userId)
    ]);
    const tagsByTransaction = new Map();
    tags.forEach((row) => tagsByTransaction.set(row.transaction_id, [...(tagsByTransaction.get(row.transaction_id) || []), row.tag]));
    const attachmentsByTransaction = new Map();
    attachments.forEach((row) => attachmentsByTransaction.set(row.transaction_id, [...(attachmentsByTransaction.get(row.transaction_id) || []), { id: row.id, name: row.name, remotePath: row.remote_path, mimeType: row.mime_type || undefined, size: row.byte_size === null ? undefined : number(row.byte_size), uploadedAt: fromDbDate(row.uploaded_at) }]));
    const mapAccount = (row) => ({ id: row.id, name: row.name, type: row.account_type || undefined, initialBalance: number(row.initial_balance), balance: number(row.balance), sortOrder: number(row.sort_order), trashedAt: fromDbDate(row.trashed_at) });
    const mapCategory = (row) => ({ id: row.id, name: row.name, kind: row.category_kind, color: row.color || undefined, icon: row.icon || undefined, sortOrder: number(row.sort_order), trashedAt: fromDbDate(row.trashed_at) });
    const mapTransaction = (row) => ({ id: row.id, type: row.transaction_type, categoryId: row.category_id, accountId: row.account_id, amount: number(row.amount), date: fromDbDate(row.occurred_at), note: row.note || '', tags: tagsByTransaction.get(row.id) || [], source: row.source || undefined, orderNo: row.order_no || undefined, merchantOrderNo: row.merchant_order_no || undefined, status: row.transaction_status || undefined, adjustmentKind: row.adjustment_kind || undefined, refundOfTransactionId: row.refund_of_transaction_id || undefined, attachments: attachmentsByTransaction.get(row.id) || [], updatedAt: fromDbDate(row.updated_at), trashedAt: fromDbDate(row.trashed_at) });
    const mapSubscription = (row) => ({ id: row.id, name: row.name, kind: row.subscription_kind, amount: number(row.amount), currency: row.currency, billingCycle: row.billing_cycle, customCycleDays: row.custom_cycle_days === null ? undefined : number(row.custom_cycle_days), accountId: row.account_id || undefined, provider: row.provider || undefined, note: row.note || undefined, renewalDate: fromDbDate(row.renewal_date), expireDate: fromDbDate(row.expire_date), autoRenew: Boolean(row.auto_renew), status: row.subscription_status, lastGeneratedAt: fromDbDate(row.last_generated_at), lastGeneratedTransactionId: row.last_generated_transaction_id || undefined, trashedAt: fromDbDate(row.trashed_at), createdAt: fromDbDate(row.created_at), updatedAt: fromDbDate(row.updated_at) });
    const [activeAccounts, trashedAccounts] = splitTrashed(accounts.map(mapAccount));
    const [activeCategories, trashedCategories] = splitTrashed(categories.map(mapCategory));
    const [activeTransactions, trashedTransactions] = splitTrashed(transactions.map(mapTransaction));
    const [activeSubscriptions, trashedSubscriptions] = splitTrashed(subscriptions.map(mapSubscription));
    const tagByWatchlist = new Map();
    watchTags.forEach((row) => tagByWatchlist.set(row.watchlist_id, [...(tagByWatchlist.get(row.watchlist_id) || []), row.tag]));
    const extras = settings[SETTING_KEYS.investmentWatchlistExtras] || {};
    return {
      ok: true,
      ...(await getRelationalDataStatus(provider, env, userId)),
      data: {
        finance: { accounts: activeAccounts, trashedAccounts, categories: activeCategories, trashedCategories, transactions: activeTransactions, trashedTransactions, subscriptions: activeSubscriptions, trashedSubscriptions, balanceChangeEntries: balanceChanges.map((row) => ({ id: row.id, accountId: row.account_id, transactionId: row.transaction_id || undefined, relatedTransactionId: row.related_transaction_id || undefined, type: row.change_type, amount: number(row.amount), beforeBalance: number(row.before_balance), afterBalance: number(row.after_balance), note: row.note || undefined, remark: row.remark || undefined, createdAt: fromDbDate(row.created_at) })), categoryLearningRules: list(settings[SETTING_KEYS.categoryLearningRules]), categoryLearningEvents: list(settings[SETTING_KEYS.categoryLearningEvents]) },
        globalMemories: list(settings[SETTING_KEYS.globalMemories]),
        preferences: {
          rssSubscriptions: list(settings[SETTING_KEYS.rssSubscriptions]),
          monthlyIncome: number(settings[SETTING_KEYS.monthlyIncome]),
          investmentPositions: positions.map((row) => ({ id: row.id, name: row.name, category: row.category, platform: row.platform || undefined, linkedAccountId: row.linked_account_id || undefined, investedAmount: number(row.invested_amount), currentValue: number(row.current_value), holdingShares: row.holding_shares === null ? undefined : number(row.holding_shares), monthlyContribution: row.monthly_contribution === null ? undefined : number(row.monthly_contribution), targetAllocation: row.target_allocation === null ? undefined : number(row.target_allocation), riskLevel: row.risk_level, note: row.note || undefined, isActive: Boolean(row.is_active), createdAt: fromDbDate(row.created_at), updatedAt: fromDbDate(row.updated_at) })),
          investmentPositionHistory: histories.map((row) => ({ id: row.id, positionId: row.position_id, action: row.action, investedAmount: number(row.invested_amount), currentValue: number(row.current_value), profit: number(row.profit), profitRate: number(row.profit_rate), investedAmountDelta: row.invested_amount_delta === null ? undefined : number(row.invested_amount_delta), currentValueDelta: row.current_value_delta === null ? undefined : number(row.current_value_delta), note: row.note || undefined, createdAt: fromDbDate(row.created_at) })),
          investmentGoals: goals.map((row) => ({ id: row.id, name: row.name, kind: row.goal_kind, targetAmount: number(row.target_amount), currentAmount: number(row.current_amount), monthlyContribution: row.monthly_contribution === null ? undefined : number(row.monthly_contribution), targetDate: fromDbDate(row.target_date), priority: row.priority, note: row.note || undefined, createdAt: fromDbDate(row.created_at), updatedAt: fromDbDate(row.updated_at) })),
          investmentWatchlist: watchlists.map((row) => ({ ...(extras[row.id] || {}), id: row.id, name: row.name, code: row.code || undefined, platform: row.platform || undefined, tags: tagByWatchlist.get(row.id) || [], note: row.note || undefined, holdingShares: row.holding_shares === null ? undefined : number(row.holding_shares), investmentAdvice: row.investment_advice || undefined, lastVerdict: row.last_verdict || undefined, lastSummary: row.last_summary || undefined, lastRiskLevel: row.last_risk_level || undefined, lastAnalysisAt: fromDbDate(row.last_analysis_at), createdAt: fromDbDate(row.created_at), updatedAt: fromDbDate(row.updated_at) })),
          investmentAiMessages: list(settings[SETTING_KEYS.investmentAiMessages]),
          debts: debts.map((row) => ({ id: row.id, name: row.name, type: row.debt_type, status: row.debt_status, balance: number(row.balance), annualRate: row.annual_rate === null ? undefined : number(row.annual_rate), remainingMonths: row.remaining_months === null ? undefined : number(row.remaining_months), totalPeriods: row.total_periods === null ? undefined : number(row.total_periods), paidPeriods: row.paid_periods === null ? undefined : number(row.paid_periods), loanPrincipal: row.loan_principal === null ? undefined : number(row.loan_principal), totalRepayment: row.total_repayment === null ? undefined : number(row.total_repayment), customMinPayment: row.custom_min_payment === null ? undefined : number(row.custom_min_payment), billDay: row.bill_day === null ? undefined : number(row.bill_day), repaymentDay: row.repayment_day === null ? undefined : number(row.repayment_day), repaymentMethod: row.repayment_method || undefined, repaymentRecordMode: row.repayment_record_mode || undefined, paymentAccount: row.payment_account_id || undefined, graceDays: row.grace_days === null ? undefined : number(row.grace_days), createdAt: fromDbDate(row.created_at), updatedAt: fromDbDate(row.updated_at) })),
          repaymentRecords: repayments.map((row) => ({ id: row.id, debtId: row.debt_id, transactionId: row.transaction_id || undefined, amount: number(row.amount), paidAt: fromDbDate(row.paid_at), paymentAccount: row.payment_account_id || undefined, note: row.note || undefined, recordMode: row.record_mode, createdAt: fromDbDate(row.created_at) }))
        }
      }
    };
  }, env);
}
