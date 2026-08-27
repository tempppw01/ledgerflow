import { describe, expect, it } from 'vitest';
import type { Account } from '../../../entities/account/types';
import { ensureAccountId, inferAccountNameFromText } from './workbenchMapping';
import {
  buildAssistantSystemPrompt,
  buildTransactionPromptContext,
  extractJsonString,
  JSON_AGENT_PROMPT,
  normalizeAiBill,
  toDraftEntries
} from './workbenchUtils';
import type { Category } from '../../../entities/category/types';
import type { TransactionItem } from '../../../entities/transaction/types';

describe('workbenchUtils', () => {
  it('应能从带解释文本的响应中提取 transactions JSON', () => {
    const raw = `这是识别结果：\n\n{\n  "transactions": [{"type":"expense","amount":12.3,"date":"2025-01-01","note":"午餐","category":"餐饮","account":"微信","tags":["餐饮"]}]\n}\n\n请核对。`;
    const jsonText = extractJsonString(raw);
    const parsed = JSON.parse(jsonText) as unknown;
    const result = normalizeAiBill(parsed);

    expect(result?.transactions).toHaveLength(1);
    expect(result?.transactions[0].note).toBe('午餐');
  });

  it('未来日期的消费应自动归类为预算而非实际支出', () => {
    const today = new Date();
    const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 15)
      .toISOString()
      .slice(0, 10);

    const result = normalizeAiBill({
      transactions: [
        {
          type: 'expense',
          amount: '2999',
          date: nextMonth,
          note: '下月买手机',
          category: '购物',
          account: '',
          tags: ['计划消费']
        }
      ]
    });

    expect(result?.transactions).toHaveLength(1);
    expect(result?.transactions[0].type).toBe('budget');
  });
  it('应兼容图片 OCR 常见金额与日期格式', () => {
    const result = normalizeAiBill({
      transactions: [
        {
          type: 'expense',
          amount: '¥1,299.50',
          date: '2025年1月2日',
          note: '酒店',
          category: '旅行',
          account: '支付宝',
          tags: ['出差']
        }
      ]
    });

    expect(result?.transactions[0].amount).toBe(1299.5);
    expect(result?.transactions[0].date).toBe('2025-01-02');
  });
  it('应能在找不到账户时自动创建账户并复用（支付宝示例）', () => {
    const accounts: Account[] = [{ id: 'acc-cash', name: '现金', type: 'cash' }];
    let createdCount = 0;
    const addAccount = (name: string, type?: Account['type']) => {
      createdCount += 1;
      accounts.push({ id: `acc-${createdCount}`, name, type: type || 'virtual' });
      return `acc-${createdCount}`;
    };

    const id1 = ensureAccountId('支付宝', accounts, addAccount, {
      source: 'alipay',
      type: 'expense'
    });
    expect(id1).toBe('acc-1');
    expect(createdCount).toBe(1);

    const id2 = ensureAccountId('支付宝', accounts, addAccount, {
      source: 'alipay',
      type: 'expense'
    });
    expect(id2).toBe('acc-1');
    expect(createdCount).toBe(1);
  });
  it('应能在银行文本场景提取账户名并自动创建后复用（平安银行示例）', () => {
    const accounts: Account[] = [{ id: 'acc-cash', name: '现金', type: 'cash' }];
    let createdCount = 0;
    const addAccount = (name: string, type?: Account['type']) => {
      createdCount += 1;
      accounts.push({ id: `acc-bank-${createdCount}`, name, type: type || 'debit' });
      return `acc-bank-${createdCount}`;
    };

    const inferred = inferAccountNameFromText('平安银行入账10000', 'bank', { type: 'income' });
    expect(inferred).toBe('平安银行');

    const id1 = ensureAccountId(inferred, accounts, addAccount, { source: 'bank', type: 'income' });
    expect(id1).toBe('acc-bank-1');
    expect(createdCount).toBe(1);

    const id2 = ensureAccountId('平安银行', accounts, addAccount, {
      source: 'bank',
      type: 'income'
    });
    expect(id2).toBe('acc-bank-1');
    expect(createdCount).toBe(1);
  });
  it('应支持还款账单字段标准化（贷款截图识别场景）', () => {
    const result = normalizeAiBill({
      transactions: [
        {
          type: 'repayment',
          amount: '¥2,345.67',
          date: '2025/02/03',
          note: '平安银行房贷月供扣款',
          category: '还款',
          account: '平安银行',
          tags: ['房贷', '月供'],
          sourceHint: 'bank'
        }
      ]
    });

    expect(result?.transactions).toHaveLength(1);
    expect(result?.transactions[0].type).toBe('repayment');
    expect(result?.transactions[0].amount).toBe(2345.67);
    expect(result?.transactions[0].date).toBe('2025-02-03');
    expect(result?.transactions[0].sourceHint).toBe('bank');
  });

  it('分期还款截图应按剩余期数展开多条 repayment', () => {
    const result = normalizeAiBill({
      transactions: [
        {
          type: 'repayment',
          amount: '¥2,000.00',
          perPeriodAmount: '¥1,500.00',
          remainingPeriods: 3,
          date: '2025-02-10',
          note: '招行信用卡分期还款',
          category: '还款',
          account: '招商银行',
          tags: ['信用卡', '分期'],
          sourceHint: 'bank'
        }
      ]
    });

    expect(result?.transactions).toHaveLength(3);
    expect(result?.transactions.map((item) => item.amount)).toEqual([1500, 1500, 1500]);
    expect(result?.transactions.map((item) => item.date)).toEqual([
      '2025-02-10',
      '2025-03-10',
      '2025-04-10'
    ]);
    expect(result?.transactions[0].note).toContain('第1/3期');
  });

  it('应识别美元金额并保留币种信息', () => {
    const result = normalizeAiBill({
      transactions: [
        {
          type: 'expense',
          amount: '$20.50',
          originalAmountText: '$20.50',
          date: '2025-02-03',
          note: '咖啡',
          category: '餐饮',
          account: '现金',
          tags: ['出差']
        }
      ]
    });

    expect(result?.transactions).toHaveLength(1);
    expect(result?.transactions[0].amount).toBe(20.5);
    expect(result?.transactions[0].currency).toBe('USD');
    expect(result?.transactions[0].originalAmountText).toBe('$20.50');
  });

  it('应识别港币金额而不是误判为美元', () => {
    const result = normalizeAiBill({
      transactions: [
        {
          type: 'expense',
          amount: 'HK$300',
          originalAmountText: 'HK$300',
          date: '2025-02-03',
          note: '香港打车',
          category: '交通',
          account: '现金',
          tags: ['出行']
        }
      ]
    });

    expect(result?.transactions).toHaveLength(1);
    expect(result?.transactions[0].amount).toBe(300);
    expect(result?.transactions[0].currency).toBe('HKD');
  });

  it('应将语义召回与长期记忆片段注入系统提示词', () => {
    const prompt = buildAssistantSystemPrompt({
      basePrompt: 'base prompt',
      timeContext: 'time context',
      transactionContext: '{"rows":[]}',
      repaymentContext: '{"plannedRepayment":[]}',
      semanticRecallContext: '1. expense coffee',
      globalMemoryContext: '1. user prefers monthly summaries'
    });

    expect(prompt).toContain('账本交易数据快照');
    expect(prompt).toContain('还款管理上下文');
    expect(prompt).toContain('语义召回片段');
    expect(prompt).toContain('1. expense coffee');
    expect(prompt).toContain('长期记忆片段');
    expect(prompt).toContain('1. user prefers monthly summaries');
  });

  it('记账提示词应要求 needsReview 并保留前端分期展开边界', () => {
    expect(JSON_AGENT_PROMPT).toContain('needsReview');
    expect(JSON_AGENT_PROMPT).toContain('只输出 1 条第 1 期 repayment');
    expect(JSON_AGENT_PROMPT).toContain('不要生成 N 条 JSON');
    expect(JSON_AGENT_PROMPT).toContain('来源推断由前端根据');
  });

  it('needsReview 识别不确定字段应进入校验并提示人工确认', () => {
    const result = normalizeAiBill({
      transactions: [
        {
          type: 'expense',
          amount: '99.5',
          date: '2025-02-03',
          note: '午餐-食堂 99.5',
          category: '餐饮',
          account: '',
          tags: ['餐饮'],
          needsReview: ['amount', 'account']
        }
      ]
    });

    expect(result?.transactions[0].needsReview).toEqual(['amount']);

    const draft = toDraftEntries(result!)[0];
    expect(draft.issues).toContainEqual(
      expect.objectContaining({
        field: 'amount',
        needsReview: true,
        message: expect.stringContaining('人工确认')
      })
    );
  });

  it('交易快照应按最近时间窗口瘦身，同时保留汇总与可用账户', () => {
    const categories: Category[] = [{ id: 'cat-food', name: '餐饮', kind: 'expense' }];
    const accounts: Account[] = [{ id: 'acc-wx', name: '微信钱包', type: 'virtual' }];
    const today = new Date().toISOString().slice(0, 10);
    const oldDate = '2020-01-01';
    const transactions: TransactionItem[] = [
      {
        id: 'tx-old',
        type: 'expense',
        categoryId: 'cat-food',
        accountId: 'acc-wx',
        amount: 50,
        date: oldDate,
        note: '老旧消费',
        tags: ['餐饮']
      },
      {
        id: 'tx-recent',
        type: 'expense',
        categoryId: 'cat-food',
        accountId: 'acc-wx',
        amount: 30,
        date: today,
        note: '最近消费',
        tags: ['餐饮']
      }
    ];

    const snapshot = JSON.parse(
      buildTransactionPromptContext(transactions, categories, accounts, {
        focusQuestion: '最近一个月消费分析'
      })
    );

    expect(snapshot.focusRecentDays).toBe(31);
    expect(snapshot.totalTransactions).toBe(2);
    expect(snapshot.includedTransactions).toBe(1);
    expect(snapshot.rows[0].note).toBe('最近消费');
    expect(snapshot.availableAccounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'acc-wx', name: '微信钱包' })
      ])
    );
  });
});
