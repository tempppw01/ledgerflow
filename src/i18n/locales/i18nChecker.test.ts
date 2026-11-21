import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

/**
 * 把 check-i18n-keys.mjs 的三个历史盲点钉住。
 *
 * 这些盲点不会让构建失败,只会让 UNUSED 报告把「还在用的 key」说成死 key ——
 * 照着那份名单清理,就会把界面文案删掉。所以这里直接跑一遍脚本,断言
 * 「确实在用的 key 没有被报成 UNUSED」。
 */
function runChecker(): {
  usedKeys: number;
  missing: { key: string }[];
  unused: string[];
  dynamicPrefixes: string[];
} {
  const raw = execFileSync(
    process.execPath,
    ['scripts/check-i18n-keys.mjs', '--json', '--unused'],
    { cwd: process.cwd(), encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }
  );
  return JSON.parse(raw);
}

describe('i18n checker', () => {
  const report = runChecker();

  it('没有代码引用但资源缺失的 key', () => {
    expect(report.missing).toEqual([]);
  });

  it('识别 tFallback 这类本地包装,不把它们用的 key 当成死 key', () => {
    // DashboardPage / AppLayout 通过 tFallback 取文案,别名表漏登记时这组会被误报。
    expect(report.unused).not.toContain('dashboard.ui.densityTitle');
    expect(report.unused).not.toContain('dashboard.ui.densityLabel');
    expect(report.unused).not.toContain('dashboard.ui.corePanel');
  });

  it('识别先存进 state 再渲染的 key', () => {
    expect(report.unused).not.toContain('finance.ui.loadFailed');
    expect(report.unused).not.toContain('transactions.quickAdd.error.selectCategory');
  });

  it('识别被 helper 拼出来的 key 前缀', () => {
    // getCurrencyNameKey(code) 返回 `exchange.currency.${code}`
    expect(report.dynamicPrefixes).toContain('exchange.currency.');
    expect(report.unused.filter((key) => key.startsWith('exchange.currency.'))).toEqual([]);
  });
});
