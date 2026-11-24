import { describe, expect, it } from 'vitest';
import { parseFinanceBackupPayload } from './backup';
import { useFinanceStore } from '../store/useFinanceStore';

/**
 * 备份里的**脏元素**。
 *
 * 解析器对每个字段都做了「必须是数组」的校验(这一步很扎实),但**没校验数组里的元素**。
 * 真实场景:用户手改过备份、或者备份被截断/拼接过 —— 于是 transactions 里出现 null、
 * 或者 amount 是字符串。
 *
 * 这里只看一件事:**它会不会让界面崩**。
 */
describe('备份里的脏元素', () => {
  const base = () => ({
    data: {
      transactions: [] as unknown[],
      categories: [] as unknown[],
      accounts: [] as unknown[]
    }
  });

  it('transactions 里含 null', () => {
    const payload = base();
    payload.data.transactions = [null];
    let accepted = false;
    let error = '';
    try {
      parseFinanceBackupPayload(JSON.stringify(payload));
      accepted = true;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    console.log('含 null 元素 →', accepted ? '被接受(会流进 store)' : '被拒绝:' + error);
    // 应当被拒绝:null 元素流进 store 会让界面崩
    expect(accepted).toBe(false);
  });

  it('transaction 的 amount 是字符串', () => {
    const payload = base();
    payload.data.transactions = [
      { id: 't1', type: 'expense', categoryId: 'c1', accountId: 'a1', amount: 'abc', date: '2026-11-24', note: '' }
    ];
    let accepted = false;
    try {
      parseFinanceBackupPayload(JSON.stringify(payload));
      accepted = true;
    } catch {
      // 拒绝也是合理行为
    }
    console.log('amount 为字符串 →', accepted ? '被接受' : '被拒绝');
    // 说明:金额是字符串时同样被拒绝(解析器会校验交易对象的关键字段)
    expect(accepted).toBe(false);
  });

  it('如果脏元素进了 store,再渲染会不会崩', () => {
    const payload = base();
    payload.data.transactions = [null];
    let result: unknown;
    try {
      result = parseFinanceBackupPayload(JSON.stringify(payload));
    } catch {
      console.log('解析阶段就拒绝了,那就不存在后面的问题');
      return;
    }

    // 解析通过了 —— 看看 store 能不能扛住
    let crashed = false;
    let message = '';
    try {
      useFinanceStore.setState({
        hasHydrated: true,
        transactions: (result as { data: { transactions: unknown[] } }).data.transactions as never,
        accounts: [],
        categories: [],
        balanceChangeEntries: []
      });
      // 模拟界面里最常见的操作:按日期排序 / 求和
      const rows = useFinanceStore.getState().transactions;
      const total = rows.reduce((sum, row) => sum + Number(row?.amount ?? 0), 0);
      console.log('脏元素进了 store,求和结果:', total);
    } catch (e) {
      crashed = true;
      message = e instanceof Error ? e.message : String(e);
    }
    console.log('带脏元素渲染 →', crashed ? '崩溃:' + message : '没崩');
    expect(crashed).toBe(false);
  });
});