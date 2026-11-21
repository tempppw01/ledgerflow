import { describe, expect, it } from 'vitest';
import { escapeHtml } from './escapeHtml';

describe('escapeHtml', () => {
  it('转义全部五个危险字符', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });

  it('先处理 & ,避免二次转义(& 的替换必须排在 < 之前)', () => {
    // 若顺序写反,`<` 会先变成 `&lt;`,其中的 & 再被转义成 `&amp;lt;`
    expect(escapeHtml('<')).toBe('&lt;');
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('挡掉典型的备注注入', () => {
    const payload = '<img src=x onerror="alert(1)">';
    const out = escapeHtml(payload);
    expect(out).not.toContain('<img');
    expect(out).not.toContain('"');
    expect(out).toBe('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  });

  it('单引号也要转义(属性用单引号包裹时同样危险)', () => {
    expect(escapeHtml("' onmouseover='alert(1)")).toBe('&#39; onmouseover=&#39;alert(1)');
  });

  it('普通文本与中文原样保留', () => {
    expect(escapeHtml('工作午餐 ¥28.00')).toBe('工作午餐 ¥28.00');
    expect(escapeHtml('')).toBe('');
  });
});