import type { FinanceBackupScope } from '../../../shared/lib/backup';
import { useTFallback, type TfFallback } from '../../../shared/lib/useTFallback';

const BACKUP_SCOPE_OPTIONS: Array<{
  key: keyof FinanceBackupScope;
  label: (tf: TfFallback) => string;
  description: (tf: TfFallback) => string;
}> = [
  {
    key: 'ledger',
    label: (tf) => tf('dataBackup.scope.ledger', '账本数据'),
    description: (tf) => tf('dataBackup.scope.ledgerDesc', '交易、分类、账户、回收站和余额记录')
  },
  {
    key: 'subscriptions',
    label: (tf) => tf('dataBackup.scope.subscriptions', '订阅数据'),
    description: (tf) => tf('dataBackup.scope.subscriptionsDesc', '订阅项目和已归档订阅')
  },
  {
    key: 'globalMemories',
    label: (tf) => tf('dataBackup.scope.memories', 'AI 记忆'),
    description: (tf) => tf('dataBackup.scope.memoriesDesc', '助手偏好、记忆和上下文资料')
  },
  {
    key: 'investments',
    label: (tf) => tf('dataBackup.scope.investments', '投资理财'),
    description: (tf) => tf('dataBackup.scope.investmentsDesc', '投资持仓、理财目标、基金自选和 AI 基金分析记录')
  }
];

export function BackupScopeSelector({
  scope,
  onChange,
  hint
}: {
  scope: FinanceBackupScope;
  onChange: (scope: FinanceBackupScope) => void;
  hint?: string;
}) {
  const tf = useTFallback();
  const hasSelection = Object.values(scope).some(Boolean);

  return (
    <div className="database-backup-scope" aria-label={tf('dataBackup.scope.aria', '备份范围设置')}>
      <div className="database-backup-scope-head">
        <strong className="database-backup-scope-title">
          {tf('dataBackup.scope.title', '选择备份内容')}
        </strong>
        <span className="sync-tip">
          {hint ?? tf('dataBackup.scope.hint', '所有备份方式共用此范围')}
        </span>
      </div>
      <div className="database-backup-scope-list">
        {BACKUP_SCOPE_OPTIONS.map((item) => (
          <label
            key={item.key}
            className={`database-backup-scope-item${scope[item.key] ? ' is-active' : ''}`}
          >
            <input
              type="checkbox"
              checked={scope[item.key]}
              onChange={(event) =>
                onChange({
                  ...scope,
                  [item.key]: event.target.checked
                })
              }
            />
            <span className="database-backup-scope-copy">
              <strong>{item.label(tf)}</strong>
              <small>{item.description(tf)}</small>
            </span>
          </label>
        ))}
      </div>
      {!hasSelection ? (
        <p className="database-backup-scope-warning">
          {tf('dataBackup.scope.emptyWarning', '请至少勾选一个备份范围。')}
        </p>
      ) : null}
    </div>
  );
}
