import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ARCHIVE_ICON_URL, RESTORE_ICON_URL } from '../../shared/config/brandAssets';
import { useGlobalMemoryStore } from '../../shared/store/useGlobalMemoryStore';
import type { GlobalMemoryStatus, GlobalMemoryType } from '../../shared/store/globalMemory';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog';
import { Toast, ToastVariant } from '../../shared/ui/Toast';

const MEMORY_TYPE_KEYS: Record<GlobalMemoryType, string> = {
  user_preference: 'userPreference',
  financial_habit: 'financialHabit',
  risk_preference: 'riskPreference',
  display_preference: 'displayPreference'
};

const MEMORY_SOURCE_KEYS: Record<string, string> = {
  assistant_chat: 'assistantChat',
  bookkeeping_action: 'bookkeepingAction',
  repayment_behavior: 'repaymentBehavior',
  budget_behavior: 'budgetBehavior',
  settings_change: 'settingsChange',
  manual: 'manual'
};

const MEMORY_ORIGIN_KEYS: Record<string, string> = {
  manual: 'manual',
  extracted: 'extracted',
  inferred: 'inferred'
};

export function GlobalMemoryPage() {
  const { t, i18n } = useTranslation();
  const memories = useGlobalMemoryStore((s) => s.memories);
  const archiveMemory = useGlobalMemoryStore((s) => s.archiveMemory);
  const restoreMemory = useGlobalMemoryStore((s) => s.restoreMemory);
  const setMemoryDisabled = useGlobalMemoryStore((s) => s.setMemoryDisabled);
  const pinMemory = useGlobalMemoryStore((s) => s.pinMemory);
  const removeMemory = useGlobalMemoryStore((s) => s.removeMemory);
  const removeMemories = useGlobalMemoryStore((s) => s.removeMemories);
  const clearMemories = useGlobalMemoryStore((s) => s.clearMemories);
  const dateLocale = i18n.resolvedLanguage?.startsWith('en') ? 'en-US' : 'zh-CN';

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
    () =>
      memories
        .filter(
          (item) =>
            (type === 'all' || item.type === type) && (status === 'all' || item.status === status)
        )
        .sort((a, b) => {
          if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
          return (new Date(b.updatedAt).getTime() || 0) - (new Date(a.updatedAt).getTime() || 0);
        }),
    [memories, status, type]
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
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
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
            <p className="global-memory-eyebrow">{t('globalMemory.eyebrow')}</p>
            <h2>{t('globalMemory.title')}</h2>
            <p>{t('globalMemory.description')}</p>
          </div>
          <div className="global-memory-summary">
            <button
              type="button"
              className={`global-memory-filter-pill ${type === 'all' ? 'is-active' : ''}`}
              onClick={() => setType('all')}
            >
              {t('globalMemory.filters.all')} <span>{memories.length}</span>
            </button>
            <button
              type="button"
              className={`global-memory-filter-pill ${type === 'user_preference' ? 'is-active' : ''}`}
              onClick={() => setType('user_preference')}
            >
              {t('globalMemory.types.userPreference')} <span>{summary.user_preference}</span>
            </button>
            <button
              type="button"
              className={`global-memory-filter-pill ${type === 'financial_habit' ? 'is-active' : ''}`}
              onClick={() => setType('financial_habit')}
            >
              {t('globalMemory.types.financialHabit')} <span>{summary.financial_habit}</span>
            </button>
            <button
              type="button"
              className={`global-memory-filter-pill ${type === 'risk_preference' ? 'is-active' : ''}`}
              onClick={() => setType('risk_preference')}
            >
              {t('globalMemory.types.riskPreference')} <span>{summary.risk_preference}</span>
            </button>
            <button
              type="button"
              className={`global-memory-filter-pill ${type === 'display_preference' ? 'is-active' : ''}`}
              onClick={() => setType('display_preference')}
            >
              {t('globalMemory.types.displayPreference')} <span>{summary.display_preference}</span>
            </button>
          </div>
        </div>

        <div className="global-memory-filters">
          <label>
            <span>{t('globalMemory.filters.contentLabel')}</span>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as GlobalMemoryType | 'all')}
            >
              <option value="all">{t('globalMemory.filters.all')}</option>
              <option value="user_preference">{t('globalMemory.types.userPreference')}</option>
              <option value="financial_habit">{t('globalMemory.types.financialHabit')}</option>
              <option value="risk_preference">{t('globalMemory.types.riskPreference')}</option>
              <option value="display_preference">{t('globalMemory.types.displayPreference')}</option>
            </select>
          </label>
          <label>
            <span>{t('globalMemory.filters.rangeLabel')}</span>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as GlobalMemoryStatus | 'all')}
            >
              <option value="active">{t('globalMemory.filters.active')}</option>
              <option value="archived">{t('globalMemory.filters.archived')}</option>
              <option value="all">{t('globalMemory.filters.all')}</option>
            </select>
          </label>
        </div>
        {selectedIds.length > 0 ? (
          <div className="global-memory-bulkbar">
            <span>{t('globalMemory.bulk.selected', { count: selectedIds.length })}</span>
            <button type="button" onClick={selectAllFiltered}>
              {t('globalMemory.bulk.selectCurrent')}
            </button>
            <button type="button" onClick={clearSelection}>
              {t('globalMemory.bulk.clearSelection')}
            </button>
            <button
              type="button"
              className="danger"
              disabled={selectedIds.length === 0}
              onClick={() => {
                removeMemories(selectedIds);
                showToast(t('globalMemory.bulk.deleted', { count: selectedIds.length }), 'warning');
                clearSelection();
              }}
            >
              {t('globalMemory.bulk.delete')}
            </button>
            <button
              type="button"
              className="danger"
              disabled={memories.length === 0}
              onClick={() => {
                clearMemories();
                showToast(t('globalMemory.bulk.cleared'), 'warning');
                clearSelection();
              }}
            >
              {t('globalMemory.bulk.clear')}
            </button>
          </div>
        ) : null}
      </section>

      {filtered.length === 0 ? (
        <section className="panel empty-state">
          <div className="empty-state-icon">
            <img src={ARCHIVE_ICON_URL} alt="" aria-hidden="true" />
          </div>
          <h3>{t('globalMemory.empty.title')}</h3>
          <p>{t('globalMemory.empty.description')}</p>
        </section>
      ) : (
        <section className="global-memory-list">
          {filtered.map((item) => {
            const updatedAt =
              item.updatedAt && !Number.isNaN(new Date(item.updatedAt).getTime())
                ? new Date(item.updatedAt).toLocaleString(dateLocale)
                : t('globalMemory.card.unknownTime');
            return (
              <article
                key={item.id}
                className={`global-memory-card ${selectedIds.includes(item.id) ? 'is-selected' : ''}`}
              >
                <label className="global-memory-check">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(item.id)}
                    onChange={() => toggleSelect(item.id)}
                    aria-label={t('globalMemory.card.selectAria', {
                      title: item.title || t('globalMemory.card.unnamed')
                    })}
                  />
                </label>
                <div className="global-memory-card-main">
                  <div className="global-memory-card-head">
                    <div className="global-memory-card-title-wrap">
                      <h3>{item.title || t('globalMemory.card.unnamed')}</h3>
                      <div className="global-memory-meta-row">
                        <span className="global-memory-type">
                          {t(`globalMemory.types.${MEMORY_TYPE_KEYS[item.type]}`)}
                        </span>
                        {item.disabled ? (
                          <span className="global-memory-state is-muted">
                            {t('globalMemory.card.disabled')}
                          </span>
                        ) : null}
                        {item.pinned ? (
                          <span className="global-memory-state">
                            {t('globalMemory.card.pinned')}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <p className="global-memory-content">
                    {item.content || t('globalMemory.card.noContent')}
                  </p>
                  <div className="global-memory-foot">
                    <span>
                      {t(
                        `globalMemory.sources.${MEMORY_SOURCE_KEYS[item.source] || 'default'}`
                      )}
                    </span>
                    <span>
                      {t(
                        `globalMemory.origins.${
                          MEMORY_ORIGIN_KEYS[item.origin || 'manual'] || 'manual'
                        }`
                      )}
                    </span>
                    <span>{updatedAt}</span>
                  </div>
                </div>
                <div className="global-memory-actions">
                  <button
                    type="button"
                    onClick={() => {
                      pinMemory(item.id, !item.pinned);
                      showToast(
                        item.pinned
                          ? t('globalMemory.toast.unpinned')
                          : t('globalMemory.toast.pinned')
                      );
                    }}
                  >
                    {item.pinned
                      ? t('globalMemory.actions.unpin')
                      : t('globalMemory.actions.pin')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMemoryDisabled(item.id, !item.disabled);
                      showToast(
                        item.disabled
                          ? t('globalMemory.toast.enabled')
                          : t('globalMemory.toast.disabled'),
                        item.disabled ? 'success' : 'warning'
                      );
                    }}
                  >
                    {item.disabled
                      ? t('globalMemory.actions.enable')
                      : t('globalMemory.actions.disable')}
                  </button>
                  {item.status === 'active' ? (
                    <button
                      type="button"
                      className="button-with-icon"
                      onClick={() => {
                        archiveMemory(item.id);
                        showToast(t('globalMemory.toast.archived'));
                      }}
                    >
                      <img src={ARCHIVE_ICON_URL} alt="" aria-hidden="true" />
                      {t('globalMemory.actions.archive')}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="button-with-icon"
                      onClick={() => {
                        restoreMemory(item.id);
                        showToast(t('globalMemory.toast.restored'));
                      }}
                    >
                      <img src={RESTORE_ICON_URL} alt="" aria-hidden="true" />
                      {t('globalMemory.actions.restore')}
                    </button>
                  )}
                  <button
                    type="button"
                    className="danger"
                    onClick={() => setPendingDeleteId(item.id)}
                  >
                    {t('globalMemory.actions.delete')}
                  </button>
                </div>
              </article>
            );
          })}
        </section>
      )}

      <ConfirmDialog
        open={Boolean(pendingDeleteItem)}
        title={t('globalMemory.deleteDialog.title')}
        description={
          pendingDeleteItem
            ? t('globalMemory.deleteDialog.description', {
                title: pendingDeleteItem.title || t('globalMemory.card.unnamed')
              })
            : ''
        }
        confirmText={t('globalMemory.deleteDialog.confirm')}
        cancelText={t('globalMemory.deleteDialog.cancel')}
        danger
        onCancel={() => setPendingDeleteId(null)}
        onConfirm={() => {
          if (!pendingDeleteItem) return;
          removeMemory(pendingDeleteItem.id);
          setPendingDeleteId(null);
          showToast(t('globalMemory.toast.deleted'));
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
