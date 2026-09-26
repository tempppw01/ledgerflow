import type { DraftBillEntry } from '../workbench/workbenchTypes';

interface BillPreviewCardProps {
  entries: DraftBillEntry[];
  duplicateCount: number;
  onCheckDuplicates: () => number;
  onSave: (options?: { overwriteDuplicateEntryIds?: string[] }) => boolean;
  onCreateSubscription?: (entryId: string) => void;
  onSaved?: () => void;
}

export function BillPreviewCard({
  entries,
  duplicateCount,
  onCheckDuplicates,
  onSave,
  onCreateSubscription,
  onSaved
}: BillPreviewCardProps) {
  const formatAmount = (item: DraftBillEntry) =>
    new Intl.NumberFormat('zh-CN', {
      style: 'currency',
      currency: item.currency && item.currency !== 'unknown' ? item.currency : 'CNY',
      minimumFractionDigits: 2
    }).format(item.amount);

  const getTypeLabel = (type: DraftBillEntry['type']) => {
    if (type === 'income') return '收入';
    if (type === 'expense') return '支出';
    if (type === 'budget') return '预算';
    if (type === 'repayment') return '还款';
    return '待确认类型';
  };

  const handleSave = () => {
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
        {entries.map((item) => (
          <article key={item.id} className="chat-bill-row-item">
            <div className="chat-bill-row-copy">
              <strong>{item.note?.trim() || item.category || '未填写备注'}</strong>
              <small>
                {item.date.slice(0, 10)} <span aria-hidden="true">·</span> {getTypeLabel(item.type)}
                <span aria-hidden="true">·</span> {item.category || '未分类'}
                <span aria-hidden="true">·</span> {item.account || '选择账户'}
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
            </div>
            {item.subscriptionSuggestion ? (
              <div className="chat-bill-row-subscription">
                <button type="button" onClick={() => onCreateSubscription?.(item.id)}>
                  加入订阅管理
                </button>
              </div>
            ) : null}
          </article>
        ))}
      </div>
      <footer className="chat-bill-preview-footer">
        <span>核对无误后再保存，可避免重复记账。</span>
        <button type="button" className="primary" onClick={handleSave}>
          保存到账本
        </button>
      </footer>
    </section>
  );
}
