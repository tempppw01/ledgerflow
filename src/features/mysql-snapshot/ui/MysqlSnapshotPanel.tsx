import { useMemo, useState } from 'react';
import { useTFallback, type TfFallback } from '../../../shared/lib/useTFallback';
import type { FinanceBackupPayload, FinanceBackupScope } from '../../../shared/lib/backup';
import {
  downloadLatestMysqlSnapshot,
  uploadMysqlSnapshot,
  type MysqlSnapshotRecord
} from '../../../shared/api/mysqlSnapshotClient';
import { ConfirmDialog } from '../../../shared/ui/ConfirmDialog';
import { PasswordInput } from '../../../shared/ui/PasswordInput';
import { BACKUP_ICON_URL, RESTORE_ICON_URL } from '../../../shared/config/brandAssets';
import { BackupScopeSelector } from '../../backup/ui/BackupScopeSelector';

interface MysqlSnapshotPanelProps {
  disabled: boolean;
  canCreateBackup: boolean;
  backupScopeSummary: string;
  backupScope: FinanceBackupScope;
  onBackupScopeChange: (scope: FinanceBackupScope) => void;
  apiToken: string;
  onApiTokenChange: (value: string) => void;
  createPayload: () => FinanceBackupPayload;
  onRestore: (payload: FinanceBackupPayload) => Promise<void> | void;
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0 KB';
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(2)} MB`;
}

function formatTime(value: string | null | undefined, tf: TfFallback) {
  if (!value) return tf('dataBackup.snapshot.noRecord', '暂无记录');
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export function MysqlSnapshotPanel({
  disabled,
  canCreateBackup,
  backupScopeSummary,
  backupScope,
  onBackupScopeChange,
  apiToken,
  onApiTokenChange,
  createPayload,
  onRestore
}: MysqlSnapshotPanelProps) {
  const tf = useTFallback();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [lastSnapshot, setLastSnapshot] = useState<MysqlSnapshotRecord | null>(null);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [technicalOptionsOpen, setTechnicalOptionsOpen] = useState(false);

  const summary = useMemo(() => {
    if (!lastSnapshot) return tf('dataBackup.snapshot.notRead', '尚未读取数据库快照');
    return `${formatTime(lastSnapshot.createdAt, tf)} · ${formatBytes(lastSnapshot.payloadBytes)}`;
  }, [lastSnapshot, tf]);

  async function handleUpload() {
    if (!canCreateBackup) {
      setStatus(tf('dataBackup.snapshot.scopeRequired', '请至少选择一个备份范围。'));
      return;
    }
    try {
      setBusy(true);
      setStatus(tf('dataBackup.snapshot.creating', '正在生成快照...'));
      const payload = createPayload();
      const response = await uploadMysqlSnapshot({
        payload,
        schemaVersion: 1,
        source: 'manual',
        apiToken
      });
      setLastSnapshot({
        id: response.id,
        userId: response.userId,
        schemaVersion: response.schemaVersion,
        payload,
        checksum: response.checksum,
        payloadBytes: response.payloadBytes,
        source: 'manual',
        exportedAt: response.exportedAt,
        createdAt: new Date().toISOString()
      });
      setStatus(
        tf('dataBackup.snapshot.synced', '已同步到数据库：{size}').replace(
          '{size}',
          String(formatBytes(response.payloadBytes))
        )
      );
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : tf('dataBackup.snapshot.syncFailed', '同步到数据库失败')
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleLoadLatest() {
    try {
      setBusy(true);
      setStatus(tf('dataBackup.snapshot.reading', '正在读取数据库最新快照...'));
      const response = await downloadLatestMysqlSnapshot('default', apiToken);
      if (!response.ok || !response.snapshot) {
        setStatus(response.message || tf('dataBackup.snapshot.noneInDb', '数据库中还没有快照。'));
        return;
      }
      setLastSnapshot(response.snapshot);
      setRestoreOpen(true);
      setStatus(tf('dataBackup.snapshot.readDone', '已读取最新数据库快照，请确认后恢复。'));
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : tf('dataBackup.snapshot.readFailed', '读取数据库快照失败')
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmRestore() {
    if (!lastSnapshot) return;
    await onRestore(lastSnapshot.payload);
    setRestoreOpen(false);
    setStatus(tf('dataBackup.snapshot.restored', '已从数据库快照恢复到本地。'));
  }

  return (
    <section className="panel database-remote-backup-card" style={{ marginTop: 12 }}>
      <div className="database-remote-backup-head">
        <div>
          <div className="row" style={{ gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0 }}>{tf('dataBackup.snapshot.title', '手动恢复点')}</h3>
            <span className="sync-tip" style={{ whiteSpace: 'nowrap' }}>
              {summary}
            </span>
          </div>
        </div>
      </div>

      <div className="database-remote-backup-body">
        <p className="sync-tip" style={{ margin: '0 0 10px' }}>
          {tf('dataBackup.snapshot.scopePrefix', '恢复点将保存:')}
          {backupScopeSummary}
        </p>
        <BackupScopeSelector scope={backupScope} onChange={onBackupScopeChange} />
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="primary button-with-icon"
            onClick={() => void handleUpload()}
            disabled={disabled || busy || !canCreateBackup}
          >
            <img src={BACKUP_ICON_URL} alt="" aria-hidden="true" />
            {tf('dataBackup.snapshot.create', '创建恢复点')}
          </button>
          <button
            type="button"
            className="button-with-icon"
            onClick={() => void handleLoadLatest()}
            disabled={disabled || busy}
          >
            <img src={RESTORE_ICON_URL} alt="" aria-hidden="true" />
            {tf('dataBackup.snapshot.restoreLatest', '恢复最近副本')}
          </button>
          {status ? <span className="sync-tip">{status}</span> : null}
        </div>
        <div className="database-technical-options">
          <button
            type="button"
            className="database-technical-options-toggle"
            aria-expanded={technicalOptionsOpen}
            onClick={() => setTechnicalOptionsOpen((current) => !current)}
          >
            {technicalOptionsOpen
              ? tf('dataBackup.snapshot.hideAdvanced', '收起技术设置')
              : tf('dataBackup.snapshot.advanced', '技术设置')}
          </button>
          {technicalOptionsOpen ? (
            <div className="field" style={{ marginBottom: 0 }}>
              <label>{tf('dataBackup.snapshot.token', '服务访问令牌')}</label>
              <PasswordInput
                value={apiToken}
                placeholder={tf(
                  'dataBackup.snapshot.tokenPlaceholder',
                  tf('dataBackup.snapshot.tokenPlaceholder', '仅远程 MySQL 服务需要')
                )}
                onChange={(event) => onApiTokenChange(event.target.value)}
                showLabel={tf('dataBackup.snapshot.show', '显示')}
                hideLabel={tf('dataBackup.snapshot.hide', '隐藏')}
              />
              <small className="sync-tip">
                {tf(
                  'dataBackup.snapshot.tokenHint',
                  '本机 SQLite 无需填写。远程部署可由管理员提供该令牌。'
                )}
              </small>
            </div>
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={restoreOpen}
        title={tf('dataBackup.snapshot.confirmTitle', '确认从数据库恢复')}
        description={
          <div>
            <p style={{ marginTop: 0 }}>
              {tf(
                'dataBackup.snapshot.confirmBody',
                '将用数据库最新快照覆盖当前本地数据。建议确认已经导出本地备份后再继续。'
              )}
            </p>
            <p className="sync-tip" style={{ marginBottom: 0 }}>
              {tf('dataBackup.snapshot.timeLabel', ' 快照时间：')}
              {formatTime(lastSnapshot?.createdAt, tf)}
              {tf('dataBackup.snapshot.sizeLabel', ' · 大小： ')}
              {formatBytes(lastSnapshot?.payloadBytes || 0)}
            </p>
          </div>
        }
        confirmText={tf('dataBackup.snapshot.confirmOk', '确认恢复')}
        cancelText={tf('dataBackup.snapshot.cancel', '取消')}
        danger
        onConfirm={handleConfirmRestore}
        onCancel={() => setRestoreOpen(false)}
      />
    </section>
  );
}
