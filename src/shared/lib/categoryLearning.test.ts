import { describe, expect, it } from 'vitest';
import {
  applyCategoryCorrection,
  buildLearningTokens,
  suggestCategoryFromRules,
  type CategoryLearningRule
} from './categoryLearning';

/**
 * 分类学习的三块逻辑。这套东西在 store 里原本是空壳(返回 null / noop),
 * 这里把行为钉住,免得以后又变成"看起来有、其实没做"。
 */

const baseRule = (over: Partial<CategoryLearningRule> = {}): CategoryLearningRule => ({
  id: 'rule-1',
  token: '稻家乐社区厨房',
  type: 'expense',
  categoryId: 'cat-food',
  hitCount: 1,
  createdAt: '2026-11-01T00:00:00.000Z',
  lastAppliedAt: '2026-11-01T00:00:00.000Z',
  ...over
});

describe('buildLearningTokens', () => {
  it('去掉括号里的分店名、数字与标点', () => {
    const tokens = buildLearningTokens({
      note: '稻家乐社区厨房(寮步坑口店) · 稻家乐寮步坑口店 · /',
      orderNo: '4200003234202611248610141021'
    });
    expect(tokens).toContain('稻家乐社区厨房');
    expect(tokens).toContain('稻家乐寮步坑口店');
    // 分店名被括号剔除后不该出现
    expect(tokens.some((token) => token.includes('寮步坑口店)'))).toBe(false);
  });

  it('单字 token 被丢掉(太泛,会误伤)', () => {
    expect(buildLearningTokens({ note: '餐 麦当劳' })).toEqual(['麦当劳']);
  });

  it('空输入返回空数组', () => {
    expect(buildLearningTokens({ note: '' })).toEqual([]);
    expect(buildLearningTokens({ note: '   ' })).toEqual([]);
  });
});

describe('suggestCategoryFromRules', () => {
  it('命中规则时给出分类', () => {
    const result = suggestCategoryFromRules(
      { type: 'expense', note: '稻家乐社区厨房(寮步坑口店)' },
      [baseRule()]
    );
    expect(result).toMatchObject({ categoryId: 'cat-food', token: '稻家乐社区厨房' });
    expect(result?.confidence).toBeGreaterThan(0.5);
  });

  it('类型不同不命中', () => {
    expect(
      suggestCategoryFromRules({ type: 'income', note: '稻家乐社区厨房' }, [baseRule()])
    ).toBeNull();
  });

  it('没有命中返回 null', () => {
    expect(
      suggestCategoryFromRules({ type: 'expense', note: '完全不同的商家' }, [baseRule()])
    ).toBeNull();
  });

  it('多条命中取次数最高的', () => {
    const rules = [
      baseRule({ id: 'r1', token: '厨房', categoryId: 'cat-food', hitCount: 1 }),
      baseRule({ id: 'r2', token: '稻家乐社区厨房', categoryId: 'cat-shopping', hitCount: 5 })
    ];
    const result = suggestCategoryFromRules({ type: 'expense', note: '稻家乐社区厨房' }, rules);
    expect(result?.categoryId).toBe('cat-shopping');
  });
});

describe('applyCategoryCorrection', () => {
  it('首次修正生成规则与事件', () => {
    const { rules, event } = applyCategoryCorrection(
      [],
      {
        type: 'expense',
        note: '稻家乐社区厨房',
        fromCategoryId: 'cat-default',
        toCategoryId: 'cat-food'
      },
      '2026-11-24T00:00:00.000Z'
    );

    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ token: '稻家乐社区厨房', categoryId: 'cat-food', hitCount: 1 });
    expect(event).toMatchObject({
      fromCategoryId: 'cat-default',
      toCategoryId: 'cat-food',
      tokens: ['稻家乐社区厨房'],
      ruleIds: [rules[0].id]
    });
  });

  it('改到同一分类时次数累加', () => {
    const { rules } = applyCategoryCorrection(
      [baseRule({ hitCount: 3 })],
      { type: 'expense', note: '稻家乐社区厨房', fromCategoryId: 'cat-food', toCategoryId: 'cat-food' },
      '2026-11-24T00:00:00.000Z'
    );
    expect(rules[0].hitCount).toBe(4);
    expect(rules[0].lastAppliedAt).toBe('2026-11-24T00:00:00.000Z');
  });

  it('改到另一个分类时次数重置为 1(旧偏好不再成立)', () => {
    const { rules } = applyCategoryCorrection(
      [baseRule({ hitCount: 7, categoryId: 'cat-food' })],
      {
        type: 'expense',
        note: '稻家乐社区厨房',
        fromCategoryId: 'cat-food',
        toCategoryId: 'cat-shopping'
      },
      '2026-11-24T00:00:00.000Z'
    );
    expect(rules[0].categoryId).toBe('cat-shopping');
    // 这一条曾经写成「先赋值再比较」,条件恒真,于是永远累加 —— 这条测试就是为了钉住它
    expect(rules[0].hitCount).toBe(1);
  });

  it('规则与事件都不重复堆积:同 token 只维护一条规则', () => {
    let state = applyCategoryCorrection(
      [],
      { type: 'expense', note: '某超市', fromCategoryId: 'a', toCategoryId: 'cat-shopping' },
      '2026-11-24T00:00:00.000Z'
    );
    state = applyCategoryCorrection(
      state.rules,
      { type: 'expense', note: '某超市', fromCategoryId: 'a', toCategoryId: 'cat-shopping' },
      '2026-11-24T01:00:00.000Z'
    );
    expect(state.rules).toHaveLength(1);
    expect(state.rules[0].hitCount).toBe(2);
  });
});