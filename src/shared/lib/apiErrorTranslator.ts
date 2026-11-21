/**
 * 非组件模块(API 客户端等)的接口错误文案翻译器。
 *
 * 为什么需要它:
 * 这些模块里用不了 react-i18next 的 hook,也不能在模块顶层 `import i18n from '../i18n'`
 * —— 那会把 i18n 的初始化时机提前到模块求值时,进而影响 key 解析顺序(测试里表现为
 * 拿到 locale 值而不是组件兜底)。所以改成注册式:i18n 初始化完成后把 `i18n.t` 注册进来,
 * API 模块通过 `tApiError` 使用;没有注册时(例如单测)直接返回中文兜底。
 *
 * 放在 shared/lib 而不是某个 feature 下,是为了保持依赖方向:
 * i18n 可以依赖 shared/lib,shared/lib 不应该依赖任何 feature。
 */
export type ApiTranslator = (key: string, options?: { defaultValue?: string }) => string;

let apiTranslator: ApiTranslator | null = null;

export function registerApiTranslator(translator: ApiTranslator | null) {
  apiTranslator = translator;
}

export function tApiError(key: string, fallback: string) {
  if (!apiTranslator) return fallback;
  const translated = apiTranslator(key, { defaultValue: fallback });
  return translated || fallback;
}
