import { describe, expect, it } from 'vitest';
import { createCreditDraft, parseCreditDraftFragment } from './creditDrafts';

/**
 * 金额单位不变量:中文里的「万 / 千」必须按单位放大。
 *
 * 这是本 App 最容易出大错的地方 —— 债务金额动辄上万,而「欠款 1.5 万」如果被读成 ¥1.5,
 * 差的是 10000 倍;用户在确认页看到「待还 ¥1.50」也未必联想到是单位没解析。
 */
describe('parseCreditDraftFragment 的金额单位', () => {
  it('「万」按 10000 放大', () => {
    expect(parseCreditDraftFragment('花呗欠款 1.5 万')?.balance).toBe(15000);
    expect(parseCreditDraftFragment('花呗欠款1.5万元')?.balance).toBe(15000);
    expect(parseCreditDraftFragment('信用卡总欠款 2万')?.balance).toBe(20000);
  });

  it('「千」按 1000 放大', () => {
    expect(parseCreditDraftFragment('白条欠款 3 千')?.balance).toBe(3000);
  });

  it('「1万5」这种口语写法读成 15000', () => {
    expect(parseCreditDraftFragment('借呗欠款1万5')?.balance).toBe(15000);
  });

  it('「万」后面的低位不能被丢掉', () => {
    // 1万零500 / 1万500 = 10500,不能只取 10000
    expect(parseCreditDraftFragment('花呗欠款1万零500')?.balance).toBe(10500);
    expect(parseCreditDraftFragment('花呗欠款1万500')?.balance).toBe(10500);
    expect(parseCreditDraftFragment('花呗欠款1万5千')?.balance).toBe(15000);
    expect(parseCreditDraftFragment('花呗欠款2万3')?.balance).toBe(23000);
  });

  it('纯中文数字目前不解析(安全失败:字段留空让用户补)', () => {
    // 与其猜错,不如不猜 —— 留空会在待补字段里提示
    expect(parseCreditDraftFragment('花呗欠款五千')?.balance).toBeUndefined();
    expect(parseCreditDraftFragment('信用卡欠款三千五')?.balance).toBeUndefined();
  });

  it('没有单位的普通金额保持不变', () => {
    expect(parseCreditDraftFragment('花呗欠款 5000')?.balance).toBe(5000);
    expect(parseCreditDraftFragment('花呗欠款 ¥12,345.67')?.balance).toBe(12345.67);
  });

  it('本期应还同样支持单位', () => {
    expect(parseCreditDraftFragment('房贷 总欠款 30 万 本期应还 3 千')?.dueAmount).toBe(3000);
  });
});

describe('createCreditDraft 的数值清洗', () => {
  it('字符串里的中文单位会放大', () => {
    expect(createCreditDraft({ name: '花呗', balance: '1.5万' as unknown as number }).balance).toBe(15000);
    expect(createCreditDraft({ name: '花呗', balance: '3千' as unknown as number }).balance).toBe(3000);
  });

  it('带货币符号与千分位的字符串能解析', () => {
    expect(createCreditDraft({ name: '花呗', balance: '¥12,345.67' as unknown as number }).balance).toBe(12345.67);
  });

  it('非法与零值被丢弃,不会变成 NaN 或 0', () => {
    const draft = createCreditDraft({ name: '花呗', balance: 'abc' as unknown as number });
    expect(draft.balance).toBeUndefined();
    expect(createCreditDraft({ name: '花呗', balance: 0 }).balance).toBeUndefined();
    expect(createCreditDraft({ name: '花呗', balance: -100 }).balance).toBeUndefined();
  });

  it('还款日必须是 1–31 的整数', () => {
    expect(createCreditDraft({ name: '花呗', repaymentDay: 15 }).repaymentDay).toBe(15);
    expect(createCreditDraft({ name: '花呗', repaymentDay: 0 }).repaymentDay).toBeUndefined();
    expect(createCreditDraft({ name: '花呗', repaymentDay: 32 }).repaymentDay).toBeUndefined();
    expect(createCreditDraft({ name: '花呗', repaymentDay: 0.4 }).repaymentDay).toBeUndefined();
  });

  it('期数必须为正整数', () => {
    expect(createCreditDraft({ name: '花呗', remainingMonths: '12期' as unknown as number }).remainingMonths).toBe(12);
    expect(createCreditDraft({ name: '花呗', remainingMonths: 0 }).remainingMonths).toBeUndefined();
    expect(createCreditDraft({ name: '花呗', remainingMonths: 0.5 }).remainingMonths).toBeUndefined();
  });
});