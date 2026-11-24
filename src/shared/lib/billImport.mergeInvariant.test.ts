import { describe, expect, it } from 'vitest';
import type { TransactionItem } from '../../entities/transaction/types';
import { applyBillImportMode } from './billImport';

/**
 * 不变量:**重新导入一份不含某字段的账单,不能把已有交易的那个字段清空**。
 *
 * 解析器始终会产出 `orderNo` / `merchantOrderNo` / `status` 这几个键(值可能是 undefined),
 * 而更新载荷是 `{ ...existing, ...incoming }` —— 于是来源账单里没有的字段会把已有值覆盖成
 * undefined。同一笔交易的识别方式:先看订单号,没有订单号则用「日期|金额|类型|备注」,
 * 所以两边都没有订单号时(手工记的账、或没有订单列的 CSV)会走到合并分支。
 */
function existingRow(overrides: Partial<TransactionItem> = {}): TransactionItem {
  return {
    id: 'tx-1',
    type: 'expense',
    categoryId: 'cat-1',
    accountId: 'acc-1',
    amount: 88,
    date: '2026-04-10',
    note: '午餐',
    tags: ['午餐'],
    source: 'manual',
    status: 'completed',
    adjustmentKind: 'normal',
    attachments: [
      {
        id: 'att-1',
        name: 'receipt.png',
        remotePath: 'ledgerflow/attachments/tx-1/receipt.png',
        uploadedAt: '2026-04-10T08:30:00.000Z',
        mimeType: 'image/png',
        size: 1024
      }
    ],
    refundOfTransactionId: undefined,
    updatedAt: '2026-04-10T09:00:00.000Z',
    ...overrides
  };
}

/** 同一笔交易的导入草稿:来源账单里没有状态、没有单号列。 */
function incomingDraft(overrides: Partial<Omit<TransactionItem, 'id'>> = {}) {
  return {
    type: 'expense' as const,
    categoryId: 'cat-default',
    accountId: 'acc-default',
    amount: 88,
    date: '2026-04-10',
    note: '午餐',
    tags: ['支付宝'],
    source: 'alipay' as const,
    orderNo: undefined,
    merchantOrderNo: undefined,
    status: undefined,
    ...overrides
  };
}

function payloadFrom(mode: 'incremental' | 'merge') {
  const existing = existingRow();
  const result = applyBillImportMode({
    mode,
    existing: [existing],
    incoming: [incomingDraft()]
  });
  expect(result.update, '应当识别为同一笔并走合并分支').toHaveLength(1);
  return result.update[0].payload;
}

describe('变更检测与去重键用同一套归一', () => {
  /*
   * 去重键(buildBillIdentity)会把金额取整、备注与单号去空白、日期归一到本地日。
   * 变更检测原先比原始值,于是同一份账单可以同时被判成「是同一笔」和「有变化」——
   * 每次重新导入都发一条没必要的 update,报告里全是其实没变的「已更新」。
   */
  function runIncrementalWith(overrides: Record<string, unknown>) {
    return applyBillImportMode({
      mode: 'incremental',
      existing: [
        existingRow({
          note: '午餐',
          orderNo: 'A123',
          merchantOrderNo: 'M456',
          amount: 88
        })
      ],
      incoming: [
        incomingDraft({
          source: 'manual',
          tags: ['午餐'],
          note: '午餐',
          orderNo: 'A123',
          merchantOrderNo: 'M456',
          amount: 88,
          ...overrides
        } as never)
      ]
    });
  }

  it('备注带尾随空格不算变化', () => {
    const result = runIncrementalWith({ note: '午餐   ' });
    expect(result.update).toHaveLength(0);
    expect(result.skipped).toBe(1);
  });

  it('订单号带尾随空格不算变化', () => {
    const result = runIncrementalWith({ orderNo: 'A123  ' });
    expect(result.update).toHaveLength(0);
    expect(result.skipped).toBe(1);
  });

  it('金额多出可忽略的小数位不算变化', () => {
    const result = runIncrementalWith({ amount: 88.004 });
    expect(result.update).toHaveLength(0);
    expect(result.skipped).toBe(1);
  });

  it('备注真的变了仍然要更新', () => {
    const result = runIncrementalWith({ note: '午餐(改)' });
    expect(result.update).toHaveLength(1);
    expect(result.skipped).toBe(0);
  });

  it('金额真的变了仍然要更新', () => {
    const result = runIncrementalWith({ amount: 90 });
    expect(result.update).toHaveLength(1);
    expect(result.skipped).toBe(0);
  });
});

describe('同一笔的判定不受日期格式影响', () => {
  /*
   * 同一天的日期有两种存法:
   *   · 手动快记:纯日期 `2026-04-10`(toLocalDateKey 产出)
   *   · 助手导入:ISO 瞬间 `2026-04-10T00:00:00.000Z`(normalizeEntryDate 产出)
   *
   * 变更检测原先直接比字符串,于是「同一天、不同格式」被判成有变化 ——
   * 每次重新导入同一笔账单都会发出一条 update(报告里多出一批其实没变的「已更新」),
   * 还会把用户原来记的日期格式一并改写。去重键本来就按本地日归一的,这里与它对齐。
   */
  function runIncremental(incomingDate: string) {
    return applyBillImportMode({
      mode: 'incremental',
      existing: [existingRow()],
      incoming: [
        incomingDraft({
          // 除了日期,其余字段与已有记录完全一致 —— 只让格式不同
          source: 'manual',
          tags: ['午餐'],
          date: incomingDate
        })
      ]
    });
  }

  it('同一天、一边纯日期一边 ISO 瞬间,算「没有变化」并跳过', () => {
    const result = runIncremental('2026-04-10T00:00:00.000Z');
    expect(result.update).toHaveLength(0);
    expect(result.skipped).toBe(1);
  });

  it('真的换了一天,就当成另一笔新增(身份键含日期)', () => {
    const result = runIncremental('2026-04-11');
    expect(result.append).toHaveLength(1);
    expect(result.update).toHaveLength(0);
    expect(result.skipped).toBe(0);
  });

  it('纯日期对纯日期也照常跳过(对照组)', () => {
    const result = runIncremental('2026-04-10');
    expect(result.update).toHaveLength(0);
    expect(result.skipped).toBe(1);
  });
});

describe('账单重复导入不丢字段', () => {
  it('来源账单没有状态时,已有的状态必须保留(merge)', () => {
    // 状态被清空不只是显示问题:isBalanceAffectingStatus 的判断会跟着变,
    // 一条已关闭/待支付的记录会因此重新计入余额。
    expect(payloadFrom('merge').status).toBe('completed');
  });

  it('来源账单没有状态时,已有的状态必须保留(增量去重)', () => {
    expect(payloadFrom('incremental').status).toBe('completed');
  });

  it('已有的附件、调整类型与退款关联不受导入影响', () => {
    const payload = payloadFrom('merge');
    expect(payload.attachments).toHaveLength(1);
    expect(payload.adjustmentKind).toBe('normal');
    expect(payload.refundOfTransactionId).toBeUndefined();
  });

  it('来源账单确实带了状态时应当采用来源值(不能反向锁死)', () => {
    const result = applyBillImportMode({
      mode: 'merge',
      existing: [existingRow()],
      incoming: [incomingDraft({ status: 'refunded' })]
    });
    expect(result.update[0].payload.status).toBe('refunded');
  });

  it('两边都有订单号且相同时才按订单号合并', () => {
    const result = applyBillImportMode({
      mode: 'merge',
      existing: [existingRow({ orderNo: 'ORDER-1' })],
      incoming: [incomingDraft({ orderNo: 'ORDER-1', status: 'completed' })]
    });
    expect(result.update).toHaveLength(1);
    expect(result.update[0].id).toBe('tx-1');
  });

  it('两边标识不同则新增而不是覆盖(订单号不同 = 两笔)', () => {
    const result = applyBillImportMode({
      mode: 'merge',
      existing: [existingRow({ orderNo: 'ORDER-1' })],
      incoming: [incomingDraft({ orderNo: 'ORDER-2' })]
    });
    expect(result.update).toHaveLength(0);
    expect(result.append).toHaveLength(1);
  });
});
