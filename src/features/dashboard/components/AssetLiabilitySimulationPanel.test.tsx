import { describe, expect, it } from 'vitest';
import { formatCalendarAmount } from '../model/assetLiabilitySimulationFormat';

describe('formatCalendarAmount', () => {
  it('uses compact k/w units while keeping the daily surplus sign visible', () => {
    expect(formatCalendarAmount(0)).toBe('0');
    expect(formatCalendarAmount(860)).toBe('+860');
    expect(formatCalendarAmount(-1250)).toBe('−1.25k');
    expect(formatCalendarAmount(42547.67)).toBe('+4.25w');
  });
});
