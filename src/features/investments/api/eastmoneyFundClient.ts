export interface EastmoneyFundSnapshot {
  code: string;
  name: string;
  netValue?: string;
  netValueDate?: string;
  estimatedValue?: string;
  estimatedChangePercent?: string;
  estimatedAt?: string;
  buyFeeRate?: string;
  sourceFeeRate?: string;
  performanceHistory: string[];
  fundAnalysis: string[];
  fundHoldings: string[];
  assetAllocation: string[];
}

interface EastmoneyRealtimePayload {
  fundcode?: string;
  name?: string;
  jzrq?: string;
  dwjz?: string;
  gsz?: string;
  gszzl?: string;
  gztime?: string;
}

const EASTMONEY_SCRIPT_TIMEOUT_MS = 12000;

function normalizeFundCode(input: string): string {
  const code = String(input || '').replace(/\D/g, '').slice(0, 6);
  if (!/^\d{6}$/.test(code)) {
    throw new Error('请输入 6 位基金代码。');
  }
  return code;
}

function appendScript(src: string, timeoutMs = EASTMONEY_SCRIPT_TIMEOUT_MS): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const timer = window.setTimeout(() => {
      script.remove();
      reject(new Error('东方财富接口响应超时，请稍后重试。'));
    }, timeoutMs);

    script.src = src;
    script.async = true;
    script.onload = () => {
      window.clearTimeout(timer);
      script.remove();
      resolve();
    };
    script.onerror = () => {
      window.clearTimeout(timer);
      script.remove();
      reject(new Error('东方财富接口加载失败，请检查基金代码或网络。'));
    };

    document.head.appendChild(script);
  });
}

function readWindowString(key: string): string {
  const value = (window as unknown as Record<string, unknown>)[key];
  return typeof value === 'string' ? value.trim() : '';
}

function formatPercent(value: string, label: string): string {
  const clean = value.trim();
  return clean ? `${label} ${clean}%` : '';
}

async function fetchRealtimeSnapshot(code: string): Promise<EastmoneyRealtimePayload | null> {
  const previousCallback = (window as unknown as { jsonpgz?: unknown }).jsonpgz;
  let payload: EastmoneyRealtimePayload | null = null;

  (window as unknown as { jsonpgz: (data: EastmoneyRealtimePayload) => void }).jsonpgz = (data) => {
    payload = data;
  };

  try {
    await appendScript(`https://fundgz.1234567.com.cn/js/${code}.js?rt=${Date.now()}`);
  } finally {
    if (previousCallback) {
      (window as unknown as { jsonpgz?: unknown }).jsonpgz = previousCallback;
    } else {
      delete (window as unknown as { jsonpgz?: unknown }).jsonpgz;
    }
  }

  return payload;
}

async function loadFundDetailGlobals(code: string) {
  await appendScript(`https://fund.eastmoney.com/pingzhongdata/${code}.js?v=${Date.now()}`);
}

export async function fetchEastmoneyFundSnapshot(inputCode: string): Promise<EastmoneyFundSnapshot> {
  const code = normalizeFundCode(inputCode);
  const realtime = await fetchRealtimeSnapshot(code);
  await loadFundDetailGlobals(code).catch(() => undefined);

  const name = realtime?.name || readWindowString('fS_name');
  const detailCode = readWindowString('fS_code');
  const buyFeeRate = readWindowString('fund_Rate');
  const sourceFeeRate = readWindowString('fund_sourceRate');
  const performanceHistory = [
    formatPercent(readWindowString('syl_1y'), '近 1 月'),
    formatPercent(readWindowString('syl_3y'), '近 3 月'),
    formatPercent(readWindowString('syl_6y'), '近 6 月'),
    formatPercent(readWindowString('syl_1n'), '近 1 年')
  ].filter(Boolean);

  function getWindowValueAs<T>(key: string) {
    const value = (window as unknown as Record<string, unknown>)[key];
    return value as T | undefined;
  }

  const fundHoldings: Array<{ name: string; ratio: string }> =
    getWindowValueAs<Array<{ '0': string; '1': string; '2': string; '3'?: string; '4'?: string }>>('Data_fundSharesPositions')?.map(
      (item) => ({
        name: String(item['0'] || ''),
        ratio: String(item['1'] || '')
      })
    ) ?? [];

  const holdingItems = fundHoldings
    .filter((item) => item.name)
    .filter((item) => item.ratio).map((item) => `${item.name} ${item.ratio}`).slice(0, 6);

  const allocationData = getWindowValueAs<Array<{ '0': string; '2': string }>>('Data_assetAllocationWeight');
  const allocationItems = (allocationData ?? [])
    .filter((item) => item['0'] && item['2'])
    .map((item) => {
      const name = String(item['0']).trim();
      const pct = String(item['2']).trim();
      return `${name} ${pct}`;
    })
    .slice(0, 4);
  if (!name && !realtime?.fundcode && !detailCode) {
    throw new Error('没有查到这只基金，请确认代码是否正确。');
  }

  const netValue = String(realtime?.dwjz || '').trim();
  const estimatedValue = String(realtime?.gsz || '').trim();
  const estimatedChangePercent = String(realtime?.gszzl || '').trim();
  const netValueDate = String(realtime?.jzrq || '').trim();
  const estimatedAt = String(realtime?.gztime || '').trim();

  return {
    code: realtime?.fundcode || detailCode || code,
    name: name || `基金 ${code}`,
    netValue,
    netValueDate,
    estimatedValue,
    estimatedChangePercent,
    estimatedAt,
    buyFeeRate: buyFeeRate ? `${buyFeeRate}%` : undefined,
    sourceFeeRate: sourceFeeRate ? `${sourceFeeRate}%` : undefined,
    performanceHistory,
    fundAnalysis: [
      netValue && netValueDate ? `单位净值 ${netValue}（${netValueDate}）` : '',
      estimatedValue && estimatedAt ? `估算净值 ${estimatedValue}（${estimatedAt}）` : '',
      estimatedChangePercent ? `估算涨跌幅 ${estimatedChangePercent}%` : '',
      buyFeeRate ? `当前申购费率 ${buyFeeRate}%` : ''
    ].filter(Boolean),
    fundHoldings: holdingItems,
    assetAllocation: allocationItems
  };
}
