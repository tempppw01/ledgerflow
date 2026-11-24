import { describe, expect, it } from 'vitest';
import { inferCategoryFromText } from './workbenchMapping';

/**
 * 分类推断的关键词覆盖。
 *
 * 账单导入现在按行推断分类(见 shared/lib/billImport 的 inferBillCategoryId),所以这里的关键词
 * 直接决定「用户导进来的账归到哪一类」。下面这批名字来自真实微信账单(社区厨房、停车场、医院、
 * 超市、地铁、话费……)与常见商户类型 —— 每个都必须落到**人一看就同意**的分类上。
 *
 * 断言按「名字 → 期望分类」表驱动,失败时能直接看出是哪个商户词没覆盖。
 */
const CASES: Array<[string, string, string]> = [
  // [说明, 账单里的文本, 期望分类]
  ['社区厨房', '稻家乐社区厨房(寮步坑口店) 稻家乐寮步坑口店', '餐饮'],
  ['面馆', '兰州牛肉面馆', '餐饮'],
  ['小吃', '沙县小吃', '餐饮'],
  ['烘焙', '好利来烘焙坊', '餐饮'],
  ['外卖', '美团外卖 午餐', '餐饮'],
  ['咖啡', '瑞幸咖啡', '餐饮'],
  ['停车', '智慧停车 (寮步医院停车场)粤SA86256直付停车费', '交通'],
  ['打车', '滴滴出行 快车', '交通'],
  ['加油', '中国石化加油站', '交通'],
  ['地铁', '深圳地铁 乘车码', '交通'],
  ['医院', '东莞市寮步医院 MZJF刷卡支付', '医疗'],
  ['药房', '大参林药房 感冒药', '医疗'],
  ['超市', '永辉超市 日用品', '购物'],
  ['便利店', '美宜佳便利店', '购物'],
  ['网购', '淘宝网 订单', '购物'],
  ['房租', '房租 11月', '居住'],
  ['水费', '自来水费 缴费', '居住'],
  ['话费', '中国移动 话费充值', '通讯'],
  ['电影', '万达影城 电影票', '娱乐'],
  ['保险', '平安保险 保费', '保险']
];

describe('分类推断:真实商户名要落到对的分类', () => {
  for (const [label, text, expected] of CASES) {
    it(`${label}(${text.slice(0, 12)}…) → ${expected}`, () => {
      expect(inferCategoryFromText('expense', text)).toBe(expected);
    });
  }
});

describe('分类推断:收入侧', () => {
  it('工资 → 工资', () => {
    expect(inferCategoryFromText('income', '工资 11月薪资')).toBe('工资');
  });
  it('转账收入 → 收入', () => {
    expect(inferCategoryFromText('income', '转账备注:微信转账')).toBe('收入');
  });
  it('理财收益 → 投资收益', () => {
    expect(inferCategoryFromText('income', '理财收益 到账')).toBe('投资收益');
  });
});