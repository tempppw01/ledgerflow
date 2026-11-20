import i18n from '../../../i18n';
import { ENV } from '../../../shared/config/env';
import type { ExchangeApiResponse } from '../model/types';

/**
 * 从公共 API 获取最新汇率
 * 默认使用 frankfurter.dev/v1（frankfurter.app 已跳转到该新地址）
 * 可通过 VITE_EXCHANGE_API_BASE 覆盖
 */
export async function fetchLatestRates(base: string): Promise<ExchangeApiResponse> {
  const apiBase = ENV.exchangeApiBase || 'https://api.frankfurter.dev/v1';
  const timeout = ENV.exchangeApiTimeoutMs || 10000;

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeout);

  try {
    const url = `${apiBase}/latest?base=${encodeURIComponent(base)}`;
    const response = await fetch(url, { signal: controller.signal });

    if (!response.ok) {
      // 这里没法用 hook,直接走 i18n 单例。key 缺失时 defaultValue 兜底成中文,
      // 所以单测等未合并 locale 的环境行为不变。
      const prefix = i18n.t('exchange.error.apiRequest', {
        defaultValue: '汇率 API 请求失败'
      });
      throw new Error(`${prefix}: ${response.status} ${response.statusText}`);
    }

    const data: ExchangeApiResponse = await response.json();
    return data;
  } finally {
    window.clearTimeout(timer);
  }
}
