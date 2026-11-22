import { describe, expect, it } from 'vitest';
import { isBalanceAffectingStatus } from '../../../shared/lib/localDate';
import { DEFAULT_TRANSACTION_STATUS, matchesStatusQuickFilter } from './statusQuickFilter';

/**
 * 状态筛选与「余额口径」必须说同一件事:
 *
 * 没有 status 的行(导入的 CSV、老备份)在余额里是计入的,所以筛「已完成」时必须能找到它们,
 * 否则出现「余额里有这笔钱、列表里筛不到」的矛盾。
 */
describe('matchesStatusQuickFilter', () => {
  it('筛「全部」时任何状态都通过', () => {
    expect(matchesStatusQuickFilter('all', undefined)).toBe(true);
    expect(matchesStatusQuickFilter('all', 'pending')).toBe(true);
  });

  it('缺省状态按「已完成」处理,与余额口径一致', () => {
    expect(DEFAULT_TRANSACTION_STATUS).toBe('completed');
    expect(matchesStatusQuickFilter('completed', undefined)).toBe(true);
    // 计不计入余额,和能不能被「已完成」筛选找到,必须是同一个结论
    expect(isBalanceAffectingStatus(undefined)).toBe(true);
  });

  it('缺省状态不会被「待处理 / 已关闭 / 失败」选中', () => {
    expect(matchesStatusQuickFilter('pending', undefined)).toBe(false);
    expect(matchesStatusQuickFilter('closed', undefined)).toBe(false);
    expect(matchesStatusQuickFilter('failed', undefined)).toBe(false);
  });

  it('显式状态各自只匹配自己', () => {
    expect(matchesStatusQuickFilter('refunded', 'refunded')).toBe(true);
    expect(matchesStatusQuickFilter('refunded', 'completed')).toBe(false);
    expect(matchesStatusQuickFilter('pending', 'pending')).toBe(true);
  });
});