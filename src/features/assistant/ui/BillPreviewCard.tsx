import { useState } from 'react';
import type { DraftBillEntry } from '../workbench/workbenchTypes';
import {
  isSupportedLedgerCurrency,
  LEDGER_CURRENCY_CODES,
  normalizeLedgerCurrency
} from '../workbench/workbenchUtils';

interface BillPreviewCardProps {
  entries: DraftBillEntry[];
  duplicateCount: number;
  onCheckDuplicates: () => number;
  onSave: (options?: { overwriteDuplicateEntryIds?: string[] }) => boolean;
  onUpdateEntry?: (id: string, patch: Partial<DraftBillEntry>) => void;
  onRemoveEntry?: (id: string) => void;
  onCreateSubscription?: (entryId: string) => void;
  onSaved?: () => void;
}

const typeOptions: Array<{ value: DraftBillEntry['type']; label: string }> = [
  { value: 'expense', label: '支出' },
  { value: 'income', label: '收入' },
  { value: 'budget', label: '预算' },
  { value: 'repayment', label: '还款' }
];

const currencyLabels: Record<string, string> = {
  CNY: '人民币',
  USD: '美元',
  HKD: '港币',
  JPY: '日元',
  EUR: '欧元',
  GBP: '英镑',
  KRW: '韩元',
  SGD: '新加坡元',
  AUD: '澳元',
  CAD: '加元',
  CHF: '瑞郎',
  TWD: '新台币'
};

const currencyOptions = [
  ...LEDGER_CURRENCY_CODES.map((value) => ({
    value,
    label: `${value} ${currencyLabels[value] || ''}`.trim()
  })),
  { value: 'UNKNOWN', label: '待确认' }
];

function getTypeLabel(type: DraftBillEntry['type']) {
  return typeOptions.find((option) => option.value === type)?.label || '待确认类型';
}

function issueText(entry: DraftBillEntry): string {
  return entry.issues
    .map((item) => (item.needsReview ? `需人工确认：${item.message}` : item.message))
    .join('；');
}

export function BillPreviewCard({
  entries,
  duplicateCount,
  onCheckDuplicates,
  onSave,
  onUpdateEntry,
  onRemoveEntry,
  onCreateSubscription,
  onSaved
}: BillPreviewCardProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const formatAmount = (item: DraftBillEntry) => {
    try {
      return new Intl.NumberFormat('zh-CN', {
        style: 'currency',
        currency: 'CNY',
        minimumFractionDigits: 2
      }).format(item.amount);
    } catch {
      return `¥${item.amount.toFixed(2)}`;
    }
  };

  const needsCurrencyConfirmation = (item: DraftBillEntry) => {
    if (item.currencyConfirmed) return false;
    if (!isSupportedLedgerCurrency(item.currency)) return false;
    return (
      item.needsReview?.includes('currency') === true ||
      item.issues.some((issue) => issue.field === 'currency')
    );
  };

  const currencyConfirmationLabel = (item: DraftBillEntry) => {
    const currency = normalizeLedgerCurrency(item.currency);
    return !currency || currency === 'CNY' || currency === 'UNKNOWN'
      ? '确认币种为 CNY'
      : '确认按人民币金额入账';
  };

  const saveableCount = entries.filter((item) => item.selected && item.issues.length === 0).length;
  const skippedCount = entries.length - saveableCount;

  const handleSave = () => {
    if (saveableCount === 0) return;
    if (onSave()) {
      onSaved?.();
    }
  };

  return (
    <section className="chat-bill-preview" aria-label="账单确认">
      <header className="chat-bill-preview-header">
        <div>
          <span className="chat-bill-preview-kicker">账单已整理好</span>
          <h3>{entries.length} 笔待确认</h3>
        </div>
        <button type="button" className="chat-bill-check-duplicates" onClick={onCheckDuplicates}>
          检查重复
        </button>
      </header>

      {duplicateCount > 0 ? (
        <p className="chat-dup-alert" role="status">
          有 {duplicateCount} 笔可能已记过，保存前建议核对一下。
        </p>
      ) : (
        <p className="chat-dup-alert subtle" role="status">
          暂未发现重复记录
        </p>
      )}

      <div className="chat-bill-rows">
        {entries.map((item, index) => {
          const editing = editingId === item.id;
          const normalizedCurrency = normalizeLedgerCurrency(item.currency);
          const currencyIsValid = isSupportedLedgerCurrency(normalizedCurrency);
          const showCurrencyConfirmation = needsCurrencyConfirmation(item);
          return (
            <article
              key={item.id}
              className={`chat-bill-row-item${item.selected ? '' : ' is-unselected'}${
                item.issues.length > 0 ? ' has-issue' : ''
              }`}
            >
              <label
                className="chat-bill-row-check"
                title={item.selected ? '取消勾选，不保存这笔' : '勾选后保存这笔'}
              >
                <input
                  type="checkbox"
                  checked={item.selected}
                  onChange={(event) => onUpdateEntry?.(item.id, { selected: event.target.checked })}
                  aria-label={`勾选第 ${index + 1} 笔账单`}
                />
              </label>

              <div className="chat-bill-row-copy">
                <strong>{item.note?.trim() || item.category || '未填写备注'}</strong>
                <small>
                  {item.date.slice(0, 10)} <span aria-hidden="true">·</span>{' '}
                  {getTypeLabel(item.type)}
                  <span aria-hidden="true">·</span> {item.category || '未分类'}
                  <span aria-hidden="true">·</span> {item.account || '未指定账户'}
                </small>
                {item.originalAmountText || item.subscriptionSuggestion ? (
                  <div className="chat-bill-row-extra">
                    {item.originalAmountText ? (
                      <span>原始金额：{item.originalAmountText}</span>
                    ) : null}
                    {item.subscriptionSuggestion ? <span>可加入订阅管理</span> : null}
                  </div>
                ) : null}
              </div>

              <div className="chat-bill-row-value">
                <strong className={`is-${item.type}`}>{formatAmount(item)}</strong>
                {item.duplicateTxId ? <span className="chat-dup-badge">可能重复</span> : null}
                {item.duplicateReason === 'batch' ? (
                  <span className="chat-dup-badge">同批次重复</span>
                ) : null}
                {onUpdateEntry || onRemoveEntry ? (
                  <div className="chat-bill-row-actions">
                    {onUpdateEntry ? (
                      <button
                        type="button"
                        onClick={() => setEditingId(editing ? null : item.id)}
                        aria-expanded={editing}
                      >
                        {editing ? '收起' : '编辑'}
                      </button>
                    ) : null}
                    {onRemoveEntry ? (
                      <button type="button" onClick={() => onRemoveEntry(item.id)}>
                        删除
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>

              {item.issues.length > 0 || showCurrencyConfirmation ? (
                <div className="chat-bill-issue">
                  <span>{item.issues.length > 0 ? issueText(item) : '需人工确认:币种'}</span>
                  {showCurrencyConfirmation && onUpdateEntry ? (
                    <button
                      type="button"
                      className="chat-bill-confirm-currency"
                      onClick={() => onUpdateEntry(item.id, { currencyConfirmed: true })}
                    >
                      {currencyConfirmationLabel(item)}
                    </button>
                  ) : null}
                </div>
              ) : null}

              {editing ? (
                <div className="chat-bill-edit-grid">
                  <label>
                    类型
                    <select
                      value={item.type === 'unknown' ? 'expense' : item.type}
                      onChange={(event) =>
                        onUpdateEntry?.(item.id, {
                          type: event.target.value as DraftBillEntry['type']
                        })
                      }
                    >
                      {typeOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    金额
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={item.amount}
                      onChange={(event) =>
                        onUpdateEntry?.(item.id, { amount: Number(event.target.value) || 0 })
                      }
                    />
                  </label>
                  <label>
                    日期
                    <input
                      type="date"
                      value={item.date.slice(0, 10)}
                      onChange={(event) => onUpdateEntry?.(item.id, { date: event.target.value })}
                    />
                  </label>
                  <label>
                    币种
                    <select
                      value={normalizedCurrency}
                      aria-invalid={!currencyIsValid}
                      onChange={(event) =>
                        onUpdateEntry?.(item.id, {
                          currency: normalizeLedgerCurrency(event.target.value)
                        })
                      }
                    >
                      {!currencyIsValid ? (
                        <option value={normalizedCurrency}>
                          {normalizedCurrency}（无效,请重选）
                        </option>
                      ) : null}
                      {currencyOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    分类
                    <input
                      value={item.category}
                      onChange={(event) =>
                        onUpdateEntry?.(item.id, { category: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    账户
                    <input
                      value={item.account}
                      placeholder="如 招商银行储蓄卡"
                      onChange={(event) =>
                        onUpdateEntry?.(item.id, { account: event.target.value })
                      }
                    />
                  </label>
                  <label className="chat-bill-edit-wide">
                    备注
                    <input
                      value={item.note}
                      onChange={(event) => onUpdateEntry?.(item.id, { note: event.target.value })}
                    />
                  </label>
                </div>
              ) : null}

              {item.subscriptionSuggestion ? (
                <div className="chat-bill-row-subscription">
                  <button type="button" onClick={() => onCreateSubscription?.(item.id)}>
                    加入订阅管理
                  </button>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>

      <footer className="chat-bill-preview-footer">
        <span>
          {skippedCount > 0
            ? `已勾选可保存 ${saveableCount} 笔，另有 ${skippedCount} 笔未勾选或需修正。`
            : '核对无误后再保存，可避免重复记账。'}
        </span>
        <button
          type="button"
          className="primary"
          onClick={handleSave}
          disabled={saveableCount === 0}
          title={saveableCount === 0 ? '请先勾选或修正账单' : undefined}
        >
          保存到账本
        </button>
      </footer>
    </section>
  );
}
