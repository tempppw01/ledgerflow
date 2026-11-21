/** 预测账单的收支方向。 */
export type ForecastBillDirection = 'income' | 'expense';

/** 重复方式:一次性,或每月同日再来一次。 */
export type ForecastBillRepeat = 'once' | 'monthly';

/**
 * 用户自己录入的「未来预测账单」。
 *
 * 与真实流水不同:它不参与账户余额计算,只喂给资产负债预测,用来推演
 * 「如果这笔钱在某个日期发生,未来现金流会怎样」。
 */
export interface ForecastBill {
  id: string;
  name: string;
  amount: number;
  /** YYYY-MM-DD。monthly 时作为首次发生的日期,后续按每月同日展开。 */
  date: string;
  direction: ForecastBillDirection;
  repeat: ForecastBillRepeat;
  note?: string;
  createdAt: string;
  updatedAt: string;
}