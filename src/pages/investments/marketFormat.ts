/**
 * 行情数字的格式化。
 *
 * 单独放一个文件的理由很实际:把「今天的市场,说人话」面板拆成独立组件之后,
 * 页面与面板都要用同一个百分号格式化 —— 放在页面的组件文件里会形成
 * `页面 → 面板 → 页面` 的循环 import,复制一份又迟早会出现两边不一致的显示。
 */
export function formatMarketPercent(value?: number | null) {
  if (typeof value !== 'number') return '--';
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
}
