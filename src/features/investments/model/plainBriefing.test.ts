import { describe, expect, it } from 'vitest';
import {
  isPolicySignal,
  readBoardExtremes,
  readBreadth,
  readMarketLead,
  selectBriefingNews
} from './plainBriefing';

const board = (name: string, changePercent: number) => ({ name, changePercent });

describe('readBreadth', () => {
  it('数家数与均值,并按偏斜判方向', () => {
    const read = readBreadth([
      board('A', 3),
      board('B', 1),
      board('C', -2),
      board('D', -1),
      board('E', 0)
    ]);
    expect(read).toMatchObject({ up: 2, down: 2, flat: 1, total: 5 });
    expect(read.averageChange).toBeCloseTo(0.2, 5);
    expect(read.tone).toBe('flat');
  });

  it('样本为 0 时是 unknown,不是 flat —— 「没有数据」不能当成「不涨不跌」', () => {
    expect(readBreadth([])).toEqual({
      up: 0,
      down: 0,
      flat: 0,
      total: 0,
      averageChange: null,
      tone: 'unknown'
    });
    // 只有空值/坏值的样本一样不能算样本
    expect(readBreadth([board('A', Number.NaN)]).total).toBe(0);
    expect(readBreadth([{ name: 'B' }]).total).toBe(0);
  });

  it('一边倒时给出方向', () => {
    expect(readBreadth([board('A', 2), board('B', 1)]).tone).toBe('positive');
    expect(readBreadth([board('A', -2), board('B', -1)]).tone).toBe('negative');
  });
});

describe('readBoardExtremes', () => {
  it('全市场都在涨时不给出"最弱" —— 这就是 +4.78% 被写成「偏弱」的根因', () => {
    const read = readBoardExtremes([board('油气资源', 4.78), board('CPO概念', 12.64)]);
    expect(read.strongest).toEqual({ name: 'CPO概念', changePercent: 12.64 });
    expect(read.weakest).toBeNull();
    expect(read.allUp).toBe(true);
    expect(read.allDown).toBe(false);
  });

  it('有下跌板块时才给出最弱,并且它一定是负数', () => {
    const read = readBoardExtremes([board('CPO概念', 12.64), board('银行', -1.2), board('煤炭', 0.4)]);
    expect(read.weakest).toEqual({ name: '银行', changePercent: -1.2 });
    expect(read.allUp).toBe(false);
    expect(read.weakest && read.weakest.changePercent).toBeLessThan(0);
  });

  it('全跌时最弱仍然给出,strongest 也是负的', () => {
    const read = readBoardExtremes([board('A', -0.2), board('B', -3)]);
    expect(read.allDown).toBe(true);
    expect(read.strongest).toEqual({ name: 'A', changePercent: -0.2 });
    expect(read.weakest).toEqual({ name: 'B', changePercent: -3 });
  });

  it('没有可用数据时全空', () => {
    expect(readBoardExtremes([])).toEqual({
      strongest: null,
      weakest: null,
      allUp: false,
      allDown: false
    });
  });
});

describe('readMarketLead', () => {
  it('两个数据源都没有 → unknown(文案必须如实说数据没到)', () => {
    const read = readMarketLead({ marketChange: null, boards: [] });
    expect(read).toMatchObject({ hasIndex: false, hasBoards: false, verdict: 'unknown' });
    expect(read.breadth).toBeNull();
  });

  it('只有指数 → 按指数说,不猜板块', () => {
    const read = readMarketLead({ marketChange: -1.4, boards: [] });
    expect(read).toMatchObject({ hasIndex: true, hasBoards: false, verdict: 'weak' });
    expect(read.breadth).toBeNull();
  });

  it('只有板块 → 按板块说,不猜指数', () => {
    const read = readMarketLead({ marketChange: null, boards: [board('A', 2), board('B', 1)] });
    expect(read).toMatchObject({ hasIndex: false, hasBoards: true, verdict: 'strong' });
    expect(read.breadth?.total).toBe(2);
  });

  it('指数与板块同向偏强 → strong', () => {
    const read = readMarketLead({
      marketChange: 0.9,
      boards: [board('A', 2), board('B', 1.5), board('C', 0.8)]
    });
    expect(read.verdict).toBe('strong');
    expect(read.diverges).toBe(false);
  });

  it('指数跌但板块普遍在涨 → mixed(背离才是最值得说的那条)', () => {
    const read = readMarketLead({
      marketChange: -0.6,
      boards: [board('A', 2), board('B', 1.5), board('C', 0.8)]
    });
    expect(read.verdict).toBe('mixed');
    expect(read.diverges).toBe(true);
  });

  it('方向不明时是 quiet,不是 strong', () => {
    const read = readMarketLead({
      marketChange: 0.1,
      boards: [board('A', 0.2), board('B', -0.2)]
    });
    expect(read.verdict).toBe('quiet');
  });
});

describe('selectBriefingNews', () => {
  it('优先政策类,并如实报告它是不是政策', () => {
    const picked = selectBriefingNews([
      { title: '某公司发布新品' },
      { title: '证监会发布新规,规范减持' }
    ]);
    expect(picked?.item.title).toBe('证监会发布新规,规范减持');
    expect(picked?.isPolicy).toBe(true);
  });

  it('政策判定只看标题 —— 正文里有政策词、标题看不出来时不戴「政策」标', () => {
    const picked = selectBriefingNews([
      { title: '澳门居民珠海养老服务落地', summary: '每人每月补助 5000 元' },
      { title: '央行开展 200 亿元逆回购' }
    ]);
    // 有标题信号的那条被选中
    expect(picked?.item.title).toBe('央行开展 200 亿元逆回购');
    expect(picked?.isPolicy).toBe(true);
  });

  it('只有正文提到政策时,不给它贴标签', () => {
    const picked = selectBriefingNews([
      { title: '某公司发布新品', summary: '公司获得地方政府补贴' },
      { title: '另一条新闻' }
    ]);
    expect(picked?.item.title).toBe('某公司发布新品');
    expect(picked?.isPolicy).toBe(false);
  });

  it('没有政策线索时退回第一条', () => {
    const picked = selectBriefingNews([{ title: '第一条' }, { title: '第二条' }]);
    expect(picked?.item.title).toBe('第一条');
    expect(picked?.isPolicy).toBe(false);
  });

  it('空标题与重复标题不占位置', () => {
    const picked = selectBriefingNews([
      { title: '   ' },
      { title: '同一条' },
      { title: '同 一 条' },
      { title: '另一条' }
    ]);
    expect(picked?.item.title).toBe('同一条');
    expect(selectBriefingNews([])).toBeNull();
    expect(selectBriefingNews([{ title: '' }])).toBeNull();
  });
});

describe('isPolicySignal', () => {
  it('认政策/监管线索', () => {
    expect(isPolicySignal('国务院部署央企专业化整合')).toBe(true);
    expect(isPolicySignal('央行宣布降准 0.5 个百分点')).toBe(true);
    expect(isPolicySignal('某白酒公司发布三季度业绩')).toBe(false);
  });
});
