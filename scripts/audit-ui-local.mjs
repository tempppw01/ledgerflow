#!/usr/bin/env node
/**
 * 一键跑界面审计:起本地 API + dev server → 等就绪 → 跑 audit-ui-browser.mjs → 收尾。
 *
 * 为什么需要:审计本身要「两个服务 + 正确的端口 + 正确的代理变量」,
 * 而它又不在 CI 里(见 docs/verified-invariants.md:需要 playwright 与 chromium,
 * 而且要有已存在的演示账号)。于是每次都得手工记三件事 —— 我漏跑过一次:
 * v0.50.20 之后改了 5 个 UI 文件,直到好几轮之后才想起来补跑。
 * 把它收成一条命令,「记得跑」就不再依赖记性。
 *
 * 用法:
 *   node scripts/audit-ui-local.mjs                 # 默认端口 8799 / 5333
 *   AUDIT_EMAIL=... AUDIT_PASSWORD=... node scripts/audit-ui-local.mjs
 *   node scripts/audit-ui-local.mjs --keep          # 跑完不杀服务(便于手动看页面)
 *
 * 端口被占用时会先报错退出,而不是连到别人的服务上跑出一份假结果。
 */

import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API_PORT = process.env.AUDIT_API_PORT || '8799';
const WEB_PORT = process.env.AUDIT_WEB_PORT || '5333';
const KEEP = process.argv.includes('--keep');

const children = [];
let cleaned = false;

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    // Windows 上 node 起 vite 会再多一层进程,按树杀才不会留下监听端口的孤儿
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
  }
}

function cleanup() {
  if (cleaned || KEEP) return;
  cleaned = true;
  for (const child of children) killTree(child);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    cleanup();
    process.exit(1);
  });
}

function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port: Number(port), host: '127.0.0.1' });
    const done = (open) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(open);
    };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.setTimeout(800, () => done(false));
  });
}

async function waitFor(check, label, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error('等待超时:' + label);
}

const webReady = async () => {
  try {
    const response = await fetch('http://localhost:' + WEB_PORT + '/');
    return response.ok;
  } catch {
    return false;
  }
};

async function main() {
  if (await isPortOpen(API_PORT)) {
    throw new Error('端口 ' + API_PORT + ' 已被占用 —— 先停掉旧的 API 服务(AUDIT_API_PORT 可换端口)');
  }
  if (await isPortOpen(WEB_PORT)) {
    throw new Error('端口 ' + WEB_PORT + ' 已被占用 —— 先停掉旧的 dev server(AUDIT_WEB_PORT 可换端口)');
  }

  console.log('[1/3] 启动本地 API(端口 ' + API_PORT + ')');
  children.push(
    spawn(process.execPath, [path.join(ROOT, 'server/localSqliteServer.js')], {
      cwd: ROOT,
      env: { ...process.env, LEDGERFLOW_API_PORT: API_PORT },
      stdio: 'ignore'
    })
  );
  await waitFor(() => isPortOpen(API_PORT), '本地 API 就绪');

  console.log('[2/3] 启动 dev server(端口 ' + WEB_PORT + ')');
  children.push(
    spawn(
      process.execPath,
      [
        path.join(ROOT, 'node_modules/vite/bin/vite.js'),
        '--port',
        WEB_PORT,
        '--strictPort'
      ],
      {
        cwd: ROOT,
        env: {
          ...process.env,
          LEDGERFLOW_API_PROXY_TARGET: 'http://127.0.0.1:' + API_PORT
        },
        stdio: 'ignore'
      }
    )
  );
  await waitFor(webReady, 'dev server 就绪');

  console.log('[3/3] 跑界面审计');
  const audit = spawnSync(
    process.execPath,
    [path.join(ROOT, 'scripts/audit-ui-browser.mjs'), '--base=http://localhost:' + WEB_PORT],
    { cwd: ROOT, env: process.env, stdio: 'inherit' }
  );
  return audit.status ?? 1;
}

main()
  .then((code) => {
    cleanup();
    if (KEEP) console.log('\n(--keep)服务仍在运行,记得手动停掉。');
    process.exit(code);
  })
  .catch((error) => {
    cleanup();
    console.error('\n' + error.message);
    process.exit(1);
  });