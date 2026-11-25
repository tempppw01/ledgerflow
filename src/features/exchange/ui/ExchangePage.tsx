import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent
} from 'react';
import { GLOBE_ICON_URL } from '../../../shared/config/brandAssets';
import { useTFallback } from '../../../shared/lib/useTFallback';
import { useExchangeRates } from '../hooks/useExchangeRates';
import {
  getCurrencyFlag,
  getCurrencyName,
  getCurrencyNameKey,
  CURRENCY_NAMES
} from '../model/types';
import { ExchangeConverter } from './ExchangeConverter';
import { ExchangeRateTable } from './ExchangeRateTable';

const BASE_OPTIONS = ['CNY', 'USD', 'EUR', 'GBP', 'JPY', 'HKD', 'SGD', 'AUD', 'CAD', 'CHF'];

const MIN_LEFT_WIDTH = 320;
const MIN_RIGHT_WIDTH = 420;
const DEFAULT_LEFT_WIDTH = 420;

/** 键盘一次调多少;按住 Shift 用粗档(与侧栏、表格列宽保持同一组步长)。 */
const DIVIDER_KEYBOARD_STEP = 16;
const DIVIDER_KEYBOARD_COARSE_STEP = 48;

export function ExchangePage() {
  const tf = useTFallback();
  const { rates, base, date, loading, error, fromCache, setBase, refresh } =
    useExchangeRates('CNY');
  const layoutRef = useRef<HTMLDivElement | null>(null);
  const [leftWidth, setLeftWidth] = useState(DEFAULT_LEFT_WIDTH);
  /*
   * 容器实际宽度。拖拽时它在 mousemove 里现算,而键盘/aria-valuemax 需要一个
   * 渲染期就能读到的值 —— 所以量出来存一份,和上面那个 clamp 用同一次测量。
   */
  const [layoutWidth, setLayoutWidth] = useState(0);

  const allCodes = Object.keys(CURRENCY_NAMES).sort();

  /** 左栏能到的最大宽度。拖拽、键盘、aria-valuemax 三处共用,避免报出拖不到的读数。 */
  const maxLeftWidth = Math.max(MIN_LEFT_WIDTH, layoutWidth - MIN_RIGHT_WIDTH);

  useEffect(() => {
    const clampByContainer = () => {
      const node = layoutRef.current;
      if (!node) {
        return;
      }

      const total = node.getBoundingClientRect().width;
      setLayoutWidth(total);
      const maxLeft = Math.max(MIN_LEFT_WIDTH, total - MIN_RIGHT_WIDTH);
      setLeftWidth((prev) => Math.min(Math.max(prev, MIN_LEFT_WIDTH), maxLeft));
    };

    clampByContainer();
    window.addEventListener('resize', clampByContainer);

    return () => {
      window.removeEventListener('resize', clampByContainer);
    };
  }, []);

  /*
   * WCAG 2.1.1(键盘可达):分隔条原来只有 onMouseDown —— 它连 Tab 都到不了
   * (没有 tabIndex),键盘用户完全改不了两栏宽度。补 Window Splitter 的键盘入口。
   */
  const handleDividerKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? DIVIDER_KEYBOARD_COARSE_STEP : DIVIDER_KEYBOARD_STEP;
    let next: number | null = null;
    if (event.key === 'ArrowLeft') next = leftWidth - step;
    else if (event.key === 'ArrowRight') next = leftWidth + step;
    else if (event.key === 'Home') next = MIN_LEFT_WIDTH;
    else if (event.key === 'End') next = maxLeftWidth;
    if (next === null) return;
    event.preventDefault();
    setLeftWidth(Math.min(maxLeftWidth, Math.max(MIN_LEFT_WIDTH, next)));
  };

  const handleDividerMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const container = layoutRef.current;
    if (!container) {
      return;
    }

    const rect = container.getBoundingClientRect();
    const maxLeft = Math.max(MIN_LEFT_WIDTH, rect.width - MIN_RIGHT_WIDTH);

    const onMouseMove = (moveEvent: MouseEvent) => {
      const nextWidth = Math.min(Math.max(moveEvent.clientX - rect.left, MIN_LEFT_WIDTH), maxLeft);
      setLeftWidth(nextWidth);
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      document.body.classList.remove('exchange-resizing');
    };

    document.body.classList.add('exchange-resizing');
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  return (
    <div
      className="exchange-layout"
      ref={layoutRef}
      style={{ '--exchange-left-width': `${leftWidth}px` } as CSSProperties}
    >
      <section className="panel exchange-priority-converter">
        <div className="exchange-header exchange-card-header">
          <h2 className="exchange-title" style={{ margin: 0 }}>
            <img className="exchange-title-icon" src={GLOBE_ICON_URL} alt="" aria-hidden="true" />
            {tf('exchange.title', '汇率换算器')}
          </h2>
          <div className="exchange-base-picker">
            <label htmlFor="exchange-base-code">
              {tf('exchange.baseCurrency', '基准货币\uFF1A')}
            </label>
            <select
              id="exchange-base-code"
              aria-label={tf('exchange.baseCurrencyAria', '基准货币')}
              value={base}
              onChange={(e) => setBase(e.target.value)}
            >
              <optgroup label={tf('exchange.currencyGroup.common', '常用')}>
                {BASE_OPTIONS.map((code) => (
                  <option key={code} value={code}>
                    {getCurrencyFlag(code)} {code} -{' '}
                    {tf(getCurrencyNameKey(code), getCurrencyName(code))}
                  </option>
                ))}
              </optgroup>
              <optgroup label={tf('exchange.currencyGroup.all', '全部')}>
                {allCodes
                  .filter((code) => !BASE_OPTIONS.includes(code))
                  .map((code) => (
                    <option key={code} value={code}>
                      {getCurrencyFlag(code)} {code} -{' '}
                      {tf(getCurrencyNameKey(code), getCurrencyName(code))}
                    </option>
                  ))}
              </optgroup>
            </select>
          </div>
        </div>

        <ExchangeConverter rates={rates} base={base} />
      </section>

      <div
        className="exchange-resize-divider"
        role="separator"
        tabIndex={0}
        aria-label={tf('exchange.resizeAria', '调整汇率换算器与汇率数据宽度')}
        aria-orientation="vertical"
        aria-valuenow={Math.round(leftWidth)}
        aria-valuemin={MIN_LEFT_WIDTH}
        aria-valuemax={maxLeftWidth}
        onMouseDown={handleDividerMouseDown}
        onKeyDown={handleDividerKeyDown}
      />

      <section className="panel exchange-data-card">
        <div className="exchange-data-header exchange-card-header">
          <h2 className="exchange-title" style={{ margin: 0 }}>
            <img className="exchange-title-icon" src={GLOBE_ICON_URL} alt="" aria-hidden="true" />
            {tf('exchange.dataTitle', '汇率数据')}
          </h2>
        </div>
        <ExchangeRateTable
          rates={rates}
          base={base}
          date={date}
          fromCache={fromCache}
          loading={loading}
          error={error}
          onRefresh={refresh}
        />
      </section>
    </div>
  );
}
