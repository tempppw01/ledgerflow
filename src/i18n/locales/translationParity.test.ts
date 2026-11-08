import { describe, expect, it } from 'vitest';
import enTranslation from './en/translation.json';
import zhTranslation from './zh/translation.json';

function flattenTranslations(tree: object, prefix = ''): Record<string, string> {
  const flattened: Record<string, string> = {};

  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;

    if (typeof value === 'string') {
      flattened[path] = value;
      continue;
    }

    if (value && typeof value === 'object') {
      Object.assign(flattened, flattenTranslations(value, path));
    }
  }

  return flattened;
}

function getPlaceholders(value: string): string[] {
  return [...value.matchAll(/{{\s*([^{}]+?)\s*}}/g)].map((match) => match[1]).sort();
}

const english = flattenTranslations(enTranslation);
const chinese = flattenTranslations(zhTranslation);

describe('translation resources', () => {
  it('defines the same keys in English and Chinese', () => {
    expect(Object.keys(english).sort()).toEqual(Object.keys(chinese).sort());
  });

  it('does not contain empty translations', () => {
    const emptyKeys = [...Object.entries(english), ...Object.entries(chinese)]
      .filter(([, value]) => !value.trim())
      .map(([key]) => key);

    expect(emptyKeys).toEqual([]);
  });

  it('keeps interpolation placeholders in sync', () => {
    const mismatches = Object.keys(english).filter(
      (key) =>
        key in chinese &&
        JSON.stringify(getPlaceholders(english[key])) !==
          JSON.stringify(getPlaceholders(chinese[key]))
    );

    expect(mismatches).toEqual([]);
  });

  it('only allows the bilingual language label to contain Chinese in English resources', () => {
    const allowedKeys = new Set(['settings.language.label']);
    const unexpectedCjk = Object.entries(english)
      .filter(([key, value]) => !allowedKeys.has(key) && /[\u3400-\u9fff\uf900-\ufaff]/.test(value))
      .map(([key]) => key);

    expect(unexpectedCjk).toEqual([]);
  });
});
