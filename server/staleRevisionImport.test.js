import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

/**
 * 乐观并发:客户端把「它加载时看到的版本」随上传一起带来,服务端发现版本已变就拒绝。
 *
 * 这是在挡一个已严格复现过的丢数据路径:两个窗口都加载完后,A 记一笔、B 记一笔 ——
 * 整份替换把 A 那笔删掉,且没有任何报错。带上基准版本后,B 的上传会被拒绝,
 * 用户可以刷新后再继续(A 的那笔还在)。
 *
 * 不带头部的调用方(旧客户端、脚本)保持原行为 —— 这是可选的防护,不是强制协议。
 *
 * 注意:数据库路径在**模块加载时**就定下来了,所以必须先设 process.env、再 import ——
 * 否则服务会连到默认数据目录(演示库),那是一次真实的写入风险。
 */
const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'ledgerflow-stale-revision-'));
process.env.DATABASE_PROVIDER = 'sqlite';
process.env.LEDGERFLOW_DATA_DIR = dataDirectory;
process.env.SQLITE_PATH = path.join(dataDirectory, 'ledgerflow.sqlite');
// 每个用例各注册一个用户,所以放开注册(临时库,仅测试用)
process.env.LEDGERFLOW_REGISTRATION_MODE = 'open';

const { createLedgerFlowServer } = await import('./mysqlSnapshotServer.js');

test.after(async () => {
  await rm(dataDirectory, { recursive: true, force: true });
});

async function withServer(run) {
  const server = createLedgerFlowServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const base = 'http://127.0.0.1:' + port;
  try {
    await run(base);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
}

function payload(accountId, amount) {
  return {
    finance: {
      accounts: [{ id: accountId, name: '现金', type: 'cash', initialBalance: 0, balance: 0 }],
      categories: [{ id: 'cat-1', name: '餐饮', kind: 'expense' }],
      transactions: [
        {
          id: 'tx-' + amount,
          type: 'expense',
          categoryId: 'cat-1',
          accountId,
          amount,
          date: '2026-11-24',
          note: '并发验证',
          tags: [],
          source: 'manual',
          status: 'completed'
        }
      ],
      subscriptions: [],
      trashedAccounts: [],
      trashedCategories: [],
      trashedTransactions: [],
      trashedSubscriptions: [],
      balanceChangeEntries: []
    },
    preferences: {
      debts: [],
      repaymentRecords: [],
      investmentPositions: [],
      investmentPositionHistory: [],
      investmentGoals: [],
      investmentWatchlist: [],
      investmentAiMessages: [],
      creditDrafts: [],
      forecastBills: [],
      smartBudgetPlan: null,
      smartBudgetHistory: [],
      rssSubscriptions: [],
      monthlyIncome: 0
    },
    globalMemories: []
  };
}

/** 新库只需要初始化一次;重复调用会返回 409「数据库初始化失败」。 */
let databaseInitialized = false;

async function register(base, email) {
  /*
   * 新库要先初始化(否则 auth 接口一律 409「请先完成数据库初始化」),
   * 这和 authHttp.test.js 的做法一致。
   */
  if (!databaseInitialized) {
    const setup = await fetch(base + '/api/setup/initialize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'sqlite' })
    });
    assert.equal(setup.status, 200, '数据库初始化失败');
    databaseInitialized = true;
  }

  const response = await fetch(base + '/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'stale-revision-2026', displayName: email })
  });
  assert.equal(response.status, 200, '注册失败:' + (await response.clone().text()).slice(0, 120));
  return response.headers.get('set-cookie').split(';', 1)[0];
}

async function readRevision(base, cookie) {
  const response = await fetch(base + '/api/data/status', { headers: { Cookie: cookie } });
  assert.equal(response.status, 200);
  const status = await response.json();
  return String(status.updatedAt || '');
}

async function push(base, cookie, body, baseRevision) {
  const headers = { 'Content-Type': 'application/json', Cookie: cookie };
  if (baseRevision) headers['X-Ledger-Base-Revision'] = baseRevision;
  const response = await fetch(base + '/api/data/import', {
    method: 'PUT',
    headers,
    body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

test('带上过期的基准版本时,上传会被拒绝', async () => {
  await withServer(async (base) => {
    const cookie = await register(base, 'stale-revision-1@example.com');

    // 第一次上传:还没有版本,允许(不带头部)
    const first = await push(base, cookie, payload('acc-1', 100));
    assert.equal(first.status, 200, '第一次上传应当成功');
    const revisionAfterFirst = await readRevision(base, cookie);
    assert.ok(revisionAfterFirst, '第一次上传后应当有版本');

    // 另一个窗口又写了一次(模拟:不带版本头部,直接推)
    const second = await push(base, cookie, payload('acc-1', 200));
    assert.equal(second.status, 200, '第二次上传应当成功');

    // 现在拿「第一次之后那个旧版本」去推 —— 必须被拒绝,否则会覆盖掉第二次写的内容
    const stale = await push(base, cookie, payload('acc-1', 300), revisionAfterFirst);
    assert.equal(stale.status, 409, '过期版本的上传必须被拒绝');
    assert.match(String(stale.body.message || ''), /另一个窗口|改动/, '提示要说清是被别处改动挡下的');

    // 库里应当还是第二次写的那一笔,没有被第三次覆盖
    const bootstrap = await fetch(base + '/api/data/bootstrap', { headers: { Cookie: cookie } });
    const data = await bootstrap.json();
    const amounts = data.data.finance.transactions.map((item) => item.amount);
    assert.deepEqual(amounts, [200], '被拒绝的上传不能留下任何改动');
  });
});

test('带当前版本时上传成功,且不带版本的老调用方式仍然可用', async () => {
  await withServer(async (base) => {
    const cookie = await register(base, 'stale-revision-2@example.com');

    const first = await push(base, cookie, payload('acc-1', 100));
    assert.equal(first.status, 200);
    const revision = await readRevision(base, cookie);

    const fresh = await push(base, cookie, payload('acc-1', 150), revision);
    assert.equal(fresh.status, 200, '带当前版本应当成功');

    const legacy = await push(base, cookie, payload('acc-1', 175));
    assert.equal(legacy.status, 200, '不带版本头部的调用方保持原行为');
  });
});