import { describe, expect, it, vi } from 'vitest';
import {
  ensureAccountId,
  inferAccountNameFromText,
  inferCategoryFromText,
  inferSourceFromText,
  inferTags
} from './workbenchMapping';
import { normalizeLedgerCurrency } from './workbenchUtils';
import { parseCreditDraftFragment } from '../../debt/model/creditDrafts';
import { rankAssistantIntents } from '../shared/assistantIntentVocabulary';
import {
  ASSISTANT_AGENT_INSTRUCTIONS,
  ASSISTANT_COMMAND_VOCABULARY
} from '../agent/assistantAgentTools';
import {
  CREDIT_AGENT_INSTRUCTIONS,
  CREDIT_COMMAND_VOCABULARY
} from '../agent/creditAgentTools';

describe('AI 助手用户词汇覆盖', () => {
  it('Agent 指令覆盖查询、记账、修改、删除、确认、否定、时间和金额口语', () => {
    Object.values(ASSISTANT_COMMAND_VOCABULARY).forEach((words) => {
      words.forEach((word) => {
        expect(ASSISTANT_AGENT_INSTRUCTIONS).toContain(word);
      });
    });
  });

  it('信贷 Agent 指令覆盖查询、登记、修改、删除、还款和补充词汇', () => {
    Object.values(CREDIT_COMMAND_VOCABULARY).forEach((words) => {
      words.forEach((word) => {
        expect(CREDIT_AGENT_INSTRUCTIONS).toContain(word);
      });
    });
  });

  it.each([
    ['微信支付', 'wechat'],
    ['微信零钱', 'wechat'],
    ['零钱通', 'wechat'],
    ['wx 付款', 'wechat'],
    ['Weixin 付款', 'wechat'],
    ['支付宝', 'alipay'],
    ['余额宝', 'alipay'],
    ['Alipay', 'alipay'],
    ['zfb', 'alipay'],
    ['不写支付平台', 'ai']
  ] as const)('来源词汇“%s”识别为 %s', (text, expected) => {
    expect(inferSourceFromText(text)).toBe(expected);
  });

  it.each([
    ['expense', '早饭豆浆', '餐饮'],
    ['expense', '夜宵烧烤', '餐饮'],
    ['expense', '公司食堂午饭', '餐饮'],
    ['expense', '点了杯奶茶', '餐饮'],
    ['expense', '火锅聚餐', '餐饮'],
    ['expense', '瑞幸咖啡', '餐饮'],
    ['expense', '蜜雪冰城', '餐饮'],
    ['expense', '滴滴打车', '交通'],
    ['expense', '网约车', '交通'],
    ['expense', '停车费', '交通'],
    ['expense', '加油', '交通'],
    ['expense', '共享单车', '交通'],
    ['expense', '顺风车', '交通'],
    ['expense', '高铁票', '交通'],
    ['expense', '超市买菜', '购物'],
    ['expense', '盒马买日用品', '购物'],
    ['expense', '抖音商城下单', '购物'],
    ['expense', '猫超买纸巾', '购物'],
    ['expense', '山姆会员店', '购物'],
    ['expense', '房租', '居住'],
    ['expense', '物业费', '居住'],
    ['expense', '水费电费', '居住'],
    ['expense', '家政保洁', '居住'],
    ['expense', '医院挂号', '医疗'],
    ['expense', '诊所看牙', '医疗'],
    ['expense', '药店买药', '医疗'],
    ['expense', '演唱会门票', '娱乐'],
    ['expense', '游戏充值', '娱乐'],
    ['expense', '培训班报名费', '教育'],
    ['expense', '买书', '教育'],
    ['expense', '手机话费', '通讯'],
    ['expense', '充话费', '通讯'],
    ['expense', '冲话费', '通讯'],
    ['expense', '宽带续费', '通讯'],
    ['expense', '酒店民宿', '旅行'],
    ['expense', '景区门票', '旅行'],
    ['expense', '猫粮狗粮', '宠物'],
    ['expense', '买保险', '保险'],
    ['expense', '视频会员续费', '订阅'],
    ['expense', '随礼红包', '人情'],
    ['expense', '信用卡最低还款', '还款'],
    ['income', '发工资了', '工资'],
    ['income', '月底发薪水', '工资'],
    ['income', '年终奖到账', '奖金'],
    ['income', '项目提成', '奖金'],
    ['income', '接了个副业', '兼职'],
    ['income', '稿费收入', '兼职'],
    ['income', '基金分红', '投资收益'],
    ['income', '报销到账', '报销']
  ] as const)('%s 词汇“%s”归入“%s”', (type, text, expected) => {
    expect(inferCategoryFromText(type, text)).toBe(expected);
  });

  it.each([
    ['微信钱包', 'wechat', 'virtual'],
    ['零钱', 'unknown', 'virtual'],
    ['招商银行卡', 'unknown', 'debit'],
    ['现金', 'cash', 'cash'],
    ['花呗', 'unknown', 'credit'],
    ['房贷账户', 'unknown', 'liability']
  ] as const)('账户“%s”推断为 %s', (name, source, expected) => {
    const addAccount = vi.fn(() => 'account-new');
    expect(ensureAccountId(name, [], addAccount, { source })).toBe('account-new');
    expect(addAccount).toHaveBeenCalledWith(name, expected);
  });

  it('还款类词汇优先落到负债账户而不是扣款银行卡', () => {
    expect(inferAccountNameFromText('平安银行房贷月供扣款', 'bank', { type: 'repayment' })).toBe(
      '房贷账户'
    );
    expect(inferAccountNameFromText('招行信用卡还款', 'bank', { type: 'repayment' })).toBe(
      '信用卡'
    );
  });

  it.each([
    ['午餐 微信钱包', ['午餐', '微信']],
    ['打车 支付宝', ['打车', '支付宝']],
    ['超市买菜', ['支出']],
    ['视频会员续费', ['支出', '订阅']],
    ['工资到账', ['收入', '工资']],
    ['房贷月供', ['还款', '贷款']],
    ['花呗还款', ['还款', '信用账户']]
  ] as const)('标签词汇“%s”包含 %j', (text, expected) => {
    const type = text.includes('工资') ? 'income' : text.includes('还款') ? 'repayment' : 'expense';
    const tags = inferTags(type, text, inferCategoryFromText(type, text), []);
    expected.forEach((tag) => expect(tags).toContain(tag));
  });

  it.each([
    ['人民币', 'CNY'],
    ['RMB', 'CNY'],
    ['US$', 'USD'],
    ['港币', 'HKD'],
    ['日元', 'JPY'],
    ['欧元', 'EUR']
  ] as const)('币种词汇“%s”归一化为 %s', (text, expected) => {
    expect(normalizeLedgerCurrency(text)).toBe(expected);
  });

  it.each([
    ['最近三个月花销趋势怎么样', 'trend'],
    ['为什么这个月超支了', 'review'],
    ['下个月预算怎么安排', 'planning'],
    ['要不要提前还款', 'decision'],
    ['快还不上了怎么办', 'risk'],
    ['宠物一共花了多少', 'category']
  ] as const)('意图词汇“%s”包含 %s', (text, expected) => {
    expect(rankAssistantIntents(text)).toContain(expected);
  });

  it.each([
    ['花呗还欠2000，分12期，每期还180，每月20日还款', {
      name: '花呗',
      balance: 2000,
      totalPeriods: 12,
      monthlyAmount: 180,
      repaymentDay: 20
    }],
    ['微粒贷欠了5000', { name: '微粒贷', balance: 5000 }],
    ['抖音月付未还1234', { name: '抖音月付', balance: 1234 }],
    ['京东金条欠了6000', { name: '京东金条', balance: 6000 }],
    ['抖音放心借欠3000', { name: '抖音放心借', balance: 3000 }],
    ['美团借钱还剩8期', { name: '美团借钱', remainingMonths: 8 }],
    ['装修贷总共欠80000', { name: '装修贷', balance: 80000 }],
    ['信用卡最低还款额800', { dueAmount: 800 }],
    ['每月8号还款', { repaymentDay: 8 }]
  ] as const)('信贷口语“%s”可解析为 %j', (text, expected) => {
    expect(parseCreditDraftFragment(text)).toMatchObject(expected);
  });
});
