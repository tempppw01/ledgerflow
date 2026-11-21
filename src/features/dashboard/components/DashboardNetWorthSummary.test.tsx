import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DashboardNetWorthSummary } from './DashboardNetWorthSummary';

function renderItems(props: {
  accountBalance: number;
  investmentValue: number;
  debtBalance: number;
}) {
  const { container } = render(<DashboardNetWorthSummary value={0} {...props} />);
  return [...container.querySelectorAll('.dashboard-net-worth-summary-items b')].map(
    (node) => node.textContent ?? ''
  );
}

describe('DashboardNetWorthSummary', () => {
  it('负债为 0 时不应渲染成「−¥0.00」', () => {
    // 回归:负债那一项曾经无条件拼「−」,新账号(负债 0)会显示负零。
    const items = renderItems({ accountBalance: 0, investmentValue: 0, debtBalance: 0 });
    expect(items[2]).toBe('¥0.00');
    expect(items.some((text) => /^[−-]/.test(text))).toBe(false);
  });

  it('真有负债时保留前置负号', () => {
    const items = renderItems({
      accountBalance: 206000,
      investmentValue: 144000,
      debtBalance: 54900
    });
    expect(items[2].startsWith('−')).toBe(true);
    expect(items[2]).toContain('5.49');
  });

  it('负的账户/投资金额不会被再次加负号', () => {
    const items = renderItems({ accountBalance: -1200, investmentValue: 300, debtBalance: 50 });
    // 负数由 formatCurrencyAuto 自己带符号(简写为千/万),这里只关心「没有被重复加负号」:
    // 一个负号、金额正确,而不是「−−」或「−-」这种叠加。
    expect(items[0]).toMatch(/^[-−]¥1\.2千$/);
    expect(items[0].replace(/^[-−]/, '')).not.toMatch(/^[-−]/);
    expect(items[1]).toBe('¥300.00');
    expect(items[2].startsWith('−')).toBe(true);
  });
});
