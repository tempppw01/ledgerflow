import { useState } from 'react';
import { useTFallback, type TfFallback } from '../../../shared/lib/useTFallback';
import type { DraftBillEntry } from '../workbench/workbenchTypes';
import type { Account } from '../../../entities/account/types';
import {
  isSupportedLedgerCurrency,
  LEDGER_CURRENCY_CODES,
  normalizeLedgerCurrency
} from '../workbench/workbenchUtils';
import { resolveDraftAccountLabel } from '../workbench/workbenchMapping';
import { roundMoney } from '../../../shared/lib/money';
import { resolveTransactionLocalDay } from '../../../shared/lib/localDate';

interface BillPreviewCardProps {
  entries: DraftBillEntry[];
  duplicateCount: number;
  accounts?: Account[];
  onCheckDuplicates: () => number;
  onSave: (options?: { overwriteDuplicateEntryIds?: string[] }) => boolean;
  saving?: boolean;
  onUpdateEntry?: (id: string, patch: Partial<DraftBillEntry>) => void;
  onRemoveEntry?: (id: string) => void;
  onCreateSubscription?: (entryId: string) => void;
  onSaved?: () => void;
}

const typeOptions: Array<{ value: DraftBillEntry['type']; key: string; label: string }> = [
  { value: 'expense', key: 'billPreview.type.expense', label: '支出' },
  { value: 'income', key: 'billPreview.type.income', label: '收入' },
  { value: 'budget', key: 'billPreview.type.budget', label: '预算' },
  { value: 'repayment', key: 'billPreview.type.repayment', label: '还款' }
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
    key: `billPreview.currency.${value}`,
    label: `${value} ${currencyLabels[value] || ''}`.trim()
  })),
  { value: 'UNKNOWN', key: 'billPreview.currency.unknown', label: '待确认' }
];

function getTypeLabel(type: DraftBillEntry['type'], tf: TfFallback) {
  const option = typeOptions.find((item) => item.value === type);
  if (!option) return tf('billPreview.type.unknown', '待确认类型');
  return tf(option.key, option.label);
}

function issueText(entry: DraftBillEntry, tf: TfFallback): string {
  return entry.issues
    .map((item) =>
      item.needsReview
        ? tf('billPreview.issue.needsReview', '需人工确认：{message}').replace('{message}', item.message)
        : item.message
    )
    .join('；');
}

export function BillPreviewCard({
  entries,
  duplicateCount,
  accounts = [],
  onCheckDuplicates,
  onSave,
  saving = false,
  onUpdateEntry,
  onRemoveEntry,
  onCreateSubscription,
  onSaved
}: BillPreviewCardProps) {
  const tf = useTFallback();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [conversionInputs, setConversionInputs] = useState<Record<string, string>>({});

  const formatAmount = (amount: number, currency: string) => {
    try {
      return new Intl.NumberFormat('zh-CN', {
        style: 'currency',
        currency,
        minimumFractionDigits: 2
      }).format(amount);
    } catch {
      return `${currency} ${amount.toFixed(2)}`;
    }
  };

  const normalizedCurrencyFor = (item: DraftBillEntry) =>
    normalizeLedgerCurrency(item.currency || '');

  const isForeignCurrency = (item: DraftBillEntry) => {
    const currency = normalizedCurrencyFor(item);
    return isSupportedLedgerCurrency(currency) && currency !== 'CNY';
  };

  const needsCurrencyConfirmation = (item: DraftBillEntry) => {
    if (item.currencyConfirmed) return false;
    if (!isSupportedLedgerCurrency(item.currency)) return false;
    return (
      item.needsReview?.includes('currency') === true ||
      item.issues.some((issue) => issue.field === 'currency')
    );
  };

  const currencyConfirmationLabel = (item: DraftBillEntry) =>
    isForeignCurrency(item)
      ? tf('billPreview.confirmCnyAmount', '确认人民币金额')
      : tf('billPreview.confirmCurrencyCny', '确认币种为 CNY');

  const convertForeignCurrency = (item: DraftBillEntry) => {
    const currency = normalizedCurrencyFor(item);
    const amount = Number(conversionInputs[item.id]);
    if (!isForeignCurrency(item) || !Number.isFinite(amount) || amount <= 0) return;
    onUpdateEntry?.(item.id, {
      amount: roundMoney(amount),
      currencyConfirmed: true,
      originalAmountText: item.originalAmountText?.trim() || formatAmount(item.amount, currency)
    });
    setConversionInputs((prev) => {
      const next = { ...prev };
      delete next[item.id];
      return next;
    });
  };

  const saveableCount = entries.filter((item) => item.selected && item.issues.length === 0).length;
  const skippedCount = entries.length - saveableCount;

  const handleSave = () => {
    if (saving || saveableCount === 0) return;
    if (onSave()) {
      onSaved?.();
    }
  };

  return (
    <section className="chat-bill-preview" aria-label={tf('billPreview.cardAria', '账单确认')}>
      <header className="chat-bill-preview-header">
        <div>
          <span className="chat-bill-preview-kicker">{tf('billPreview.kicker', '账单已整理好')}</span>
          <h3>
          {tf('billPreview.pendingCount', '{count} 笔待确认').replace('{count}', String(entries.length))}
        </h3>
        </div>
        <button type="button" className="chat-bill-check-duplicates" onClick={onCheckDuplicates}>
          {tf('billPreview.checkDuplicates', '检查重复')}
        </button>
      </header>

      {duplicateCount > 0 ? (
        <p className="chat-dup-alert" role="status">
          {tf('billPreview.duplicateWarning', '有 {count} 笔可能已记过，保存前建议核对一下。').replace('{count}', String(duplicateCount))}
        </p>
      ) : (
        <p className="chat-dup-alert subtle" role="status">
          {tf('billPreview.noDuplicates', '暂未发现重复记录')}
        </p>
      )}

      <div className="chat-bill-rows">
        {entries.map((item, index) => {
          const editing = editingId === item.id;
          const accountLabel = resolveDraftAccountLabel(item, accounts);
          const normalizedCurrency = normalizeLedgerCurrency(item.currency);
          const currencyIsValid = isSupportedLedgerCurrency(normalizedCurrency);
          const foreignCurrency = isForeignCurrency(item);
          const showCurrencyConfirmation = needsCurrencyConfirmation(item);
          const conversionAmount = Number(conversionInputs[item.id]);
          const canConvertCurrency =
            foreignCurrency && Number.isFinite(conversionAmount) && conversionAmount > 0;
          return (
            <article
              key={item.id}
              className={`chat-bill-row-item${item.selected ? '' : ' is-unselected'}${
                item.issues.length > 0 ? ' has-issue' : ''
              }`}
            >
              <label
                className="chat-bill-row-check"
                title={
                  item.selected
                    ? tf('billPreview.uncheckTitle', '取消勾选，不保存这笔')
                    : tf('billPreview.checkTitle', '勾选后保存这笔')
                }
              >
                <input
                  type="checkbox"
                  checked={item.selected}
                  onChange={(event) => onUpdateEntry?.(item.id, { selected: event.target.checked })}
                  aria-label={tf('billPreview.rowCheckboxAria', '勾选第 {index} 笔账单').replace('{index}', String(index + 1))}
                />
              </label>

              <div className="chat-bill-row-copy">
                <strong>{item.note?.trim() || item.category || tf('billPreview.emptyNote', '未填写备注')}</strong>
                <small>
                  {resolveTransactionLocalDay(item.date)} <span aria-hidden="true">·</span>{' '}
                  {getTypeLabel(item.type, tf)}
                  <span aria-hidden="true">·</span> {item.category || tf('billPreview.uncategorized', '未分类')}
                  <span aria-hidden="true">·</span> {accountLabel.label || tf('billPreview.noAccount', '未指定账户')}
                  {accountLabel.label && accountLabel.inferred ? tf('billPreview.autoMatched', '(自动匹配)') : ''}
                </small>
                {item.originalAmountText || item.subscriptionSuggestion ? (
                  <div className="chat-bill-row-extra">
                    {item.originalAmountText ? (
                      <span>{tf('billPreview.originalAmount', '原始金额：{value}').replace('{value}', item.originalAmountText)}</span>
                    ) : null}
                    {item.subscriptionSuggestion ? <span>{tf('billPreview.subscriptionHint', '可加入订阅管理')}</span> : null}
                  </div>
                ) : null}
              </div>

              <div className="chat-bill-row-value">
                <strong className={`is-${item.type}`}>
                  {formatAmount(
                    item.amount,
                    foreignCurrency && !item.currencyConfirmed ? normalizedCurrency : 'CNY'
                  )}
                </strong>
                {foreignCurrency ? (
                  <small className="chat-bill-row-currency">
                    {item.currencyConfirmed
                      ? tf('billPreview.bookedInCny', '人民币入账')
                      : tf('billPreview.originalCurrencyAmount', '原币金额')}
                  </small>
                ) : null}
                {item.duplicateTxId ? <span className="chat-dup-badge">{tf('billPreview.duplicateBadge', '可能重复')}</span> : null}
                {item.duplicateReason === 'batch' ? (
                  <span className="chat-dup-badge">{tf('billPreview.duplicateBatchBadge', '同批次重复')}</span>
                ) : null}
                {onUpdateEntry || onRemoveEntry ? (
                  <div className="chat-bill-row-actions">
                    {onUpdateEntry ? (
                      <button
                        type="button"
                        onClick={() => setEditingId(editing ? null : item.id)}
                        aria-expanded={editing}
                      >
                        {editing ? tf('billPreview.collapse', '收起') : tf('billPreview.edit', '编辑')}
                      </button>
                    ) : null}
                    {onRemoveEntry ? (
                      <button type="button" onClick={() => onRemoveEntry(item.id)}>
                        {tf('billPreview.delete', '删除')}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>

              {item.issues.length > 0 || showCurrencyConfirmation ? (
                <div className="chat-bill-issue">
                  <span>{item.issues.length > 0 ? issueText(item, tf) : tf('billPreview.currencyReview', '需人工确认:币种')}</span>
                  {showCurrencyConfirmation && foreignCurrency && onUpdateEntry ? (
                    <div
                      className="chat-bill-currency-convert"
                      role="group"
                      aria-label={tf('billPreview.convertAria', '{currency} 折算为人民币').replace('{currency}', normalizedCurrency)}
                    >
                      <label htmlFor={`conversion-${item.id}`}>{tf('billPreview.cnyAmountLabel', '人民币入账金额')}</label>
                      <input
                        id={`conversion-${item.id}`}
                        type="number"
                        min="0.01"
                        step="0.01"
                        inputMode="decimal"
                        value={conversionInputs[item.id] || ''}
                        placeholder={tf(
                          'billPreview.cnyPlaceholder',
                          '请输入 {value} 折合多少元'
                        ).replace(
                          '{value}',
                          item.originalAmountText || formatAmount(item.amount, normalizedCurrency)
                        )}
                        onChange={(event) =>
                          setConversionInputs((prev) => ({
                            ...prev,
                            [item.id]: event.target.value
                          }))
                        }
                      />
                      <button
                        type="button"
                        className="chat-bill-confirm-currency"
                        disabled={!canConvertCurrency}
                        onClick={() => convertForeignCurrency(item)}
                      >
                        {currencyConfirmationLabel(item)}
                      </button>
                    </div>
                  ) : showCurrencyConfirmation && onUpdateEntry ? (
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
                    {tf('billPreview.field.type', '类型')}
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
                          {tf(option.key, option.label)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {foreignCurrency && !item.currencyConfirmed
                      ? tf('billPreview.originalCurrencyAmount', '原币金额')
                      : tf('billPreview.field.cnyAmount', '人民币金额')}
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
                    {tf('billPreview.field.date', '日期')}
                    <input
                      type="date"
                      value={resolveTransactionLocalDay(item.date)}
                      onChange={(event) => onUpdateEntry?.(item.id, { date: event.target.value })}
                    />
                  </label>
                  <label>
                    {tf('billPreview.field.currency', '币种')}
                    <select
                      value={normalizedCurrency}
                      aria-invalid={!currencyIsValid}
                      onChange={(event) => {
                        const nextCurrency = normalizeLedgerCurrency(event.target.value);
                        onUpdateEntry?.(item.id, {
                          currency: nextCurrency,
                          needsReview: Array.from(
                            new Set([...(item.needsReview || []), 'amount', 'currency'])
                          )
                        });
                      }}
                    >
                      {!currencyIsValid ? (
                        <option value={normalizedCurrency}>
                          {tf('billPreview.invalidCurrency', '{currency}（无效,请重选）').replace(
                            '{currency}',
                            normalizedCurrency
                          )}
                        </option>
                      ) : null}
                      {currencyOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {tf(option.key, option.label)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {tf('billPreview.field.category', '分类')}
                    <input
                      value={item.category}
                      onChange={(event) =>
                        onUpdateEntry?.(item.id, { category: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    {tf('billPreview.field.account', '账户')}
                    <input
                      value={item.account}
                      placeholder={
                        accountLabel.label
                          ? tf('billPreview.autoMatchPrefix', '自动匹配：{name}').replace(
                              '{name}',
                              accountLabel.label
                            )
                          : tf('billPreview.accountPlaceholder', '如 招商银行储蓄卡')
                      }
                      onChange={(event) =>
                        onUpdateEntry?.(item.id, { account: event.target.value })
                      }
                    />
                  </label>
                  <label className="chat-bill-edit-wide">
                    {tf('billPreview.field.note', '备注')}
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
                    {tf('billPreview.addToSubscriptions', '加入订阅管理')}
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
            ? tf(
                'billPreview.footerCounts',
                '已勾选可保存 {saveable} 笔，另有 {skipped} 笔未勾选或需修正。'
              )
                .replace('{saveable}', String(saveableCount))
                .replace('{skipped}', String(skippedCount))
            : tf('billPreview.footerHint', '核对无误后再保存，可避免重复记账。')}
        </span>
        <button
          type="button"
          className="primary"
          onClick={handleSave}
          disabled={saving || saveableCount === 0}
          aria-busy={saving}
          title={
            saving
              ? tf('billPreview.savingTitle', '正在保存\uFF0C请稍候')
              : saveableCount === 0
                ? tf('billPreview.nothingToSaveTitle', '请先勾选或修正账单')
                : undefined
          }
        >
          {saving ? tf('billPreview.saving', '保存中') : tf('billPreview.save', '保存到账本')}
        </button>
      </footer>
    </section>
  );
}
