/**
 * 用本地时区把 Date 转成 YYYY-MM-DD。
 *
 * `Date#toISOString().slice(0, 10)` 会先换算到 UTC,在 UTC+8 等东时区里,
 * 本地 00:00 常常会退到前一天,导致「本月」「最近 30 天」这类区间整体前移一天。
 */
export function toLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** 交易类记录是否真正影响余额:待支付、已关闭、失败的行不参与计算。 */
export function isBalanceAffectingStatus(status: string | undefined): boolean {
  return status !== 'pending' && status !== 'closed' && status !== 'failed';
}
