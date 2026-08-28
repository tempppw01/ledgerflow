import { useMemo, useState } from 'react';
import { ARCHIVE_ICON_URL, RESTORE_ICON_URL } from '../../shared/config/brandAssets';
import { useGlobalMemoryStore } from '../../shared/store/useGlobalMemoryStore';
import type { GlobalMemoryStatus, GlobalMemoryType } from '../../shared/store/globalMemory';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog';
import { Toast, ToastVariant } from '../../shared/ui/Toast';

const MEMORY_TYPE_LABELS: Record<GlobalMemoryType, string> = {
  user_preference: '使用偏好',
  financial_habit: '记账习惯',
  risk_preference: '风险偏好',
  display_preference: '页面偏好'
};

const MEMORY_SOURCE_LABELS: Record<string, string> = {
  assistant_chat: '来自对话',
  bookkeeping_action: '来自记账',
  repayment_behavior: '来自还款',
  budget_behavior: '来自预算',
  settings_change: '来自设置',
  manual: '手动添加'
};

const MEMORY_ORIGIN_LABELS: Record<string, string> = {
  manual: '手动添加',
  extracted: '自动整理',
  inferred: '根据使用整理'
};

export function GlobalMemoryPage() {
  const memories = useGlobalMemoryStore((s) => s.memories);
  const getFilteredMemories = useGlobalMemoryStore((s) => s.getFilteredMemories);
  const archiveMemory = useGlobalMemoryStore((s) => s.archiveMemory);
  const restoreMemory = useGlobalMemoryStore((s) => s.restoreMemory);
  const setMemoryDisabled = useGlobalMemoryStore((s) => s.setMemoryDisabled);
  const pinMemory = useGlobalMemoryStore((s) => s.pinMemory);
  const removeMemory = useGlobalMemoryStore((s) => s.removeMemory);
  const removeMemories = useGlobalMemoryStore((s) => s.removeMemories);
  const clearMemories = useGlobalMemoryStore((s) => s.clearMemories);

  const [type, setType] = useState<GlobalMemoryType | 'all'>('all');
  const [status, setStatus] = useState<GlobalMemoryStatus | 'all'>('active');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ visible: boolean; message: string; variant: ToastVariant }>({
    visible: false,
    message: '',
    variant: 'success'
  });

  const filtered = useMemo(
    () => getFilteredMemories({ type, status, includeDisabled: true }),
    [getFilteredMemories, memories, status, type]
  );

  const summary = useMemo(
    () => ({
      user_preference: memories.filter((item) => item.type === 'user_preference').length,
      financial_habit: memories.filter((item) => item.type === 'financial_habit').length,
      risk_preference: memories.filter((item) => item.type === 'risk_preference').length,
      display_preference: memories.filter((item) => item.type === 'display_preference').length
    }),
    [memories]
  );

  const pendingDeleteItem = useMemo(
    () => memories.find((item) => item.id === pendingDeleteId) ?? null,
    [memories, pendingDeleteId]
  );

  const showToast = (message: string, variant: ToastVariant = 'success') => {
    setToast({ visible: true, message, variant });
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const selectAllFiltered = () => {
    setSelectedIds(filtered.map((item) => item.id));
  };

  const clearSelection = () => {
    setSelectedIds([]);
  };

  return (
    <div className="global-memory-page vi-page">
      <section className="global-memory-toolbar">
        <div className="global-memory-header">
          <div>
            <p className="global-memory-eyebrow">陪你用得更顺手</p>
            <h2>你的偏好</h2>
            <p>我会记住这些小习惯，之后少问你几次。</p>
          </div>
          <div className="global-memory-summary">
            <button type="button" className={`global-memory-filter-pill ${type === 'all' ? 'is-active' : ''}`} onClick={() => setType('all')}>
              全部 <span>{memories.length}</span>
            </button>
            <button
              type="button"
              className={`global-memory-filter-pill ${type === 'user_preference' ? 'is-active' : ''}`}
              onClick={() => setType('user_preference')}
            >
              使用偏好 <span>{summary.user_preference}</span>
            </button>
            <button
              type="button"
              className={`global-memory-filter-pill ${type === 'financial_habit' ? 'is-active' : ''}`}
              onClick={() => setType('financial_habit')}
            >
              记账习惯 <span>{summary.financial_habit}</span>
            </button>
            <button
              type="button"
              className={`global-memory-filter-pill ${type === 'risk_preference' ? 'is-active' : ''}`}
              onClick={() => setType('risk_preference')}
            >
              风险偏好 <span>{summary.risk_preference}</span>
            </button>
            <button
              type="button"
              className={`global-memory-filter-pill ${type === 'display_preference' ? 'is-active' : ''}`}
              onClick={() => setType('display_preference')}
            >
              页面偏好 <span>{summary.display_preference}</span>
            </button>
          </div>
        </div>

        <div className="global-memory-filters">
          <label>
            <span>按内容筛选</span>
            <select value={type} onChange={(e) => setType(e.target.value as GlobalMemoryType | 'all')}>
              <option value="all">全部</option>
              <option value="user_preference">使用偏好</option>
              <option value="financial_habit">记账习惯</option>
              <option value="risk_preference">风险偏好</option>
              <option value="display_preference">页面偏好</option>
            </select>
          </label>
          <label>
            <span>显示范围</span>
            <select value={status} onChange={(e) => setStatus(e.target.value as GlobalMemoryStatus | 'all')}>
              <option value="active">启用中</option>
              <option value="archived">已归档</option>
              <option value="all">全部</option>
            </select>
          </label>
        </div>
        {selectedIds.length > 0 ? <div className="global-memory-bulkbar">
          <span>已选择 {selectedIds.length} 条</span>
          <button type="button" onClick={selectAllFiltered}>选择当前结果</button>
          <button type="button" onClick={clearSelection}>取消选择</button>
          <button
            type="button"
            className="danger"
            disabled={selectedIds.length === 0}
            onClick={() => {
              removeMemories(selectedIds);
              showToast(`已删除 ${selectedIds.length} 条记忆`, 'warning');
              clearSelection();
            }}
          >
            批量删除
          </button>
          <button
            type="button"
            className="danger"
            disabled={memories.length === 0}
            onClick={() => {
              clearMemories();
              showToast('已清空全部记忆', 'warning');
              clearSelection();
            }}
          >
            清空记忆
          </button>
        </div> : null}
      </section>

      {filtered.length === 0 ? (
        <section className="panel empty-state">
          <div className="empty-state-icon">
            <img src={ARCHIVE_ICON_URL} alt="" aria-hidden="true" />
          </div>
          <h3>当前没有符合条件的记忆</h3>
          <p>可以换个筛选条件看看。之后当你多次表达相同偏好时，助手会把它整理到这里。</p>
        </section>
      ) : (
        <section className="global-memory-list">
          {filtered.map((item) => {
            const updatedAt = item.updatedAt && !Number.isNaN(new Date(item.updatedAt).getTime())
              ? new Date(item.updatedAt).toLocaleString()
              : '未知时间';
            return (
          <article key={item.id} className={`global-memory-card ${selectedIds.includes(item.id) ? 'is-selected' : ''}`}>
                <label className="global-memory-check">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(item.id)}
                    onChange={() => toggleSelect(item.id)}
                    aria-label={`选择记忆 ${item.title || '未命名记忆'}`}
                  />
                </label>
                <div className="global-memory-card-main">
                  <div className="global-memory-card-head">
                    <div className="global-memory-card-title-wrap">
                      <h3>{item.title || '未命名记忆'}</h3>
                      <div className="global-memory-meta-row">
                        <span className="global-memory-type">{MEMORY_TYPE_LABELS[item.type] || '使用偏好'}</span>
                        {item.disabled ? <span className="global-memory-state is-muted">已暂停</span> : null}
                        {item.pinned ? <span className="global-memory-state">已置顶</span> : null}
                      </div>
                    </div>
                  </div>
                  <p className="global-memory-content">{item.content || '还没有补充内容'}</p>
                  <div className="global-memory-foot">
                    <span>{MEMORY_SOURCE_LABELS[item.source] || '其他来源'}</span>
                    <span>{MEMORY_ORIGIN_LABELS[item.origin || 'manual'] || '手动添加'}</span>
                    <span>{updatedAt}</span>
                  </div>
                </div>
                <div className="global-memory-actions">
                  <button
                    type="button"
                    onClick={() => {
                      pinMemory(item.id, !item.pinned);
                      showToast(item.pinned ? '已取消置顶' : '已置顶记忆');
                    }}
                  >
                    {item.pinned ? '取消置顶' : '置顶'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMemoryDisabled(item.id, !item.disabled);
                      showToast(item.disabled ? '记忆已重新启用' : '记忆已停用', item.disabled ? 'success' : 'warning');
                    }}
                  >
                    {item.disabled ? '启用' : '停用'}
                  </button>
                  {item.status === 'active' ? (
                    <button
                      type="button"
                      className="button-with-icon"
                      onClick={() => {
                        archiveMemory(item.id);
                        showToast('记忆已归档');
                      }}
                    >
                      <img src={ARCHIVE_ICON_URL} alt="" aria-hidden="true" />
                      归档
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="button-with-icon"
                      onClick={() => {
                        restoreMemory(item.id);
                        showToast('记忆已恢复');
                      }}
                    >
                      <img src={RESTORE_ICON_URL} alt="" aria-hidden="true" />
                      恢复
                    </button>
                  )}
                  <button type="button" className="danger" onClick={() => setPendingDeleteId(item.id)}>
                    删除
                  </button>
                </div>
              </article>
            );
          })}
        </section>
      )}

      <ConfirmDialog
        open={Boolean(pendingDeleteItem)}
        title="删除这条记忆？"
        description={pendingDeleteItem ? `删除后不会再用于后续建议：${pendingDeleteItem.title || '未命名记忆'}` : ''}
        confirmText="确认删除"
        cancelText="取消"
        danger
        onCancel={() => setPendingDeleteId(null)}
        onConfirm={() => {
          if (!pendingDeleteItem) return;
          removeMemory(pendingDeleteItem.id);
          setPendingDeleteId(null);
          showToast('已删除这条记忆');
        }}
      />

      <Toast
        visible={toast.visible}
        message={toast.message}
        variant={toast.variant}
        onClose={() => setToast((prev) => ({ ...prev, visible: false }))}
      />
    </div>
  );
}
