import type { FinanceBackupScope } from '../../../shared/lib/backup';
import { useTFallback, type TfFallback } from '../../../shared/lib/useTFallback';

const BACKUP_SCOPE_OPTIONS: Array<{
  key: keyof FinanceBackupScope;
  label: (tf: TfFallback) => string;
}> = [
  {
    key: 'ledger',
    label: (tf) => tf('dataBackup.scope.ledger', '账本数据')
  },
  {
    key: 'subscriptions',
    label: (tf) => tf('dataBackup.scope.subscriptions', '订阅数据')
  },
  {
    key: 'globalMemories',
    label: (tf) => tf('dataBackup.scope.memories', 'AI 记忆')
  },
  {
    key: 'investments',
    label: (tf) => tf('dataBackup.scope.investments', '投资理财')
  },
  {
    // 负债与还款记录此前不在备份范围内(换设备后静默丢失)。
    key: 'debts',
    label: (tf) => tf('dataBackup.scope.debts', '负债与还款')
  }
];

export function BackupScopeSelector({
  scope,
  onChange
}: {
  scope: FinanceBackupScope;
  onChange: (scope: FinanceBackupScope) => void;
}) {
  const tf = useTFallback();
  const hasSelection = Object.values(scope).some(Boolean);

  return (
    <div className="database-backup-scope" aria-label={tf('dataBackup.scope.aria', '备份范围设置')}>
      <div className="database-backup-scope-head">
        <strong className="database-backup-scope-title">
          {tf('dataBackup.scope.title', '选择备份内容')}
        </strong>
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
