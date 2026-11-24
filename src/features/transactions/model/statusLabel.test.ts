import { describe, expect, it } from 'vitest';
import type { TfFallback } from '../../../shared/lib/useTFallback';
import { formatTransactionStatus } from './statusLabel';

/**
 * 状态列显示什么,必须和筛选器、余额判据用同一个默认值。
 *
 * 缺状态的行(助手导入的账单、老备份)在筛选器里按「已完成」匹配、在余额里也计入,
 * 但状态列曾经显示成「-」—— 同一行「筛得出来却看不出状态」。
 * 这段逻辑原先内联在表格组件里,只能靠渲染整张表才测得到,所以一直没被覆盖。
 */
const tf: TfFallback = (_key, fallback) => fallback ?? '';

describe('交易状态列', () => {
  it('缺状态显示「已完成」,不是「-」', () => {
    expect(formatTransactionStatus(undefined, tf)).toBe('已完成');
    expect(formatTransactionStatus(undefined, tf)).not.toBe('-');
  });

  it('各状态显示对应中文', () => {
    expect(formatTransactionStatus('pending', tf)).toBe('待处理');
    expect(formatTransactionStatus('completed', tf)).toBe('已完成');
    expect(formatTransactionStatus('refunded', tf)).toBe('已退款');
    expect(formatTransactionStatus('closed', tf)).toBe('已关闭');
    expect(formatTransactionStatus('failed', tf)).toBe('失败');
  });

  it('没见过的状态值原样显示,不硬套中文标签', () => {
    expect(formatTransactionStatus('archived' as never, tf)).toBe('archived');
  });
});