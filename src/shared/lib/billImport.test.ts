import { describe, expect, it } from 'vitest';
import {
  applyBillImportMode,
  parseBillCsvToTransactions,
  parseBillCsvToTransactionsAsync
} from './billImport';
import type { TransactionItem } from '../../entities/transaction/types';

describe('parseBillCsvToTransactions', () => {
  it('应支持支付宝带说明头的账单并自动识别表头', () => {
    const csvText = [
      '支付宝交易记录明细查询',
      '账号:[demo@outlook.com]',
      '起始日期:[2025-11-10 00:00:00] 终止日期:[2026-02-10 09:06:47]',
      '---------------------------------交易记录明细列表---------------------------------',
      '交易号,商家订单号,交易创建时间,付款时间,最近修改时间,类型,交易对方,商品名称,金额（元）,收/支,交易状态,备注',
      '20260210100032004310286048575,0001N20260210000000001,2026/2/10 07:57,2026/2/10 07:57,2026/2/10 07:57,其他,杭州闲鱼,分账-基础服务,0.07,支出,交易成功,',
      '2026021022001460411415327586,0001N20260210000000002,2026/2/10 07:09,2026/2/10 07:09,2026/2/10 07:13,其他,高德顺风车,退款-高德顺风车,24.59,不计收支,退款成功,',
      '2026020922001460411414415742,6720180330024764010461,2026/2/9 22:21,2026/2/9 22:21,2026/2/9 22:21,其他,神行手打村,美团外卖,32,支出,交易成功,餐饮'
    ].join('\n');

    const rows = parseBillCsvToTransactions({
      csvText,
      source: 'alipay',
      defaultCategoryId: 'cat-food',
      defaultAccountId: 'acc-card'
    });

    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].orderNo).toBe('20260210100032004310286048575');
    expect(rows[0].merchantOrderNo).toBe('0001N20260210000000001');
    expect(rows[0].source).toBe('alipay');
  });

  it('应支持制表符分隔的支付宝账单', () => {
    const csvText = [
      '支付宝交易记录明细查询',
      '交易号\t商家订单号\t交易创建时间\t金额（元）\t收/支\t交易状态\t交易对方\t商品名称',
      'T20260210\tM20260210\t2026/2/10 08:00\t9.99\t收入\t交易成功\t淘宝\tGemini Pro'
    ].join('\n');

    const rows = parseBillCsvToTransactions({
      csvText,
      source: 'alipay',
      defaultCategoryId: 'cat-food',
      defaultAccountId: 'acc-card'
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].orderNo).toBe('T20260210');
    expect(rows[0].merchantOrderNo).toBe('M20260210');
    expect(rows[0].amount).toBe(9.99);
  });

  it('新导入账单默认保留为空分类，由交易列表显示为未分类', () => {
    const csvText = [
      '微信支付账单明细',
      '交易时间,交易类型,交易对方,商品,收/支,金额(元),当前状态,交易单号,商户单号',
      '2026-05-26 12:00:00,商户消费,美团外卖,午餐,支出,¥32.00,支付成功,5301000001,1000000001'
    ].join('\n');

    const rows = parseBillCsvToTransactions({
      csvText,
      source: 'wechat',
      defaultCategoryId: '',
      defaultAccountId: 'acc-wechat'
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].categoryId).toBe('');
  });

  it('应合并重复标题栏字段并保留完整信息', () => {
    const csvText = [
      '微信支付账单明细',
      '交易时间,交易类型,交易类型,交易对方,商品,收/支,金额(元),当前状态,交易单号,商户单号,备注',
      '2026-02-14 18:46:47,转账,微信零钱转账,666,转账备注:微信转账,支出,¥65.00,对方已收钱,53010002489226202602144159140074,1000050001202602140030491809117,/'
    ].join('\n');

    const rows = parseBillCsvToTransactions({
      csvText,
      source: 'wechat',
      defaultCategoryId: 'cat-default',
      defaultAccountId: 'acc-default'
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('expense');
    expect(rows[0].amount).toBe(65);
    expect(rows[0].note).toContain('666');
    expect(rows[0].orderNo).toBe('53010002489226202602144159140074');
    expect(rows[0].merchantOrderNo).toBe('1000050001202602140030491809117');
  });
  it('应将支付宝不计收支中的退款识别为收入、还款识别为还款类型', () => {
    const csvText = [
      '支付宝交易记录明细查询',
      '交易号,商家订单号,交易创建时间,金额（元）,收/支,交易状态,交易对方,商品名称,备注',
      'R20260210,M20260210,2026/2/10 08:00,24.59,不计收支,退款成功,高德,退款-高德顺风车,',
      'H20260210,MH20260210,2026/2/10 09:00,1200,不计收支,交易成功,蚂蚁花呗,花呗自动还款,本期还款'
    ].join('\n');

    const rows = parseBillCsvToTransactions({
      csvText,
      source: 'alipay',
      defaultCategoryId: 'cat-default',
      defaultAccountId: 'acc-default'
    });

    expect(rows).toHaveLength(2);
    expect(rows[0].type).toBe('income');
    expect(rows[1].type).toBe('repayment');
  });

  it('支付宝乱码头部下应仍按默认规则识别为支出，且退款金额列优先识别收入', () => {
    const csvText = [
      '支付宝交易记录明细查询',
      '交易号,金额（元）,收/支,交易状态,成功退款（元）,交易对方,商品名称',
      'A1,16.99,֧��,交易成功,0,淘宝,Gemini 3 Pro',
      'A2,1.80,֧��,交易关闭,1.80,淘宝,Gemini 3 Pro API'
    ].join('\n');

    const rows = parseBillCsvToTransactions({
      csvText,
      source: 'alipay',
      defaultCategoryId: 'cat-default',
      defaultAccountId: 'acc-default'
    });

    expect(rows).toHaveLength(2);
    expect(rows[0].type).toBe('expense');
    expect(rows[1].type).toBe('income');
  });

  it('异步解析在大体量账单下与同步解析结果一致', async () => {
    const header = '交易号,商家订单号,交易创建时间,金额（元）,收/支,交易状态,交易对方,商品名称';
    const body = Array.from({ length: 1200 }, (_, index) => {
      const seq = String(index + 1).padStart(6, '0');
      return `T${seq},M${seq},2026/2/10 08:00,9.99,支出,交易成功,淘宝,订阅服务`;
    });

    const csvText = ['支付宝交易记录明细查询', header, ...body].join('\n');
    const input = {
      csvText,
      source: 'alipay' as const,
      defaultCategoryId: 'cat-food',
      defaultAccountId: 'acc-card'
    };

    const syncRows = parseBillCsvToTransactions(input);
    const asyncRows = await parseBillCsvToTransactionsAsync(input);

    expect(asyncRows).toHaveLength(1200);
    expect(asyncRows).toEqual(syncRows);
  }, 15000);
});

describe('applyBillImportMode', () => {
  it('updates changed duplicate bills in incremental mode and preserves local enrichments', () => {
    const existing: TransactionItem[] = [
      {
        id: 'tx-1',
        type: 'expense',
        categoryId: 'cat-custom',
        accountId: 'acc-custom',
        amount: 88.8,
        date: '2026-04-10T08:00:00.000Z',
        note: 'Old note',
        tags: ['支付宝导入', '手工标签'],
        source: 'alipay' as const,
        orderNo: 'trade-1',
        merchantOrderNo: 'merchant-1',
        status: 'pending' as const,
        attachments: [
          {
            id: 'att-1',
            name: 'receipt.png',
            remotePath: 'ledgerflow/attachments/tx-1/receipt.png',
            uploadedAt: '2026-04-10T08:30:00.000Z'
          }
        ]
      }
    ];

    const incoming = [
      {
        type: 'expense' as const,
        categoryId: 'cat-default',
        accountId: 'acc-default',
        amount: 88.8,
        date: '2026-04-10T08:00:00.000Z',
        note: 'New note',
        tags: ['支付宝导入'],
        source: 'alipay' as const,
        orderNo: 'trade-1',
        merchantOrderNo: 'merchant-1',
        status: 'completed' as const
      }
    ];

    const result = applyBillImportMode({
      mode: 'incremental',
      existing,
      incoming
    });

    expect(result.append).toEqual([]);
    expect(result.skipped).toBe(0);
    expect(result.update).toHaveLength(1);
    expect(result.update[0].id).toBe('tx-1');
    expect(result.update[0].payload.status).toBe('completed');
    expect(result.update[0].payload.note).toBe('New note');
    expect(result.update[0].payload.categoryId).toBe('cat-custom');
    expect(result.update[0].payload.accountId).toBe('acc-custom');
    expect(result.update[0].payload.attachments).toEqual(existing[0].attachments);
    expect(result.update[0].payload.tags).toEqual(['支付宝导入', '手工标签']);
  });

  it('skips unchanged duplicate bills in incremental mode', () => {
    const existing: TransactionItem[] = [
      {
        id: 'tx-1',
        type: 'expense',
        categoryId: 'cat-custom',
        accountId: 'acc-custom',
        amount: 88.8,
        date: '2026-04-10T08:00:00.000Z',
        note: 'Lunch',
        tags: ['支付宝导入', '手工标签'],
        source: 'alipay' as const,
        orderNo: 'trade-1',
        merchantOrderNo: 'merchant-1',
        status: 'completed' as const
      }
    ];

    const incoming = [
      {
        type: 'expense' as const,
        categoryId: 'cat-default',
        accountId: 'acc-default',
        amount: 88.8,
        date: '2026-04-10T08:00:00.000Z',
        note: 'Lunch',
        tags: ['支付宝导入'],
        source: 'alipay' as const,
        orderNo: 'trade-1',
        merchantOrderNo: 'merchant-1',
        status: 'completed' as const
      }
    ];

    const result = applyBillImportMode({
      mode: 'incremental',
      existing,
      incoming
    });

    expect(result.update).toEqual([]);
    expect(result.append).toEqual([]);
    expect(result.skipped).toBe(1);
  });

  it('preserves local enrichments in merge mode while refreshing imported fields', () => {
    const existing: TransactionItem[] = [
      {
        id: 'tx-1',
        type: 'expense',
        categoryId: 'cat-custom',
        accountId: 'acc-custom',
        amount: 88.8,
        date: '2026-04-10T08:00:00.000Z',
        note: 'Lunch',
        tags: ['支付宝导入', '手工标签'],
        source: 'alipay' as const,
        orderNo: 'trade-1',
        merchantOrderNo: 'merchant-1',
        status: 'pending' as const,
        attachments: [
          {
            id: 'att-1',
            name: 'receipt.png',
            remotePath: 'ledgerflow/attachments/tx-1/receipt.png',
            uploadedAt: '2026-04-10T08:30:00.000Z'
          }
        ]
      }
    ];

    const incoming = [
      {
        type: 'expense' as const,
        categoryId: 'cat-default',
        accountId: 'acc-default',
        amount: 99.9,
        date: '2026-04-10T08:00:00.000Z',
        note: 'Updated lunch',
        tags: ['支付宝导入'],
        source: 'alipay' as const,
        orderNo: 'trade-1',
        merchantOrderNo: 'merchant-1',
        status: 'completed' as const
      }
    ];

    const result = applyBillImportMode({
      mode: 'merge',
      existing,
      incoming
    });

    expect(result.update).toHaveLength(1);
    expect(result.update[0].payload.amount).toBe(99.9);
    expect(result.update[0].payload.status).toBe('completed');
    expect(result.update[0].payload.categoryId).toBe('cat-custom');
    expect(result.update[0].payload.accountId).toBe('acc-custom');
    expect(result.update[0].payload.attachments).toEqual(existing[0].attachments);
    expect(result.update[0].payload.tags).toEqual(['支付宝导入', '手工标签']);
  });
});
