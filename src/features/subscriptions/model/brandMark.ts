import { BRAND_MARKS, type BrandMark } from './brandMarks';

/**
 * 订阅条目 → 品牌标识。
 *
 * 订阅名里通常混着品牌和套餐信息(「Netflix 高级会员」「iCloud+ 200GB」
 * 「中国移动 5G 套餐」),provider 字段又常常只有品牌名,所以两个字段拼起来
 * 一起匹配。匹配是「按 BRAND_MARKS 顺序取第一个命中」:生成脚本里已经把
 * 更具体的品牌排在前面(Apple Music 在 Apple 之前、QQ 音乐在 QQ 之前),
 * 因此不需要在这里再算优先级。
 */

const WHITESPACE = /\s+/g;

function normalize(value: string): string {
  return value.toLowerCase().replace(WHITESPACE, '');
}

export function resolveBrandMark(name?: string | null, provider?: string | null): BrandMark | null {
  const haystack = normalize(`${provider ?? ''} ${name ?? ''}`);
  if (!haystack) return null;

  for (const mark of BRAND_MARKS) {
    if (mark.keywords.some((keyword) => haystack.includes(keyword))) {
      return mark;
    }
  }
  return null;
}
