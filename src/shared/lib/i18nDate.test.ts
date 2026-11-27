import { describe, expect, it } from 'vitest';
import { formatIsoDay } from './i18nDate';

/** 用当前时区构造「本地日历日」。 */
function localPartsDay(iso: string) {
  const [year, month, day] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  }).format(new Date(year, month - 1, day));
}

describe('formatIsoDay', () => {
  it('按界面语言格式化纯日期', () => {
    expect(formatIsoDay('2026-11-27', 'zh')).toBe('2026年11月27日');
    expect(formatIsoDay('2026-11-27', 'en')).toBe('Nov 27, 2026');
  });

  it('坏值不抛错,渲染成空串', () => {
    expect(formatIsoDay('', 'zh')).toBe('');
    expect(formatIsoDay('不是日期', 'zh')).toBe('');
  });

  it('纯日期按本地日算 —— 在 UTC- 时区里不会被推到前一天', () => {
    const original = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      const options = { year: 'numeric', month: 'short', day: 'numeric' } as const;

      // 阳性对照:直接把 YYYY-MM-DD 交给 Date 会被当成 **UTC 零点**,
      // 在纽约(UTC-5)就是 11 月 26 日 —— 这一步证明这个时区里"差一天"是真的会发生。
      const shifted = new Intl.DateTimeFormat('en-US', options).format(new Date('2026-11-27'));
      expect(shifted).toBe('Nov 26, 2026');

      expect(formatIsoDay('2026-11-27', 'en')).toBe('Nov 27, 2026');
      expect(formatIsoDay('2026-11-27', 'en')).toBe(localPartsDay('2026-11-27'));
    } finally {
      process.env.TZ = original;
    }
  });
});
