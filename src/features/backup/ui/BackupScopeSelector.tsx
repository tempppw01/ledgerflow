import type { FinanceBackupScope } from '../../../shared/lib/backup';
import { useTFallback } from '../../../shared/lib/useTFallback';

const BACKUP_SCOPE_OPTIONS: Array<{
  key: keyof FinanceBackupScope;
  label: string;
  labelKey: string;
  description: string;
  descriptionKey: string;
}> = [
  {
    key: 'ledger',
    label: '账本数据',
    description: '交易、分类、账户、回收站和余额记录',
    labelKey: 'dataBackup.scope.ledger',
    descriptionKey: 'dataBackup.scope.ledgerDesc'
  },
  {
    key: 'subscriptions',
    label: '订阅数据',
    description: '订阅项目和已归档订阅',
    labelKey: 'dataBackup.scope.subscriptions',
    descriptionKey: 'dataBackup.scope.subscriptionsDesc'
  },
  {
    key: 'globalMemories',
    label: 'AI 记忆',
    description: '助手偏好、记忆和上下文资料',
    labelKey: 'dataBackup.scope.memories',
    descriptionKey: 'dataBackup.scope.memoriesDesc'
  },
  {
    key: 'investments',
    label: '投资理财',
    description: '投资持仓、理财目标、基金自选和 AI 基金分析记录',
    labelKey: 'dataBackup.scope.investments',
    descriptionKey: 'dataBackup.scope.investmentsDesc'
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
              <strong>{tf(item.labelKey, item.label)}</strong>
              <small>{tf(item.descriptionKey, item.description)}</small>
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
