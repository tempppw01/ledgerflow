import { describe, expect, it } from 'vitest';
import type { InvestmentFundAnalysis } from '../../entities/investment/types';
import { summarizeInvestmentAnalysis } from './investmentAi';

const baseAnalysis: InvestmentFundAnalysis = {
  fundName: 'Alpha Growth Fund',
  fundCode: '161706',
  verdict: 'Keep watching before adding',
  summary: 'This fund suits staged entries, but not a one-shot buy.',
  riskLevel: 'medium',
  highlights: ['Broad exposure'],
  risks: ['Short-term volatility'],
  actions: ['Wait for pullback'],
  watchTags: ['watching']
};

describe('summarizeInvestmentAnalysis', () => {
  it('removes lines already rendered by the structured analysis card', () => {
    expect(
      summarizeInvestmentAnalysis(
        [
          'Keep watching before adding',
          'This fund suits staged entries, but not a one-shot buy.',
          '- Check fee and drawdown before buying'
        ].join('\n'),
        baseAnalysis
      )
    ).toBe('- Check fee and drawdown before buying');
  });

  it('does not append the structured summary to the chat bubble fallback', () => {
    expect(summarizeInvestmentAnalysis('', baseAnalysis)).toBe('Keep watching before adding');
  });
});
