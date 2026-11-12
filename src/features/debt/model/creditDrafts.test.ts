import { describe, expect, it } from 'vitest';
import {
  getCreditDraftPendingFields,
  isCreditDraftReady,
  parseCreditDraftFragment,
  upsertCreditDraft
} from './creditDrafts';

describe('creditDrafts', () => {
  it('把“京东白条总欠款2000”解析成不完整草稿', () => {
    const fragment = parseCreditDraftFragment('京东白条总欠款2000');
    expect(fragment).toMatchObject({
      name: '京东白条',
      balance: 2000,
      type: 'consumer-loan'
    });

    const result = upsertCreditDraft([], fragment!);
    expect(result.draft.name).toBe('京东白条');
    expect(result.draft.balance).toBe(2000);
    expect(isCreditDraftReady(result.draft)).toBe(false);
    expect(getCreditDraftPendingFields(result.draft)).toContain('剩余期数');
  });

  it('后续片段按同一身份合并并自动补全期数、还款日和每期金额', () => {
    const first = upsertCreditDraft(
      [],
      parseCreditDraftFragment('招商银行信用卡总欠款4200')!
    );
    const nextPatch = parseCreditDraftFragment('还有6期，每月20号还款，每期还700');
    expect(nextPatch).toMatchObject({
      remainingMonths: 6,
      repaymentDay: 20,
      monthlyAmount: 700
    });

    const merged = upsertCreditDraft(first.drafts, nextPatch!);
    expect(merged.matched).toBe(true);
    expect(merged.draft.id).toBe(first.draft.id);
    expect(merged.draft.balance).toBe(4200);
    expect(isCreditDraftReady(merged.draft)).toBe(true);
  });

  it('同名草稿用当前明确金额覆盖旧金额', () => {
    const first = upsertCreditDraft([], parseCreditDraftFragment('京东白条总欠款5900')!);
    const next = upsertCreditDraft(first.drafts, parseCreditDraftFragment('京东白条总欠款2000')!);
    expect(next.matched).toBe(true);
    expect(next.drafts).toHaveLength(1);
    expect(next.draft.balance).toBe(2000);
  });

  it('没有名称和金额的补充片段不会新建孤儿草稿', () => {
    const result = upsertCreditDraft([], parseCreditDraftFragment('还有6期')!);
    expect(result.drafts).toHaveLength(0);
  });

  it('不会把普通信贷分析问题误保存为草稿', () => {
    expect(parseCreditDraftFragment('还有6期')).toMatchObject({ remainingMonths: 6 });
    expect(parseCreditDraftFragment('哪几笔最该先还?')).toBeNull();
    expect(parseCreditDraftFragment('帮我分析一下这个月的还款压力')).toBeNull();
  });
});
