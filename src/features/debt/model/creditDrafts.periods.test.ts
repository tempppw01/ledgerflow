import { describe, expect, it } from 'vitest';
import { parseCreditDraftFragment } from './creditDrafts';

/**
 * 期数的口语表达:总期数 / 已还期数 / 剩余期数是**三件事**。
 *
 * 之前只解析了「总期数(一半情形)」,把裸「N期」一律当剩余期数,于是
 * 「分12期,已还3期」被读成「还剩 12 期」—— 还款计划与剩余利息整体高估,少算了已还的 3 期。
 */
describe('期数的口语表达', () => {
  it('分 N 期 + 已还 M 期 → 总 N、已还 M、剩余 N−M', () => {
    const patch = parseCreditDraftFragment('花呗分12期,已还3期,总欠款5000');
    expect(patch?.totalPeriods).toBe(12);
    expect(patch?.paidPeriods).toBe(3);
    expect(patch?.remainingMonths).toBe(9);
  });

  it('只说总期数时,剩余 = 总期数(一期都没还)', () => {
    const patch = parseCreditDraftFragment('京东白条 总欠款 12000 分 24 期');
    expect(patch?.totalPeriods).toBe(24);
    expect(patch?.remainingMonths).toBe(24);
    expect(patch?.paidPeriods).toBeUndefined();
  });

  it('明确说「还剩 N 期」时以它为准', () => {
    const patch = parseCreditDraftFragment('信用卡总欠款8000,还剩6期没还');
    expect(patch?.remainingMonths).toBe(6);
    // 「还剩6期」不应被当成总期数
    expect(patch?.totalPeriods).toBeUndefined();
  });

  it('「还有」「剩余」等说法同样识别', () => {
    expect(parseCreditDraftFragment('花呗欠款3000,还有4期')?.remainingMonths).toBe(4);
    expect(parseCreditDraftFragment('白条欠款3000,剩余5期')?.remainingMonths).toBe(5);
  });

  it('已还期数不会反过来被当成总期数', () => {
    const patch = parseCreditDraftFragment('借呗欠款9000,已还3期');
    expect(patch?.paidPeriods).toBe(3);
    expect(patch?.totalPeriods).toBeUndefined();
    expect(patch?.remainingMonths).toBeUndefined();
  });

  it('已还完(总期数 = 已还)时不给剩余期数,避免出现 0 期', () => {
    const patch = parseCreditDraftFragment('花呗分6期,已还6期,欠款1000');
    expect(patch?.totalPeriods).toBe(6);
    expect(patch?.paidPeriods).toBe(6);
    expect(patch?.remainingMonths).toBeUndefined();
  });

  it('还款日与期数同时出现时互不干扰', () => {
    const patch = parseCreditDraftFragment('信用卡欠款8000,每月25号还款,分12期,已还2期');
    expect(patch?.repaymentDay).toBe(25);
    expect(patch?.totalPeriods).toBe(12);
    expect(patch?.paidPeriods).toBe(2);
    expect(patch?.remainingMonths).toBe(10);
  });
});