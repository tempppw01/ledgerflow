import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

export type TfFallback = (key: string, fallback: string) => string;

/**
 * 与 DashboardPage 里同一个套路:key 存在就用翻译,不存在就用中文兜底。
 * 这样单测环境(没有初始化 i18n)仍然拿到中文,老断言不会因为改造而失败,
 * 同时界面切到英文时又能正常翻译。
 */
export function useTFallback() {
  const { t } = useTranslation();
  return useCallback(
    (key: string, fallback: string) => {
      const translated = t(key);
      return translated === key ? fallback : translated;
    },
    [t]
  );
}
