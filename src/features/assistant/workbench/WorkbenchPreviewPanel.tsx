import type { DraftBillEntry } from './workbenchTypes';
import { DatePicker } from '../../../shared/ui/DatePicker';

interface WorkbenchPreviewPanelProps {
  entries: DraftBillEntry[];
  onUpdate: (id: string, patch: Partial<DraftBillEntry>) => void;
  onRemove: (id: string) => void;
}

function issueText(entry: DraftBillEntry): string {
  if (entry.issues.length === 0) return '校验通过';
  return entry.issues
    .map((item) => (item.needsReview ? `需人工确认：${item.message}` : item.message))
    .join('；');
}

export function WorkbenchPreviewPanel({ entries, onUpdate, onRemove }: WorkbenchPreviewPanelProps) {
  const selectedCount = entries.filter((item) => item.selected).length;
  const validCount = entries.filter((item) => item.selected && item.issues.length === 0).length;

  return (
    <section className="panel assistant-wb-preview">
      <header className="assistant-wb-section-head">
        <h3>第二步：识别预览</h3>
        <small>
          共 {entries.length} 条，已勾选 {selectedCount} 条，可保存 {validCount} 条
        </small>
      </header>

      {entries.length === 0 ? (
        <p className="assistant-wb-empty">暂无识别结果，先完成第一步。</p>
      ) : null}

      <div className="assistant-wb-card-list">
        {entries.map((item, index) => (
          <article
            key={item.id}
            className={
              item.issues.some((issue) => issue.needsReview) &&
              item.issues.every((issue) => issue.needsReview)
                ? 'assistant-wb-card review'
                : item.issues.length
                  ? 'assistant-wb-card error'
                  : 'assistant-wb-card'
            }
          >
            <header className="assistant-wb-card-head">
              <label>
                <input
                  type="checkbox"
                  checked={item.selected}
                  onChange={(e) => onUpdate(item.id, { selected: e.target.checked })}
                />
                <strong>账单 {index + 1}</strong>
              </label>
              <button type="button" onClick={() => onRemove(item.id)}>
                删除
              </button>
            </header>

            <div className="assistant-wb-grid">
              <label>
                类型
                <select
                  value={item.type}
                  onChange={(e) =>
                    onUpdate(item.id, { type: e.target.value as DraftBillEntry['type'] })
                  }
                >
                  <option value="expense">支出</option>
                  <option value="income">收入</option>
                  <option value="budget">预算</option>
                  <option value="repayment">还款</option>
                </select>
              </label>
              <label>
                金额
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={item.amount}
                  onChange={(e) => onUpdate(item.id, { amount: Number(e.target.value) || 0 })}
                />
              </label>
              <label>
                币种
                <input
                  value={item.currency || 'unknown'}
                  onChange={(e) => onUpdate(item.id, { currency: e.target.value.trim().toUpperCase() || 'unknown' })}
                />
              </label>
              <label>
                日期
                <DatePicker
                  value={item.date.slice(0, 10)}
                  onChange={(value) => onUpdate(item.id, { date: value })}
                />
              </label>
              <label>
                分类
                <input
                  value={item.category}
                  onChange={(e) => onUpdate(item.id, { category: e.target.value })}
                />
              </label>
              <label>
                账户
                <input
                  value={item.account}
                  onChange={(e) => onUpdate(item.id, { account: e.target.value })}
                />
              </label>
              <label>
                标签
                <input
                  value={item.tags.join(', ')}
                  onChange={(e) =>
                    onUpdate(item.id, {
                      tags: e.target.value
                        .split(',')
                        .map((v) => v.trim())
                        .filter(Boolean)
                    })
                  }
                />
              </label>
            </div>

            <label>
              备注
              <input
                value={item.note}
                onChange={(e) => onUpdate(item.id, { note: e.target.value })}
              />
            </label>
            {item.originalAmountText ? <small className="assistant-wb-issue">原始金额：{item.originalAmountText}</small> : null}
            {item.subscriptionSuggestion ? (
              <small className="assistant-wb-issue">
                订阅提示：这笔像“{item.subscriptionSuggestion.kind === 'mobile' ? '话费/通信' : item.subscriptionSuggestion.kind === 'membership' ? '会员' : '数字订阅'}”，建议后续加入订阅管理。{item.subscriptionSuggestion.reason}
              </small>
            ) : null}
            <p
              className={
                item.issues.some((issue) => issue.needsReview) &&
                item.issues.every((issue) => issue.needsReview)
                  ? 'assistant-wb-issue review'
                  : item.issues.length
                    ? 'assistant-wb-issue error'
                    : 'assistant-wb-issue'
              }
            >
              {issueText(item)}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
