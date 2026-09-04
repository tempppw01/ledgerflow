import { useEffect, useRef, useState } from 'react';
import {
  TransactionDatePreset,
  TransactionFilterState,
  TransactionSourceFilter,
  TransactionTypeFilter
} from '../hooks/useTransactionFilters';
import { TransactionColumnKey } from './TransactionTable';
import { BillImportMode } from '../../../shared/lib/billImport';
import {
  ARCHIVE_ICON_URL,
  CALENDAR_ICON_URL,
  DASHBOARD_ICON_URL,
  EYE_ICON_URL,
  EYE_OFF_ICON_URL,
  SETTINGS_ICON_URL
} from '../../../shared/config/brandAssets';
import { DatePicker } from '../../../shared/ui/DatePicker';

interface TransactionFiltersProps {
  filters: TransactionFilterState;
  onKeywordChange: (value: string) => void;
  onTypeChange: (value: TransactionTypeFilter) => void;
  onSourceChange: (value: TransactionSourceFilter) => void;
  onDatePresetChange: (value: TransactionDatePreset) => void;
  onDateFromChange: (value: string) => void;
  onDateToChange: (value: string) => void;
  onClear: () => void;
  onExport: () => void;
  onImportWechat: () => void;
  onImportAlipay: () => void;
  importMode: BillImportMode;
  onImportModeChange: (mode: BillImportMode) => void;
  onCheckDuplicates: () => void;
  columnOptions: Array<{ key: TransactionColumnKey; label: string }>;
  visibleColumns: Record<TransactionColumnKey, boolean>;
  onToggleColumn: (key: TransactionColumnKey) => void;
  bulkSelectionEnabled: boolean;
  onToggleBulkSelection: () => void;
  minAvailableDate?: string;
  maxAvailableDate?: string;
  onQuickAdd: () => void;
  privacyMode: boolean;
  onTogglePrivacy: () => void;
  sidePanelVisible: boolean;
  onToggleSidePanel: () => void;
}

export function TransactionFilters({
  filters,
  onKeywordChange,
  onTypeChange,
  onSourceChange,
  onDatePresetChange,
  onDateFromChange,
  onDateToChange,
  onClear,
  onExport,
  onImportWechat,
  onImportAlipay,
  importMode,
  onImportModeChange,
  onCheckDuplicates,
  columnOptions,
  visibleColumns,
  onToggleColumn,
  bulkSelectionEnabled,
  onToggleBulkSelection,
  minAvailableDate,
  maxAvailableDate,
  onQuickAdd,
  privacyMode,
  onTogglePrivacy,
  sidePanelVisible,
  onToggleSidePanel
}: TransactionFiltersProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const hiddenColumnCount = columnOptions.reduce(
    (count, option) => count + (visibleColumns[option.key] ? 0 : 1),
    0
  );
  const advancedChangeCount =
    (filters.source !== 'all' ? 1 : 0) +
    (hiddenColumnCount > 0 ? 1 : 0) +
    (importMode !== 'incremental' ? 1 : 0);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      if (!menuRef.current) {
        return;
      }
      const target = event.target;
      if (target instanceof Node && !menuRef.current.contains(target)) {
        setMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown, { passive: true });
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  return (
    <section className="panel transaction-filters-panel">
      <div className="transaction-filters-header">
        <div>
          <h2>交易记录</h2>
          <p className="surface-caption transaction-filters-caption">
            把首屏注意力放在流水本身，筛选与操作保持就近、克制、可展开。
          </p>
        </div>
      </div>

      <div className="transaction-filters-primary-row">
        <div
          className="field transaction-filter-field transaction-filter-field-keyword"
          style={{ marginBottom: 0 }}
        >
          <label>关键词</label>
          <input
            placeholder="搜索备注或标签"
            value={filters.keyword}
            onChange={(event) => onKeywordChange(event.target.value)}
          />
        </div>

        <div className="field transaction-filter-field" style={{ marginBottom: 0 }}>
          <label htmlFor="tx-filter-type">类型</label>
          <select
            id="tx-filter-type"
            aria-label="按交易类型筛选"
            value={filters.type}
            onChange={(event) => onTypeChange(event.target.value as TransactionTypeFilter)}
          >
            <option value="all">全部</option>
            <option value="income">收入</option>
            <option value="expense">支出</option>
            <option value="budget">预算</option>
            <option value="repayment">还款</option>
          </select>
        </div>

        <div className="field transaction-filter-field" style={{ marginBottom: 0 }}>
          <label htmlFor="tx-filter-date-preset">日期</label>
          <select
            id="tx-filter-date-preset"
            aria-label="按日期范围筛选"
            value={filters.datePreset}
            onChange={(event) => onDatePresetChange(event.target.value as TransactionDatePreset)}
          >
            <option value="all">全部时间</option>
            <option value="thisMonth">本月</option>
            <option value="last3Months">最近三个月</option>
            <option value="last30">最近 30 天</option>
            <option value="custom">自定义</option>
          </select>
        </div>

        <div className="transaction-filters-primary-cta">
          <label className="transaction-filters-mobile-only-label">操作</label>
          <button type="button" className="primary" onClick={onQuickAdd}>
            记一笔
          </button>
        </div>
      </div>

      {filters.datePreset === 'custom' ? (
        <div className="transaction-filters-custom-date-row">
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="tx-filter-date-from">筛选开始日期</label>
            <DatePicker
              id="tx-filter-date-from"
              ariaLabel="筛选开始日期"
              min={minAvailableDate}
              max={maxAvailableDate}
              value={filters.dateFrom}
              onChange={onDateFromChange}
            />
            <button
              type="button"
              className="transaction-date-shortcut-btn"
              onClick={() => {
                const today = new Date();
                const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
                  .toISOString()
                  .slice(0, 10);
                onDateFromChange(monthStart);
              }}
            >
              <img
                className="transaction-date-shortcut-icon"
                src={CALENDAR_ICON_URL}
                alt=""
                aria-hidden="true"
              />
              设为月初
            </button>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="tx-filter-date-to">筛选结束日期</label>
            <DatePicker
              id="tx-filter-date-to"
              ariaLabel="筛选结束日期"
              min={minAvailableDate}
              max={maxAvailableDate}
              value={filters.dateTo}
              onChange={onDateToChange}
            />
            <button
              type="button"
              className="transaction-date-shortcut-btn"
              onClick={() => {
                const today = new Date();
                const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0)
                  .toISOString()
                  .slice(0, 10);
                onDateToChange(monthEnd);
              }}
            >
              <img
                className="transaction-date-shortcut-icon"
                src={CALENDAR_ICON_URL}
                alt=""
                aria-hidden="true"
              />
              设为月末
            </button>
          </div>
        </div>
      ) : null}

      <div className="transaction-filters-secondary-row">
        <button
          type="button"
          className={`transaction-filter-trigger ${sidePanelVisible ? 'active' : ''}`}
          onClick={onToggleSidePanel}
        >
          <img
            className="transaction-filter-trigger-icon"
            src={DASHBOARD_ICON_URL}
            alt=""
            aria-hidden="true"
          />
          {sidePanelVisible ? '收起洞察' : '查看洞察'}
        </button>

        <div className="transaction-filters-quick-tools" role="group" aria-label="快捷开关">
          <button
            type="button"
            className={`transaction-filter-trigger transaction-filter-trigger-compact ${bulkSelectionEnabled ? 'active' : ''}`}
            onClick={onToggleBulkSelection}
          >
            <img
              className="transaction-filter-trigger-icon"
              src={ARCHIVE_ICON_URL}
              alt=""
              aria-hidden="true"
            />
            {bulkSelectionEnabled ? '批量已开' : '批量操作'}
          </button>
          <button
            type="button"
            className={`transaction-filter-trigger transaction-filter-trigger-compact ${privacyMode ? 'active' : ''}`}
            onClick={onTogglePrivacy}
          >
            <img
              className="transaction-filter-trigger-icon"
              src={privacyMode ? EYE_OFF_ICON_URL : EYE_ICON_URL}
              alt=""
              aria-hidden="true"
            />
            {privacyMode ? '隐私已开' : '隐私模式'}
          </button>
        </div>

        <div ref={menuRef} className={`transaction-filter-popover ${menuOpen ? 'open' : ''}`}>
          <button
            type="button"
            className={`transaction-filter-trigger ${menuOpen || advancedChangeCount > 0 ? 'active' : ''}`}
            onClick={() => setMenuOpen((prev) => !prev)}
            aria-haspopup="true"
            aria-expanded={menuOpen}
          >
            <img
              className="transaction-filter-trigger-icon"
              src={SETTINGS_ICON_URL}
              alt=""
              aria-hidden="true"
            />
            筛选设置
            {advancedChangeCount > 0 ? (
              <span
                className="transaction-filter-trigger-badge"
                aria-label={`已调整 ${advancedChangeCount} 项`}
              >
                {advancedChangeCount}
              </span>
            ) : null}
          </button>

          {menuOpen ? (
            <div className="transaction-filter-popover-panel" role="group" aria-label="筛选与操作">
              <div className="transaction-filter-popover-head">
                <strong>筛选设置</strong>
                <span>来源、列显示、导入整理都在这里</span>
              </div>

              <p className="transaction-filter-section-title">来源筛选</p>
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="tx-filter-source">来源</label>
                <select
                  id="tx-filter-source"
                  aria-label="按来源筛选"
                  value={filters.source}
                  onChange={(event) =>
                    onSourceChange(event.target.value as TransactionSourceFilter)
                  }
                >
                  <option value="all">全部来源</option>
                  <option value="manual">手工录入</option>
                  <option value="wechat">微信导入</option>
                  <option value="alipay">支付宝</option>
                  <option value="ai">AI 记账</option>
                </select>
              </div>
              <div className="row" style={{ marginTop: 8, justifyContent: 'flex-end' }}>
                <button type="button" onClick={onClear}>
                  清空筛选
                </button>
              </div>

              <div className="transaction-context-divider" />
              <details className="transaction-popover-section" open>
                <summary className="transaction-filter-section-title">
                  显示列
                  {hiddenColumnCount > 0 ? (
                    <span className="transaction-filter-inline-note">
                      已隐藏 {hiddenColumnCount} 项
                    </span>
                  ) : null}
                </summary>
                <div className="transaction-column-check-grid">
                  {columnOptions.map((option) => (
                    <label key={`filter-col-${option.key}`}>
                      <input
                        type="checkbox"
                        checked={visibleColumns[option.key]}
                        onChange={() => onToggleColumn(option.key)}
                      />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </div>
              </details>

              <div className="transaction-context-divider" />
              <div className="transaction-popover-section">
                <p className="transaction-filter-section-title">导入与整理</p>
                <p className="surface-caption transaction-import-steps-caption">
                  导入模式会影响重复流水的处理方式。
                </p>
                <div className="field" style={{ marginBottom: 8 }}>
                  <label htmlFor="tx-import-mode">账单导入模式</label>
                  <select
                    id="tx-import-mode"
                    aria-label="账单导入模式"
                    value={importMode}
                    onChange={(event) => onImportModeChange(event.target.value as BillImportMode)}
                  >
                    <option value="incremental">增量（跳过重复）</option>
                    <option value="merge">合并（覆盖重复）</option>
                    <option value="overwrite">覆盖（清空后导入）</option>
                  </select>
                </div>
                <div className="transaction-filter-actions-grid transaction-filter-actions-grid-inline transaction-filter-actions-grid-compact">
                  <button type="button" onClick={onExport}>
                    导出 CSV
                  </button>
                  <button type="button" onClick={onCheckDuplicates}>
                    检测重复
                  </button>
                  <button type="button" onClick={onImportWechat}>
                    导入微信
                  </button>
                  <button type="button" onClick={onImportAlipay}>
                    导入支付宝
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
