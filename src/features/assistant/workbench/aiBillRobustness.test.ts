import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { extractJsonString, normalizeAiBill } from './workbenchUtils';

/**
 * AI 记账结果的健壮性 —— 模型输出的形状是不可控的。
 *
 * 两条底线:
 * 1. **不要把整张识别结果丢掉**:模型把单号写成数字是很常见的事,
 *    旧代码 `row.orderNo?.trim()` 会抛 TypeError,而调用处的 try/catch 会把它当成
 *    「模型返回的是分析文本」→ 整张单子静默消失。
 * 2. **猜出来的值要标出来**:模型没给日期时只能退回「今天」,但必须进 `needsReview`,
 *    让用户在预览里核对,而不是悄悄按今天入账。
 */
function bill(transactions: unknown) {
  return { transactions };
}

describe('normalizeAiBill 健壮性', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-22T10:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('单号是数字时不抛错,也不丢整张单子', () => {
    const result = normalizeAiBill(
      bill([
        {
          type: 'expense',
          amount: 58,
          date: '2026-11-20',
          note: '午餐',
          orderNo: 12345,
          merchantOrderNo: 678
        }
      ])
    );

    expect(result).toBeTruthy();
    expect(result!.transactions).toHaveLength(1);
    expect(result!.transactions[0].orderNo).toBe('12345');
    expect(result!.transactions[0].merchantOrderNo).toBe('678');
  });

  it('金额是带符号的字符串也能解析', () => {
    const result = normalizeAiBill(
      bill([{ type: 'expense', amount: '¥1,234.56', date: '2026-11-20', note: '购物' }])
    );
    expect(result!.transactions[0].amount).toBe(1234.56);
  });

  it('模型没给日期时退回今天,但必须标记 needsReview: date', () => {
    const result = normalizeAiBill(
      bill([{ type: 'expense', amount: 58, note: '午餐' }])
    );
    const row = result!.transactions[0];
    expect(String(row.date).slice(0, 10)).toBe('2026-11-22');
    expect(row.needsReview, '猜出来的日期没有被标记,用户不会去核对').toContain('date');
  });

  it('模型给了日期时不额外标记', () => {
    const result = normalizeAiBill(
      bill([{ type: 'expense', amount: 58, date: '2026-11-20', note: '午餐' }])
    );
    expect(result!.transactions[0].needsReview ?? []).not.toContain('date');
  });

  it('模型自己标的 needsReview 与推断标记会合并去重', () => {
    const result = normalizeAiBill(
      bill([{ type: 'expense', amount: 58, note: '午餐', needsReview: ['date', 'amount'] }])
    );
    const review = result!.transactions[0].needsReview ?? [];
    expect(review).toContain('date');
    expect(review).toContain('amount');
    expect(review.filter((item) => item === 'date')).toHaveLength(1);
  });

  it('形错的输入返回 null,不抛错', () => {
    expect(normalizeAiBill(null)).toBeNull();
    expect(normalizeAiBill('text')).toBeNull();
    expect(normalizeAiBill([])).toBeNull();
    expect(normalizeAiBill({})).toBeNull();
    expect(normalizeAiBill({ transactions: 'nope' })).toBeNull();
  });

  it('单条形错的行被跳过,其余照常保留', () => {
    const result = normalizeAiBill(
      bill([
        null,
        'text',
        { type: 'expense', amount: 0, note: '金额为零' },
        { type: 'unknown', amount: 10, note: '类型无效' },
        { type: 'expense', amount: 58, date: '2026-11-20', note: '正常的一笔' }
      ])
    );
    expect(result!.transactions).toHaveLength(1);
    expect(result!.transactions[0].note).toBe('正常的一笔');
  });

  it('多余字段被忽略,不影响解析', () => {
    const result = normalizeAiBill(
      bill([
        {
          type: 'expense',
          amount: 58,
          date: '2026-11-20',
          note: '午餐',
          额外字段: '无关',
          nested: { deep: true }
        }
      ])
    );
    expect(result!.transactions).toHaveLength(1);
    expect(result!.transactions[0].amount).toBe(58);
  });
});

describe('extractJsonString', () => {
  it('取 ```json 代码块里的内容', () => {
    const text = '好的:\n```json\n{"transactions":[]}\n```\n完成';
    expect(extractJsonString(text)).toBe('{"transactions":[]}');
  });

  it('没有语言标记的代码块也能取', () => {
    expect(extractJsonString('```\n{"transactions":[]}\n```')).toBe('{"transactions":[]}');
  });

  it('裸 JSON 里按括号配对截取(能处理嵌套)', () => {
    const text = '结果: {"transactions":[{"note":"a}b"}]} 以上';
    const extracted = extractJsonString(text);
    expect(() => JSON.parse(extracted)).not.toThrow();
    expect(JSON.parse(extracted).transactions[0].note).toBe('a}b');
  });

  it('完全不是 JSON 时原样返回,交给上层判定为纯文本', () => {
    expect(extractJsonString('这是一段分析')).toBe('这是一段分析');
  });
});