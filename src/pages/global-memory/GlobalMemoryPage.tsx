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

const MEMORY_STATUS_LABELS: Record<GlobalMemoryStatus, string> = {
  active: '启用中',
  archived: '已归档'
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
      <section className="panel global-memory-toolbar">
        <div className="global-memory-header">
          <div>
            <h2>记忆清单</h2>
            <p>这里记录你反复提到的偏好、习惯和提醒点。助手之后会参考这些内容，减少重复询问，让建议更贴近你的使用方式。</p>
          </div>
          <div className="global-memory-summary">
            <button type="button" className={`badge ${type === 'all' ? 'badge-primary' : ''}`} onClick={() => setType('all')}>
              共 {memories.length} 条
            </button>
            <button
              type="button"
              className={`badge ${type === 'user_preference' ? 'badge-primary' : ''}`}
              onClick={() => setType('user_preference')}
            >
              使用偏好 {summary.user_preference}
            </button>
            <button
              type="button"
              className={`badge ${type === 'financial_habit' ? 'badge-primary' : ''}`}
              onClick={() => setType('financial_habit')}
            >
              记账习惯 {summary.financial_habit}
            </button>
            <button
              type="button"
              className={`badge ${type === 'risk_preference' ? 'badge-primary' : ''}`}
              onClick={() => setType('risk_preference')}
            >
              风险偏好 {summary.risk_preference}
            </button>
            <button
              type="button"
              className={`badge ${type === 'display_preference' ? 'badge-primary' : ''}`}
              onClick={() => setType('display_preference')}
            >
              页面偏好 {summary.display_preference}
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
        <div className="global-memory-bulkbar">
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
        </div>
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
              <article key={item.id} className="panel global-memory-card">
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
                        <span className="badge badge-primary">{MEMORY_TYPE_LABELS[item.type] || '使用偏好'}</span>
                        <span className="badge">{MEMORY_STATUS_LABELS[item.status] || '启用中'}</span>
                        {item.pinned ? <span className="badge badge-warning">置顶</span> : null}
                        {item.disabled ? <span className="badge badge-danger">已停用</span> : null}
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
