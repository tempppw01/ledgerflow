import { useTranslation } from 'react-i18next';
import { PRINTER_ICON_URL } from '../../../shared/config/brandAssets';

export interface BulkActionsBarProps {
  selectedCount: number;
  categoryOptions: Array<{ id: string; name: string }>;
  accountOptions: Array<{ id: string; name: string }>;
  bulkAiRecategorizing: boolean;
  bulkExportingPdf?: boolean;
  bulkPrintTemplate?: 'full' | 'summary';
  bulkPrintFields: {
    includeAccount: boolean;
    includeNote: boolean;
    includeOrderNo: boolean;
    includeTags: boolean;
  };
  onBulkEditCategory: (categoryId: string) => void;
  onBulkAiRecategorize: () => void;
  onBulkEditAccount: (accountId: string) => void;
  onBulkPrintA4?: () => void;
  onBulkExportPdf?: () => void;
  onBulkPrintTemplateChange?: (value: 'full' | 'summary') => void;
  onBulkPrintFieldsChange?: (value: {
    includeAccount: boolean;
    includeNote: boolean;
    includeOrderNo: boolean;
    includeTags: boolean;
  }) => void;
  onDeleteSelected: () => void;
  onClearSelection: () => void;
}

export function BulkActionsBar({
  selectedCount,
  categoryOptions,
  accountOptions,
  bulkAiRecategorizing,
  bulkExportingPdf,
  bulkPrintTemplate = 'full',
  bulkPrintFields,
  onBulkEditCategory,
  onBulkAiRecategorize,
  onBulkEditAccount,
  onBulkPrintA4,
  onBulkExportPdf,
  onBulkPrintTemplateChange,
  onBulkPrintFieldsChange,
  onDeleteSelected,
  onClearSelection,
}: BulkActionsBarProps) {
  const { t } = useTranslation();

  return (
    <div className="transaction-bulk-bar">
      <strong>{t('transactions.bulk.selected', { count: selectedCount })}</strong>
      <div className="row transaction-bulk-actions">
        <label className="transaction-bulk-select">
          <span>{t('transactions.bulk.category')}</span>
          <select
            defaultValue=""
            onChange={(event) => {
              if (!event.target.value) return;
              onBulkEditCategory(event.target.value);
              event.target.value = '';
            }}
          >
            <option value="">{t('transactions.bulk.selectCategory')}</option>
            {categoryOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={onBulkAiRecategorize}>
          {bulkAiRecategorizing
            ? t('transactions.bulk.stopAiRecategorize')
            : t('transactions.bulk.aiRecategorize')}
        </button>
        <label className="transaction-bulk-select">
          <span>{t('transactions.bulk.account')}</span>
          <select
            defaultValue=""
            onChange={(event) => {
              if (!event.target.value) return;
              onBulkEditAccount(event.target.value);
              event.target.value = '';
            }}
          >
            <option value="">{t('transactions.bulk.selectAccount')}</option>
            {accountOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </label>
        {onBulkPrintTemplateChange && (
          <label className="transaction-bulk-select">
            <span>{t('transactions.bulk.template')}</span>
            <select
              value={bulkPrintTemplate}
              onChange={(event) =>
                onBulkPrintTemplateChange(event.target.value === 'summary' ? 'summary' : 'full')
              }
            >
              <option value="full">{t('transactions.bulk.templateFull')}</option>
              <option value="summary">{t('transactions.bulk.templateSummary')}</option>
            </select>
          </label>
        )}
        {onBulkPrintFieldsChange && (
          <>
            <label className="transaction-bulk-select">
              <span>{t('transactions.bulk.fields')}</span>
              <select
                value="custom"
                onChange={(event) => {
                  const next = event.target.value;
                  if (next === 'full') {
                    onBulkPrintFieldsChange({
                      includeAccount: true,
                      includeNote: true,
                      includeOrderNo: true,
                      includeTags: true,
                    });
                  } else if (next === 'compact') {
                    onBulkPrintFieldsChange({
                      includeAccount: false,
                      includeNote: false,
                      includeOrderNo: false,
                      includeTags: false,
                    });
                  }
                  event.target.value = 'custom';
                }}
              >
                <option value="custom">{t('transactions.bulk.fieldsCustom')}</option>
                <option value="full">{t('transactions.bulk.fieldsFull')}</option>
                <option value="compact">{t('transactions.bulk.fieldsCompact')}</option>
              </select>
            </label>
            <label className="transaction-bulk-select" style={{ gap: 6 }}>
              <span>{t('transactions.bulk.fieldAccount')}</span>
              <input
                type="checkbox"
                checked={bulkPrintFields.includeAccount}
                onChange={(e) =>
                  onBulkPrintFieldsChange({ ...bulkPrintFields, includeAccount: e.target.checked })
                }
              />
            </label>
            <label className="transaction-bulk-select" style={{ gap: 6 }}>
              <span>{t('transactions.bulk.fieldNote')}</span>
              <input
                type="checkbox"
                checked={bulkPrintFields.includeNote}
                onChange={(e) =>
                  onBulkPrintFieldsChange({ ...bulkPrintFields, includeNote: e.target.checked })
                }
              />
            </label>
            <label className="transaction-bulk-select" style={{ gap: 6 }}>
              <span>{t('transactions.bulk.fieldOrderNo')}</span>
              <input
                type="checkbox"
                checked={bulkPrintFields.includeOrderNo}
                onChange={(e) =>
                  onBulkPrintFieldsChange({ ...bulkPrintFields, includeOrderNo: e.target.checked })
                }
              />
            </label>
            <label className="transaction-bulk-select" style={{ gap: 6 }}>
              <span>{t('transactions.bulk.fieldTags')}</span>
              <input
                type="checkbox"
                checked={bulkPrintFields.includeTags}
                onChange={(e) =>
                  onBulkPrintFieldsChange({ ...bulkPrintFields, includeTags: e.target.checked })
                }
              />
            </label>
          </>
        )}
        {onBulkPrintA4 && (
          <button type="button" onClick={onBulkPrintA4} className="button-with-icon">
            <img src={PRINTER_ICON_URL} alt="" aria-hidden="true" />
            {t('transactions.bulk.printA4')}
          </button>
        )}
        {onBulkExportPdf && (
          <button
            type="button"
            onClick={onBulkExportPdf}
            disabled={bulkExportingPdf}
          >
            {bulkExportingPdf
              ? t('transactions.bulk.exportingPdf')
              : t('transactions.bulk.exportPdf')}
          </button>
        )}
        <button type="button" onClick={onDeleteSelected} className="danger">
          {t('transactions.bulk.delete')}
        </button>
        <button type="button" onClick={onClearSelection}>
          {t('transactions.bulk.clearSelection')}
        </button>
      </div>
    </div>
  );
}
