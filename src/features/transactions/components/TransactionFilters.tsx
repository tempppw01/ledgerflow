import { useEffect, useMemo, useRef, useState } from 'react';
import { useDialogFocus } from '../../../shared/lib/useDialogFocus';
import { createPortal } from 'react-dom';
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
import { useTFallback } from '../../../shared/lib/useTFallback';

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
  /** 当前真实列序 —— 列序原来只能拖表头,WCAG 2.5.7 要求有非拖拽入口。 */
  columnOrder: TransactionColumnKey[];
  visibleColumns: Record<TransactionColumnKey, boolean>;
  onToggleColumn: (key: TransactionColumnKey) => void;
  onColumnReorder: (fromKey: TransactionColumnKey, toKey: TransactionColumnKey) => void;
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
  columnOrder,
  visibleColumns,
  onToggleColumn,
  onColumnReorder,
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
  const tf = useTFallback();
  /*
   * 按真实列序排一遍。columnOrder 里如果缺某个 key(比如以后新增了列),
   * 也要把它补在后面显示出来,否则用户在设置里根本看不到这一列。
   */
  const orderedColumnOptions = useMemo(() => {
    const byKey = new Map(columnOptions.map((option) => [option.key, option]));
    const ordered = columnOrder
      .map((key) => byKey.get(key))
      .filter((option): option is { key: TransactionColumnKey; label: string } => Boolean(option));
    columnOptions.forEach((option) => {
      if (!columnOrder.includes(option.key)) {
        ordered.push(option);
      }
    });
    return ordered;
  }, [columnOptions, columnOrder]);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const filterDialogRef = useRef<HTMLDivElement | null>(null);
  // 筛选面板是 aria-modal 的弹层:焦点收进来、Tab 留在里面、关闭后还给「筛选设置」按钮。
  useDialogFocus(menuOpen, filterDialogRef, () => setMenuOpen(false));
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

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      if (!menuRef.current) {
        return;
      }
      const target = event.target;
      if (
        target instanceof Node &&
        !menuRef.current.contains(target) &&
        !document.querySelector('.transaction-filter-dialog-backdrop')?.contains(target)
      ) {
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
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  return (
    <section className="panel transaction-filters-panel">
      <div className="transaction-filters-header">
        <div>
          <h2>{tf('transactions.filters.title', '交易记录')}</h2>
        </div>
      </div>

      <div className="transaction-filters-primary-row">
        <div
          className="field transaction-filter-field transaction-filter-field-keyword"
          style={{ marginBottom: 0 }}
        >
          <label htmlFor="tx-filter-keyword">{tf('transactions.filters.keyword', '关键词')}</label>
          <input
            id="tx-filter-keyword"
            placeholder={tf(
              'transactions.filters.keywordPlaceholder',
              tf('transactions.filters.keywordPlaceholder', '搜索备注或标签')
            )}
            value={filters.keyword}
            onChange={(event) => onKeywordChange(event.target.value)}
          />
        </div>

        <div className="field transaction-filter-field" style={{ marginBottom: 0 }}>
          <label htmlFor="tx-filter-type">{tf('transactions.filters.type', '类型')}</label>
          <select
            id="tx-filter-type"
            aria-label={tf(
              'transactions.filters.typeAria',
              tf('transactions.filters.typeAria', '按交易类型筛选')
            )}
            value={filters.type}
            onChange={(event) => onTypeChange(event.target.value as TransactionTypeFilter)}
          >
            <option value="all">{tf('transactions.filters.optionAll', '全部')}</option>
            <option value="income">{tf('transactions.filters.optionIncome', '收入')}</option>
            <option value="expense">{tf('transactions.filters.optionExpense', '支出')}</option>
            <option value="budget">{tf('transactions.filters.optionBudget', '预算')}</option>
            <option value="repayment">{tf('transactions.filters.optionRepayment', '还款')}</option>
          </select>
        </div>

        <div className="field transaction-filter-field" style={{ marginBottom: 0 }}>
          <label htmlFor="tx-filter-date-preset">{tf('transactions.filters.date', '日期')}</label>
          <select
            id="tx-filter-date-preset"
            aria-label={tf(
              'transactions.filters.dateAria',
              tf('transactions.filters.dateAria', '按日期范围筛选')
            )}
            value={filters.datePreset}
            onChange={(event) => onDatePresetChange(event.target.value as TransactionDatePreset)}
          >
            <option value="all">{tf('transactions.filters.dateAll', '全部时间')}</option>
            <option value="thisMonth">{tf('transactions.filters.dateThisMonth', '本月')}</option>
            <option value="last3Months">
              {tf('transactions.filters.dateLast3Months', '最近三个月')}
            </option>
            <option value="last30">
              {tf('transactions.filters.dateLast30Days', '最近 30 天')}
            </option>
            <option value="custom">{tf('transactions.filters.dateCustom', '自定义')}</option>
          </select>
        </div>

        <div className="transaction-filters-primary-cta">
          <label className="transaction-filters-mobile-only-label">
            {tf('transactions.filters.actions', '操作')}
          </label>
          <button type="button" className="primary" onClick={onQuickAdd}>
            {tf('transactions.filters.quickAdd', '记一笔')}
          </button>
        </div>
      </div>

      {filters.datePreset === 'custom' ? (
        <div className="transaction-filters-custom-date-row">
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="tx-filter-date-from">
              {tf('transactions.filters.dateFrom', '筛选开始日期')}
            </label>
            <DatePicker
              id="tx-filter-date-from"
              ariaLabel={tf(
                'transactions.filters.dateFrom',
                tf('transactions.filters.dateFrom', '筛选开始日期')
              )}
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
              {tf('transactions.filters.setMonthStart', '设为月初')}
            </button>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="tx-filter-date-to">
              {tf('transactions.filters.dateTo', '筛选结束日期')}
            </label>
            <DatePicker
              id="tx-filter-date-to"
              ariaLabel={tf(
                'transactions.filters.dateTo',
                tf('transactions.filters.dateTo', '筛选结束日期')
              )}
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
              {tf('transactions.filters.setMonthEnd', '设为月末')}
            </button>
          </div>
        </div>
      ) : null}

      <div className="transaction-filters-secondary-row">
        <button
          type="button"
          className={`transaction-filter-trigger ${sidePanelVisible ? 'active' : ''}`}
          onClick={onToggleSidePanel}
          aria-label={
            sidePanelVisible
              ? tf('transactions.filters.hideInsights', '收起洞察')
              : tf('transactions.filters.viewInsights', '查看洞察')
          }
          title={
            sidePanelVisible
              ? tf('transactions.filters.hideInsights', '收起洞察')
              : tf('transactions.filters.viewInsights', '查看洞察')
          }
        >
          <img
            className="transaction-filter-trigger-icon"
            src={DASHBOARD_ICON_URL}
            alt=""
            aria-hidden="true"
          />
          <span className="transaction-filter-trigger-label">
            <span className="transaction-filter-trigger-label-full">
              {sidePanelVisible
                ? tf('transactions.filters.hideInsights', '收起洞察')
                : tf('transactions.filters.viewInsights', '查看洞察')}
            </span>
            <span className="transaction-filter-trigger-label-short" aria-hidden="true">
              {tf('transactions.filters.shortInsights', '洞察')}
            </span>
          </span>
        </button>

        <div
          className="transaction-filters-quick-tools"
          role="group"
          aria-label={tf(
            'transactions.filters.quickToggles',
            tf('transactions.filters.quickToggles', '快捷开关')
          )}
        >
          <button
            type="button"
            className={`transaction-filter-trigger transaction-filter-trigger-compact ${bulkSelectionEnabled ? 'active' : ''}`}
            onClick={onToggleBulkSelection}
            aria-label={
              bulkSelectionEnabled
                ? tf('transactions.filters.bulkOn', '批量已开')
                : tf('transactions.filters.bulk', '批量操作')
            }
            aria-pressed={bulkSelectionEnabled}
            title={
              bulkSelectionEnabled
                ? tf('transactions.filters.bulkOn', '批量已开')
                : tf('transactions.filters.bulk', '批量操作')
            }
          >
            <img
              className="transaction-filter-trigger-icon"
              src={ARCHIVE_ICON_URL}
              alt=""
              aria-hidden="true"
            />
            <span className="transaction-filter-trigger-label">
              <span className="transaction-filter-trigger-label-full">
                {bulkSelectionEnabled
                  ? tf('transactions.filters.bulkOn', '批量已开')
                  : tf('transactions.filters.bulk', '批量操作')}
              </span>
              <span className="transaction-filter-trigger-label-short" aria-hidden="true">
                {tf('transactions.filters.shortBulk', '批量')}
              </span>
            </span>
          </button>
          <button
            type="button"
            className={`transaction-filter-trigger transaction-filter-trigger-compact ${privacyMode ? 'active' : ''}`}
            onClick={onTogglePrivacy}
            aria-label={
              privacyMode
                ? tf('transactions.filters.privacyOn', '隐私已开')
                : tf('transactions.filters.privacy', '隐私模式')
            }
            aria-pressed={privacyMode}
            title={
              privacyMode
                ? tf('transactions.filters.privacyOn', '隐私已开')
                : tf('transactions.filters.privacy', '隐私模式')
            }
          >
            <img
              className="transaction-filter-trigger-icon"
              src={privacyMode ? EYE_OFF_ICON_URL : EYE_ICON_URL}
              alt=""
              aria-hidden="true"
            />
            <span className="transaction-filter-trigger-label">
              <span className="transaction-filter-trigger-label-full">
                {privacyMode
                  ? tf('transactions.filters.privacyOn', '隐私已开')
                  : tf('transactions.filters.privacy', '隐私模式')}
              </span>
              <span className="transaction-filter-trigger-label-short" aria-hidden="true">
                {tf('transactions.filters.shortPrivacy', '隐私')}
              </span>
            </span>
          </button>
        </div>

        <div ref={menuRef} className={`transaction-filter-popover ${menuOpen ? 'open' : ''}`}>
          <button
            type="button"
            className={`transaction-filter-trigger ${menuOpen || advancedChangeCount > 0 ? 'active' : ''}`}
            onClick={() => setMenuOpen((prev) => !prev)}
            aria-haspopup="true"
            aria-expanded={menuOpen}
            aria-label={tf(
              'transactions.filters.settings',
              tf('transactions.filters.settings', '筛选设置')
            )}
            title={tf(
              'transactions.filters.settings',
              tf('transactions.filters.settings', '筛选设置')
            )}
          >
            <img
              className="transaction-filter-trigger-icon"
              src={SETTINGS_ICON_URL}
              alt=""
              aria-hidden="true"
            />
            <span className="transaction-filter-trigger-label">
              <span className="transaction-filter-trigger-label-full">
                {tf('transactions.filters.settings', '筛选设置')}
              </span>
              <span className="transaction-filter-trigger-label-short" aria-hidden="true">
                {tf('transactions.filters.shortFilter', '筛选')}
              </span>
            </span>
            {advancedChangeCount > 0 ? (
              <span
                className="transaction-filter-trigger-badge"
                aria-label={tf('transactions.filters.adjusted', '已调整 {count} 项').replace(
                  '{count}',
                  String(advancedChangeCount)
                )}
              >
                {advancedChangeCount}
              </span>
            ) : null}
          </button>

          {menuOpen
            ? createPortal(
                <div
                  className="transaction-filter-dialog-backdrop"
                  onClick={() => setMenuOpen(false)}
                >
                  <div
                    ref={filterDialogRef}
                    className="transaction-filter-popover-panel"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="tx-filter-dialog-title"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <div className="transaction-filter-dialog-header">
                      <div className="transaction-filter-popover-head">
                        <span className="transaction-filter-dialog-eyebrow">
                          {tf('transactions.filters.dialogEyebrow', '交易记录 · 个性化')}
                        </span>
                        <strong id="tx-filter-dialog-title">
                          {tf('transactions.filters.dialogTitle', '筛选与显示设置')}
                        </strong>
                      </div>
                      <button
                        type="button"
                        className="transaction-filter-dialog-close"
                        aria-label={tf(
                          'transactions.filters.dialogClose',
                          tf('transactions.filters.dialogClose', '关闭筛选设置')
                        )}
                        onClick={() => setMenuOpen(false)}
                      >
                        ×
                      </button>
                    </div>

                    <div className="transaction-filter-dialog-grid">
                      <section className="transaction-filter-dialog-section">
                        <div className="transaction-filter-dialog-section-heading">
                          <span className="transaction-filter-dialog-index">01</span>
                          <div>
                            <h3>{tf('transactions.filters.sourceTitle', '来源筛选')}</h3>
                          </div>
                        </div>
                        <div className="field" style={{ marginBottom: 0 }}>
                          <label htmlFor="tx-filter-source">
                            {tf('transactions.filters.source', '交易来源')}
                          </label>
                          <select
                            id="tx-filter-source"
                            aria-label={tf(
                              'transactions.filters.sourceAria',
                              tf('transactions.filters.sourceAria', '按来源筛选')
                            )}
                            value={filters.source}
                            onChange={(event) =>
                              onSourceChange(event.target.value as TransactionSourceFilter)
                            }
                          >
                            <option value="all">
                              {tf('transactions.filters.sourceAll', '全部来源')}
                            </option>
                            <option value="manual">
                              {tf('transactions.filters.sourceManual', '手工录入')}
                            </option>
                            <option value="wechat">
                              {tf('transactions.filters.sourceWechat', '微信导入')}
                            </option>
                            <option value="alipay">
                              {tf('transactions.filters.sourceAlipay', '支付宝')}
                            </option>
                            <option value="ai">
                              {tf('transactions.filters.sourceAi', 'AI 记账')}
                            </option>
                          </select>
                        </div>
                      </section>

                      <section className="transaction-filter-dialog-section">
                        <div className="transaction-filter-dialog-section-heading">
                          <span className="transaction-filter-dialog-index">02</span>
                          <div>
                            <h3>{tf('transactions.filters.columnsTitle', '表格显示')}</h3>
                            <p>
                              {hiddenColumnCount > 0
                                ? tf(
                                    'transactions.filters.hiddenCount',
                                    '· 已收起 {count} 项'
                                  ).replace('{count}', String(hiddenColumnCount))
                                : ''}
                            </p>
                          </div>
                        </div>
                        <div className="transaction-column-check-grid">
                          {orderedColumnOptions.map((option, index) => (
                            <div key={`filter-col-${option.key}`} className="transaction-column-check-row">
                              <label>
                                <input
                                  type="checkbox"
                                  checked={visibleColumns[option.key]}
                                  onChange={() => onToggleColumn(option.key)}
                                />
                                <span>{option.label}</span>
                              </label>
                              {/*
                               * 列序原来只能拖表头(WCAG 2.5.7 拖拽移动,AA)。
                               * 这里给出不依赖拖拽的等价入口:上移/下移各一个按钮。
                               * 首尾各禁用一边,避免点出无变化的动作。
                               */}
                              <span className="transaction-column-order-actions">
                                <button
                                  type="button"
                                  className="transaction-column-order-btn"
                                  disabled={index === 0}
                                  aria-label={tf(
                                    'transactions.filters.moveColumnUp',
                                    '上移 {label}'
                                  ).replace('{label}', option.label)}
                                  title={tf('transactions.filters.moveColumnUp', '上移 {label}').replace(
                                    '{label}',
                                    option.label
                                  )}
                                  onClick={() =>
                                    onColumnReorder(option.key, orderedColumnOptions[index - 1].key)
                                  }
                                >
                                  ↑
                                </button>
                                <button
                                  type="button"
                                  className="transaction-column-order-btn"
                                  disabled={index === orderedColumnOptions.length - 1}
                                  aria-label={tf(
                                    'transactions.filters.moveColumnDown',
                                    '下移 {label}'
                                  ).replace('{label}', option.label)}
                                  title={tf(
                                    'transactions.filters.moveColumnDown',
                                    '下移 {label}'
                                  ).replace('{label}', option.label)}
                                  onClick={() =>
                                    onColumnReorder(option.key, orderedColumnOptions[index + 1].key)
                                  }
                                >
                                  ↓
                                </button>
                              </span>
                            </div>
                          ))}
                        </div>
                      </section>

                      <section className="transaction-filter-dialog-section transaction-filter-dialog-import">
                        <div className="transaction-filter-dialog-section-heading">
                          <span className="transaction-filter-dialog-index">03</span>
                          <div>
                            <h3>{tf('transactions.filters.importTitle', '导入与整理')}</h3>
                          </div>
                        </div>
                        <div className="transaction-filter-dialog-import-controls">
                          <div className="field" style={{ marginBottom: 0 }}>
                            <label htmlFor="tx-import-mode">
                              {tf('transactions.filters.importMode', '账单导入模式')}
                            </label>
                            <select
                              id="tx-import-mode"
                              aria-label={tf(
                                'transactions.filters.importMode',
                                tf('transactions.filters.importMode', '账单导入模式')
                              )}
                              value={importMode}
                              onChange={(event) =>
                                onImportModeChange(event.target.value as BillImportMode)
                              }
                            >
                              <option value="incremental">
                                {tf('transactions.filters.importIncremental', '增量（跳过重复）')}
                              </option>
                              <option value="merge">
                                {tf('transactions.filters.importMerge', '合并（覆盖重复）')}
                              </option>
                              <option value="overwrite">
                                {tf('transactions.filters.importOverwrite', '覆盖（清空后导入）')}
                              </option>
                            </select>
                          </div>
                          <div className="transaction-filter-actions-grid transaction-filter-actions-grid-inline transaction-filter-actions-grid-compact">
                            <button type="button" onClick={onExport}>
                              {tf('transactions.filters.exportCsv', '导出 CSV')}
                            </button>
                            <button type="button" onClick={onCheckDuplicates}>
                              {tf('transactions.filters.checkDuplicates', '检测重复')}
                            </button>
                            <button type="button" onClick={onImportWechat}>
                              {tf('transactions.filters.importWechat', '导入微信')}
                            </button>
                            <button type="button" onClick={onImportAlipay}>
                              {tf('transactions.filters.importAlipay', '导入支付宝')}
                            </button>
                          </div>
                        </div>
                      </section>
                    </div>

                    <div className="transaction-filter-dialog-footer">
                      <button type="button" className="transaction-filter-reset" onClick={onClear}>
                        {tf('transactions.filters.clearFilters', '清空筛选条件')}
                      </button>
                      <button
                        type="button"
                        className="primary transaction-filter-done"
                        onClick={() => setMenuOpen(false)}
                      >
                        {tf('transactions.filters.done', '完成')}
                      </button>
                    </div>
                  </div>
                </div>,
                document.body
              )
            : null}
        </div>
      </div>
    </section>
  );
}
