import type { FinanceBackupScope } from '../../../shared/lib/backup';

const BACKUP_SCOPE_OPTIONS: Array<{
  key: keyof FinanceBackupScope;
  label: string;
  description: string;
}> = [
  {
    key: 'ledger',
    label: '账本数据',
    description: '交易、分类、账户、回收站和余额记录'
  },
  {
    key: 'subscriptions',
    label: '订阅数据',
    description: '订阅项目和已归档订阅'
  },
  {
    key: 'globalMemories',
    label: 'AI 记忆',
    description: '助手偏好、记忆和上下文资料'
  },
  {
    key: 'investments',
    label: '投资理财',
    description: '投资持仓、理财目标、基金自选和 AI 基金分析记录'
  }
];

export const BACKUP_SCOPE_LABELS = Object.fromEntries(
  BACKUP_SCOPE_OPTIONS.map((item) => [item.key, item.label])
) as Record<keyof FinanceBackupScope, string>;

export function BackupScopeSelector({
  scope,
  onChange,
  hint = '所有备份方式共用此范围'
}: {
  scope: FinanceBackupScope;
  onChange: (scope: FinanceBackupScope) => void;
  hint?: string;
}) {
  const hasSelection = Object.values(scope).some(Boolean);

  return (
    <div className="database-backup-scope" aria-label="备份范围设置">
      <div className="database-backup-scope-head">
        <strong className="database-backup-scope-title">选择备份内容</strong>
        <span className="sync-tip">{hint}</span>
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
              <strong>{item.label}</strong>
              <small>{item.description}</small>
            </span>
          </label>
        ))}
      </div>
      {!hasSelection ? (
        <p className="database-backup-scope-warning">请至少勾选一个备份范围。</p>
      ) : null}
    </div>
  );
}
