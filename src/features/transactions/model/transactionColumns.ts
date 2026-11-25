/**
 * 交易表格的列标识。
 *
 * 定义搬到这里(原来只在 `TransactionTable.tsx` 里),因为列宽规则散不开:
 * 表格要按列取最小值、页面要按列钳位、设置面板要按列渲染按钮 ——
 * 三者都依赖这个联合类型,让它留在一个组件文件里只会鼓励各自再抄一份。
 */
export type TransactionColumnKey =
  | 'date'
  | 'type'
  | 'status'
  | 'category'
  | 'account'
  | 'amount'
  | 'orderNo'
  | 'merchantOrderNo'
  | 'note';

/**
 * 交易表格列宽的**唯一真源**。
 *
 * 为什么必须收拢到一处:这些数字原来散在两个文件里,而且**已经不一致了** ——
 * `TransactionTable` 里写 `amount` 最小 64(`AMOUNT_COLUMN_MIN_WIDTH`),
 * 而 `TransactionsPage.COLUMN_MIN_WIDTHS` 里写 72,页面那层才是最终钳位。
 * 于是按 `Home` 把列调到最窄时,手柄会报 `aria-valuenow=64`,实际列宽却是 72 ——
 * 一个**正在发生的假读数**(同一处代码的注释早就警告过上限不一致会出这种问题,
 * 只是没人注意到下限也叫同样的病)。
 *
 * 取值以**页面的钳位**为准(72),这样修的是"报出来的数",不是"实际的行为":
 * 用户看到的列宽没有任何变化。
 */
export const DEFAULT_MIN_COLUMN_WIDTH = 90;
export const AMOUNT_COLUMN_MIN_WIDTH = 72;
export const MAX_COLUMN_WIDTH = 640;
/** 键盘一次调多少;按住 Shift 用粗档。 */
export const COLUMN_KEYBOARD_STEP = 16;
export const COLUMN_KEYBOARD_COARSE_STEP = 48;

/** 按列取最小宽度:金额列数字短,可以更窄。 */
export function getMinColumnWidth(key: TransactionColumnKey): number {
  return key === 'amount' ? AMOUNT_COLUMN_MIN_WIDTH : DEFAULT_MIN_COLUMN_WIDTH;
}

/**
 * 把宽度钳进合法区间。
 *
 * 拖拽、键盘、设置面板里的按钮三条路径共用它 —— 任何一条自己写一遍钳位,
 * 都会重新长出"报出来的数"和"实际生效的数"不一致的问题。
 */
export function clampColumnWidth(key: TransactionColumnKey, width: number): number {
  return Math.max(getMinColumnWidth(key), Math.min(MAX_COLUMN_WIDTH, Math.round(width)));
}

/** 宽度是不是已经到边界了(设置面板据此禁用按钮,避免点出无变化的动作)。 */
export function isColumnWidthAtBounds(key: TransactionColumnKey, width: number): {
  atMin: boolean;
  atMax: boolean;
} {
  return { atMin: width <= getMinColumnWidth(key), atMax: width >= MAX_COLUMN_WIDTH };
}
