import { describe, expect, it, vi } from 'vitest';
import type { DebtItem, RepaymentRecord } from '../../debt/model/debtMetrics';
import type { ChatToolCall } from '../api/openaiCompatibleClient';
import {
  executeCreditToolCall,
  CREDIT_AGENT_INSTRUCTIONS,
  CREDIT_AGENT_TOOLS,
  type CreditAgentContext
} from './creditAgentTools';

function createCall(name: string, args: Record<string, unknown>): ChatToolCall {
  return { id: `call-${name}`, name, arguments: JSON.stringify(args) };
}

function createContext() {
  // store 侧:被 mutator 改动的“真实”数组。
  const storeDebts: DebtItem[] = [
    {
      id: 'debt-card',
      name: '招商银行信用卡',
      type: 'credit-card',
      balance: 4200,
      annualRate: 18.25,
      repaymentDay: 12,
      paymentAccount: '招商银行卡',
      status: 'active',
      entryMode: 'standard'
    },
    {
      id: 'debt-huabei',
      name: '花呗',
      type: 'consumer-loan',
      balance: 800,
      status: 'active',
      entryMode: 'standard'
    }
  ];
  const storeRecords: RepaymentRecord[] = [
    {
      id: 'rec-1',
      debtId: 'debt-card',
      amount: 500,
      paidAt: '2026-11-05',
      recordMode: 'manual',
      createdAt: '2026-11-05T00:00:00.000Z'
    }
  ];

  const ctx: CreditAgentContext = {
    // 工作副本:工具执行时更新,不影响 store 数组引用。
    debts: [...storeDebts],
    repaymentRecords: [...storeRecords],
    creditDrafts: [],
    monthlyIncome: 15000,
    now: new Date('2026-11-12T09:00:00.000Z'),
    addDebt: vi.fn((payload) => {
      const id = payload.id || `debt-${payload.type}-new`;
      storeDebts.unshift({ ...payload, id });
      return id;
    }),
    updateDebt: vi.fn((id, payload) => {
      const index = storeDebts.findIndex((item) => item.id === id);
      if (index >= 0) storeDebts[index] = { ...payload, id };
    }),
    removeDebt: vi.fn((id) => {
      const index = storeDebts.findIndex((item) => item.id === id);
      if (index >= 0) storeDebts.splice(index, 1);
    }),
    addRepaymentRecord: vi.fn((payload) => {
      const id = payload.id || `rec-${storeRecords.length + 1}`;
      storeRecords.unshift({ ...payload, id, createdAt: '2026-11-12T00:00:00.000Z' });
      return id;
    }),
    removeRepaymentRecord: vi.fn((id) => {
      const index = storeRecords.findIndex((item) => item.id === id);
      if (index >= 0) storeRecords.splice(index, 1);
    }),
    upsertCreditDraft: vi.fn(() => 'draft-new'),
    removeCreditDraft: vi.fn()
  };

  return { ctx, storeDebts, storeRecords };
}

describe('creditAgentTools 工具定义', () => {
  it('暴露读取与增删改工具,并带中文指令', () => {
    const names = CREDIT_AGENT_TOOLS.map((tool) => tool.function.name);
    expect(names).toContain('get_repayment_snapshot');
    expect(names).toContain('query_debts');
    expect(names).toContain('query_credit_drafts');
    expect(names).toContain('save_partial_debt_draft');
    expect(names).toContain('delete_credit_draft');
    expect(names).toContain('promote_credit_draft');
    expect(names).toContain('record_repayment');
    expect(names).toContain('update_repayment_record');
    expect(names).toContain('delete_repayment_record');
    expect(names).toContain('create_debt');
    expect(names).toContain('delete_debt');
    expect(CREDIT_AGENT_INSTRUCTIONS).toContain('台账');
    // 识别/分析类请求不应自动写库,保持“保存前确认”的体验。
    expect(CREDIT_AGENT_INSTRUCTIONS).toContain('不要调用任何写入工具');
  });
});

describe('creditAgentTools 读取类工具', () => {
  it('快照汇总总负债、压力与每笔本期应还', () => {
    const { ctx } = createContext();
    const result = executeCreditToolCall(createCall('get_repayment_snapshot', {}), ctx);
    const payload = JSON.parse(result.content);
    expect(payload.ok).toBe(true);
    expect(payload.summary.debtCount).toBe(2);
    expect(payload.summary.totalDebt).toBe(5000);
    expect(payload.summary.monthlyIncome).toBe(15000);
    const card = payload.debts.find((item: { id: string }) => item.id === 'debt-card');
    expect(card.balance).toBe(4200);
    expect(card.thisMonthPaid).toBe(500);
    expect(result.views[0]).toMatchObject({ kind: 'read', undoable: false });
  });

  it('按关键词检索负债并返回可用 id', () => {
    const { ctx } = createContext();
    const result = executeCreditToolCall(createCall('query_debts', { keyword: '信用卡' }), ctx);
    const payload = JSON.parse(result.content);
    expect(payload.matchedCount).toBe(1);
    expect(payload.debts[0].id).toBe('debt-card');
    expect(payload.available).toHaveLength(2);
  });

  it('按月份查询还款流水', () => {
    const { ctx } = createContext();
    const result = executeCreditToolCall(
      createCall('query_repayment_records', { month: '2026-11' }),
      ctx
    );
    const payload = JSON.parse(result.content);
    expect(payload.matchedCount).toBe(1);
    expect(payload.totalAmount).toBe(500);
    expect(payload.records[0].debtName).toBe('招商银行信用卡');
  });
});

describe('creditAgentTools 写入类工具', () => {
  it('缺少还款锚点时不创建半成品负债,改为提示保存草稿', () => {
    const { ctx, storeDebts } = createContext();
    const result = executeCreditToolCall(
      createCall('create_debt', { name: '京东白条', balance: 5900 }),
      ctx
    );
    const payload = JSON.parse(result.content);
    expect(payload.ok).toBe(false);
    expect(payload.suggestedTool).toBe('save_partial_debt_draft');
    expect(storeDebts.some((item) => item.name === '京东白条')).toBe(false);
  });

  it('新增负债后可撤销,并回滚工作副本', () => {
    const { ctx, storeDebts } = createContext();
    const result = executeCreditToolCall(
      createCall('create_debt', {
        name: '装修分期',
        type: 'consumer-loan',
        balance: 12000,
        repaymentDay: 20
      }),
      ctx
    );
    const payload = JSON.parse(result.content);
    expect(payload.ok).toBe(true);
    expect(storeDebts.some((item) => item.id === payload.id)).toBe(true);
    expect(result.views[0]).toMatchObject({ kind: 'create', undoable: true });

    result.undo[0].run();
    expect(storeDebts.some((item) => item.id === payload.id)).toBe(false);
    expect(ctx.debts.some((item) => item.id === payload.id)).toBe(false);
  });

  it('修改负债余额后可撤销恢复原值', () => {
    const { ctx, storeDebts } = createContext();
    const result = executeCreditToolCall(
      createCall('update_debt', { id: 'debt-card', balance: 3000 }),
      ctx
    );
    expect(JSON.parse(result.content).balance).toBe(3000);
    expect(storeDebts.find((item) => item.id === 'debt-card')?.balance).toBe(3000);

    result.undo[0].run();
    expect(storeDebts.find((item) => item.id === 'debt-card')?.balance).toBe(4200);
    expect(ctx.debts.find((item) => item.id === 'debt-card')?.balance).toBe(4200);
  });

  it('登记还款会扣减余额并写流水,撤销后全部还原', () => {
    const { ctx, storeDebts, storeRecords } = createContext();
    const result = executeCreditToolCall(
      createCall('record_repayment', {
        id: 'debt-card',
        amount: 1000,
        paidAt: '2026-11-11',
        paymentAccount: '招商银行卡'
      }),
      ctx
    );
    const payload = JSON.parse(result.content);
    expect(payload.balance).toBe(3200);
    expect(storeDebts.find((item) => item.id === 'debt-card')?.balance).toBe(3200);
    expect(storeRecords.some((record) => record.amount === 1000)).toBe(true);
    expect(result.views[0]).toMatchObject({ kind: 'create', undoable: true });

    result.undo[0].run();
    expect(storeDebts.find((item) => item.id === 'debt-card')?.balance).toBe(4200);
    expect(storeRecords.some((record) => record.amount === 1000)).toBe(false);
  });

  it('删除带还款流水的负债前需确认,确认后可撤销', () => {
    const { ctx, storeDebts, storeRecords } = createContext();
    const blocked = executeCreditToolCall(createCall('delete_debt', { id: 'debt-card' }), ctx);
    const blockedPayload = JSON.parse(blocked.content);
    expect(blockedPayload.ok).toBe(false);
    expect(blockedPayload.needsConfirmation).toBe(true);
    expect(blockedPayload.linkedRepaymentCount).toBe(1);
    expect(storeDebts.some((item) => item.id === 'debt-card')).toBe(true);

    const confirmed = executeCreditToolCall(
      createCall('delete_debt', { id: 'debt-card', confirmLinkedRecords: true }),
      ctx
    );
    expect(JSON.parse(confirmed.content).ok).toBe(true);
    expect(storeDebts.some((item) => item.id === 'debt-card')).toBe(false);
    expect(storeRecords).toHaveLength(0);

    confirmed.undo[0].run();
    expect(storeDebts.some((item) => item.id === 'debt-card')).toBe(true);
    expect(storeRecords.some((record) => record.debtId === 'debt-card')).toBe(true);
  });

  it('名称匹配到多笔时返回候选而不是误删', () => {
    const { ctx } = createContext();
    // 花呗没有关联还款流水,可以精确删除。
    const exact = executeCreditToolCall(createCall('delete_debt', { name: '花呗' }), ctx);
    expect(JSON.parse(exact.content).ok).toBe(true);

    ctx.debts.push({
      id: 'debt-card-2',
      name: '招商银行信用卡 分期',
      type: 'credit-card',
      balance: 1000,
      status: 'active',
      entryMode: 'standard'
    });
    const ambiguous = executeCreditToolCall(
      createCall('update_debt', { name: '信用', balance: 1 }),
      ctx
    );
    expect(JSON.parse(ambiguous.content).needsSelection).toBe(true);
  });

  it('片段草稿跨轮合并后转正，未补齐前不会创建正式负债', () => {
    const { ctx, storeDebts } = createContext();
    const first = executeCreditToolCall(
      createCall('save_partial_debt_draft', { name: '京东白条', balance: 2000 }),
      ctx
    );
    const firstPayload = JSON.parse(first.content);
    expect(firstPayload.ok).toBe(true);
    expect(firstPayload.ready).toBe(false);
    expect(firstPayload.pendingFields).toContain('剩余期数');
    expect(storeDebts.some((item) => item.name === '京东白条')).toBe(false);

    const merged = executeCreditToolCall(
      createCall('save_partial_debt_draft', {
        draftId: firstPayload.draft.id,
        remainingMonths: 6,
        repaymentDay: 20
      }),
      ctx
    );
    const mergedPayload = JSON.parse(merged.content);
    expect(mergedPayload.ready).toBe(true);
    expect(mergedPayload.draft.balance).toBe(2000);
    expect(mergedPayload.draft.remainingMonths).toBe(6);

    const blocked = executeCreditToolCall(
      createCall('promote_credit_draft', { draftId: mergedPayload.draft.id }),
      ctx
    );
    expect(JSON.parse(blocked.content).needsConfirmation).toBe(true);

    const promoted = executeCreditToolCall(
      createCall('promote_credit_draft', {
        draftId: mergedPayload.draft.id,
        confirm: true
      }),
      ctx
    );
    const promotedPayload = JSON.parse(promoted.content);
    expect(promotedPayload.ok).toBe(true);
    expect(storeDebts.some((item) => item.id === promotedPayload.id)).toBe(true);
    expect(ctx.creditDrafts).toHaveLength(0);

    promoted.undo[0].run();
    expect(storeDebts.some((item) => item.id === promotedPayload.id)).toBe(false);
    expect(ctx.creditDrafts.some((item) => item.name === '京东白条')).toBe(true);
  });

  it('修改和删除还款流水会校正负债余额并支持撤销', () => {
    const { ctx, storeDebts, storeRecords } = createContext();
    const updated = executeCreditToolCall(
      createCall('update_repayment_record', { id: 'rec-1', amount: 800 }),
      ctx
    );
    expect(JSON.parse(updated.content).ok).toBe(true);
    expect(storeRecords.find((record) => record.id === 'rec-1')?.amount).toBe(800);
    expect(storeDebts.find((item) => item.id === 'debt-card')?.balance).toBe(3900);

    updated.undo[0].run();
    expect(storeRecords.find((record) => record.id === 'rec-1')?.amount).toBe(500);
    expect(storeDebts.find((item) => item.id === 'debt-card')?.balance).toBe(4200);

    const blocked = executeCreditToolCall(
      createCall('delete_repayment_record', { id: 'rec-1' }),
      ctx
    );
    expect(JSON.parse(blocked.content).needsConfirmation).toBe(true);
    const deleted = executeCreditToolCall(
      createCall('delete_repayment_record', { id: 'rec-1', confirm: true }),
      ctx
    );
    expect(JSON.parse(deleted.content).ok).toBe(true);
    expect(storeRecords).toHaveLength(0);
    expect(storeDebts.find((item) => item.id === 'debt-card')?.balance).toBe(4700);

    deleted.undo[0].run();
    expect(storeRecords.some((record) => record.id === 'rec-1')).toBe(true);
    expect(storeDebts.find((item) => item.id === 'debt-card')?.balance).toBe(4200);
  });
});
