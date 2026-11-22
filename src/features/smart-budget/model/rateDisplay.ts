/**
 * 执行率显示。
 *
 * `(ratio * 100).toFixed(1)` 在超支几十倍时会给出「3155.3%」这类四位数百分比 ——
 * 数学正确但对读者没有信息量(卡片里真正有用的是「超支 ¥6,294」)。
 * 超过 999% 就封顶,其余保留一位小数,保证同一屏里的百分比宽度稳定。
 */
const RATE_CAP = 999;

export function formatExecutionRatePercent(ratio: number): string {
  if (!Number.isFinite(ratio)) {
    return ratio === Number.POSITIVE_INFINITY ? `>${RATE_CAP}%` : '0.0%';
  }
  const percent = ratio * 100;
  if (percent > RATE_CAP) {
    return `>${RATE_CAP}%`;
  }
  return `${percent.toFixed(1)}%`;
}