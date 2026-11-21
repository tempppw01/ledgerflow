import { describe, expect, it } from 'vitest';
import { resolveBrandMark } from './brandMark';
import { BRAND_MARKS } from './brandMarks';

describe('resolveBrandMark', () => {
  it('matches the brands people actually subscribe to', () => {
    const cases: Array<[string, string, string]> = [
      ['iCloud+ 200GB', 'Apple', 'icloud'],
      ['Netflix 高级会员', 'Netflix', 'netflix'],
      ['Spotify Premium', 'Spotify', 'spotify'],
      ['中国移动 5G 套餐', '中国移动', 'chinamobile'],
      ['手机套餐', '中国移动', 'chinamobile'],
      ['网易云音乐黑胶', '网易云音乐', 'neteasecloudmusic'],
      ['哔哩哔哩大会员', '哔哩哔哩', 'bilibili'],
      ['Disney+ 年费', 'Disney', 'disneyplus'],
      ['ChatGPT Plus', 'OpenAI', 'openai']
    ];

    for (const [name, provider, expected] of cases) {
      expect(resolveBrandMark(name, provider)?.slug, `${provider} / ${name}`).toBe(expected);
    }
  });

  it('prefers the specific brand over its parent brand', () => {
    // 「Apple Music」不能被「Apple」抢走,「QQ 音乐」不能被「QQ」抢走,
    // 「百度网盘」不能被「百度」抢走 —— 否则显示的 logo 就是错的。
    expect(resolveBrandMark('Apple Music 个人版', 'Apple')?.slug).toBe('applemusic');
    expect(resolveBrandMark('QQ 音乐绿钻', 'QQ')?.slug).toBe('qqmusic');
    expect(resolveBrandMark('百度网盘年度会员', '百度')?.slug).toBe('baidunetdisk');
    expect(resolveBrandMark('腾讯视频 VIP', '腾讯')?.slug).toBe('tencentvideo');
  });

  it('returns null instead of guessing when nothing matches', () => {
    expect(resolveBrandMark('视频平台会员', '视频平台')).toBeNull();
    expect(resolveBrandMark('手机话费套餐', '运营商')).toBeNull();
    expect(resolveBrandMark('', '')).toBeNull();
    expect(resolveBrandMark(undefined, null)).toBeNull();
  });
});

describe('BRAND_MARKS', () => {
  it('gives every brand a colour and something to draw', () => {
    for (const mark of BRAND_MARKS) {
      expect(mark.hex, mark.slug).toMatch(/^[0-9A-F]{6}$/);
      // 要么有官方图标路径,要么有文字标记,不能两者都缺。
      expect(Boolean(mark.path) || Boolean(mark.label), mark.slug).toBe(true);
      expect(mark.keywords.length, mark.slug).toBeGreaterThan(0);
    }
  });

  it('keeps keywords in the normalised form the matcher relies on', () => {
    // resolveBrandMark 只做「小写 + 去空格」,关键词必须已经处于同一形态,
    // 否则「Apple Music」这类带空格的写法永远匹配不到。
    for (const mark of BRAND_MARKS) {
      for (const keyword of mark.keywords) {
        expect(keyword, mark.slug).toBe(keyword.toLowerCase());
        expect(keyword.includes(' '), `${mark.slug}: ${keyword}`).toBe(false);
      }
    }
  });

  it('does not let an earlier keyword shadow a later brand of the same family', () => {
    // 同族品牌的前缀关系:apple ⊂ applemusic,qq ⊂ qqmusic。先生成的条目优先,
    // 所以更具体的品牌必须排在前面;这里用真实的匹配顺序做回归保护。
    const order = new Map(BRAND_MARKS.map((mark, index) => [mark.slug, index]));
    const pairs: Array<[string, string]> = [
      ['applemusic', 'apple'],
      ['appletv', 'apple'],
      ['youtubemusic', 'youtube'],
      ['primevideo', 'amazonprime'],
      ['qqmusic', 'qq'],
      ['baidunetdisk', 'baidu'],
      ['tencentvideo', 'qq']
    ];
    for (const [specific, general] of pairs) {
      expect(order.get(specific), `${specific} 应排在 ${general} 之前`).toBeLessThan(
        order.get(general) as number
      );
    }
  });
});
