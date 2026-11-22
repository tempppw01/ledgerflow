/**
 * 金额取整的**唯一实现**:四舍五入到「分」。
 *
 * 为什么需要统一:项目里原先并存两种算法
 * - `Math.round(v * 100) / 100`(store 里的事务金额、余额)
 * - `Math.round((v + Number.EPSILON) * 100) / 100`(信贷还款辅助)
 *
 * 二进制的锅:`1.005 * 100 === 100.49999999999999`,于是前者给出 **1.00**、
 * 后者给出 **1.01** —— 同一个数值经过不同模块会差一分钱,对账时看起来像 bug。
 *
 * 这里统一采用「加 EPSILON 修正」的版本(与用户手算的四舍五入一致),并按符号修正,
 * 让负数的 `.5` 也远离零(-1.005 → -1.01),而不是被 Math.round 的「向 +∞ 取整」带偏。
 */
export function roundMoney(value: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }

  // 先取绝对值再修正 EPSILON:负数的浮点误差方向相反,不能用 -EPSILON 硬顶
  // (2.675 的 ULP 比 Number.EPSILON 大,减掉它完全没效果)。
  const absRounded = Math.round((Math.abs(numeric) + Number.EPSILON) * 100) / 100;

  // `-0` 归一成 `0`:否则 roundMoney(roundMoney(-0.004)) 会得到 0 而不是 -0,
  // 让「取整两次」不再幂等。
  if (absRounded === 0) {
    return 0;
  }
  return numeric < 0 ? -absRounded : absRounded;
}