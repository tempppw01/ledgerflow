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

interface EastmoneyQuoteListPayload {
  data?: {
    diff?: Array<{
      f12?: string;
      f14?: string;
    }>;
  };
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

function parseHoldingsPageContent(raw: string): string {
  const contentMatch = raw.match(/content:"([\s\S]*?)",arryear:/);
  if (!contentMatch?.[1]) {
    return '';
  }

  try {
    return JSON.parse(`"${contentMatch[1]}"`) as string;
  } catch {
    return '';
  }
}

async function fetchRealtimeSnapshot(code: string): Promise<EastmoneyRealtimePayload | null> {
  const response = await fetch(`/api/market/fund-realtime?code=${encodeURIComponent(code)}`);
  if (!response.ok) {
    throw new Error('东方财富实时基金数据加载失败，请稍后重试。');
  }
  const body = (await response.json()) as { data?: EastmoneyRealtimePayload };
  return body.data || null;
}

async function loadFundDetailGlobals(code: string) {
  await appendScript(`https://fund.eastmoney.com/pingzhongdata/${code}.js?v=${Date.now()}`);
}

async function fetchHoldingsDetailPage(code: string): Promise<string> {
  const response = await fetch(
    `https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jjcc&code=${code}&topline=20&year=&month=`
  );

  if (!response.ok) {
    throw new Error('东方财富持仓明细加载失败，请稍后重试。');
  }

  const raw = await response.text();
  return parseHoldingsPageContent(raw);
}

function normalizeStockSecId(secId: string): string {
  return String(secId || '').trim();
}

async function fetchStockNameMap(secIds: string[]): Promise<Map<string, string>> {
  const normalizedSecIds = secIds.map(normalizeStockSecId).filter(Boolean);
  if (normalizedSecIds.length === 0) {
    return new Map();
  }

  try {
    const response = await fetch(
      `https://push2.eastmoney.com/api/qt/ulist.np/get?secids=${encodeURIComponent(
        normalizedSecIds.join(',')
      )}&fields=f12,f14`
    );

    if (!response.ok) {
      return new Map();
    }

    const payload = (await response.json()) as EastmoneyQuoteListPayload;
    const map = new Map<string, string>();

    for (const item of payload.data?.diff || []) {
      const code = String(item.f12 || '').trim();
      const name = String(item.f14 || '').trim();
      if (code && name) {
        map.set(code, name);
      }
    }

    return map;
  } catch {
    return new Map();
  }
}

export async function fetchEastmoneyFundSnapshot(inputCode: string): Promise<EastmoneyFundSnapshot> {
  const code = normalizeFundCode(inputCode);
  const realtime = await fetchRealtimeSnapshot(code);
  await loadFundDetailGlobals(code).catch(() => undefined);
  const holdingsPage = await fetchHoldingsDetailPage(code).catch(() => '');

  const name = realtime?.name || readWindowString('fS_name');
  const detailCode = readWindowString('fS_code');
  const buyFeeRate = readWindowString('fund_Rate');
  const sourceFeeRate = readWindowString('fund_sourceRate');
  const stockCodesNew = getWindowValueAs<string[]>('stockCodesNew') || [];
  const stockNameMap = await fetchStockNameMap(stockCodesNew);
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

  const holdingItems = stockCodesNew
    .map((secId) => {
      const normalizedSecId = normalizeStockSecId(secId);
      const code = normalizedSecId.split('.').pop()?.trim() || normalizedSecId;
      const name = stockNameMap.get(code);
      if (name) {
        return `${name}（${code}）`;
      }
      return code;
    })
    .filter(Boolean)
    .slice(0, 6);

  if (holdingsPage) {
    const doc = new DOMParser().parseFromString(holdingsPage, 'text/html');
    const latestHoldingTable = doc.querySelector('.boxitem.w790');
    const rows = Array.from(latestHoldingTable?.querySelectorAll('tbody tr') || []);
    const parsedHoldings = rows
      .map((row) => {
        const cells = Array.from(row.querySelectorAll('td'));
        const codeText = String(cells[1]?.textContent || '').trim();
        const nameText = String(cells[2]?.textContent || '').trim();
        const pctText = String(cells[4]?.textContent || '').trim();
        if (!nameText) return '';
        return codeText && pctText ? `${nameText}（${codeText}） ${pctText}` : `${nameText} ${pctText}`;
      })
      .filter(Boolean)
      .slice(0, 8);

    if (parsedHoldings.length > 0) {
      holdingItems.splice(0, holdingItems.length, ...parsedHoldings);
    }
  }

  const assetAllocationData = getWindowValueAs<{
    series?: Array<{ name?: string; data?: number[] }>;
    categories?: string[];
  }>('Data_assetAllocation');
  const latestAssetIndex = Math.max((assetAllocationData?.categories?.length || 1) - 1, 0);
  const allocationItems = (assetAllocationData?.series ?? [])
    .filter((item) => String(item.name || '').includes('占净比'))
    .map((item) => {
      const name = String(item.name || '').trim();
      const value = item.data?.[latestAssetIndex];
      return typeof value === 'number' ? `${name} ${value.toFixed(2)}%` : '';
    })
    .filter(Boolean)
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
