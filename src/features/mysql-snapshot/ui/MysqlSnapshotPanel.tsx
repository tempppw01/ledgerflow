import { useMemo, useState } from 'react';
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
  onRestore: (payload: FinanceBackupPayload) => void;
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0 KB';
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(2)} MB`;
}

function formatTime(value?: string | null) {
  if (!value) return '暂无记录';
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
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [lastSnapshot, setLastSnapshot] = useState<MysqlSnapshotRecord | null>(null);
  const [restoreOpen, setRestoreOpen] = useState(false);

  const summary = useMemo(() => {
    if (!lastSnapshot) return '尚未读取数据库快照';
    return `${formatTime(lastSnapshot.createdAt)} · ${formatBytes(lastSnapshot.payloadBytes)}`;
  }, [lastSnapshot]);

  async function handleUpload() {
    if (!canCreateBackup) {
      setStatus('请至少选择一个备份范围。');
      return;
    }
    if (!apiToken.trim()) {
      setStatus('请先填写数据库快照 API 令牌。');
      return;
    }

    try {
      setBusy(true);
      setStatus('正在生成快照...');
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
      setStatus(`已同步到数据库：${formatBytes(response.payloadBytes)}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '同步到数据库失败');
    } finally {
      setBusy(false);
    }
  }

  async function handleLoadLatest() {
    if (!apiToken.trim()) {
      setStatus('请先填写数据库快照 API 令牌。');
      return;
    }

    try {
      setBusy(true);
      setStatus('正在读取数据库最新快照...');
      const response = await downloadLatestMysqlSnapshot('default', apiToken);
      if (!response.ok || !response.snapshot) {
        setStatus(response.message || '数据库中还没有快照。');
        return;
      }
      setLastSnapshot(response.snapshot);
      setRestoreOpen(true);
      setStatus('已读取最新数据库快照，请确认后恢复。');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '读取数据库快照失败');
    } finally {
      setBusy(false);
    }
  }

  function handleConfirmRestore() {
    if (!lastSnapshot) return;
    onRestore(lastSnapshot.payload);
    setRestoreOpen(false);
    setStatus('已从数据库快照恢复到本地。');
  }

  return (
    <section className="panel database-remote-backup-card" style={{ marginTop: 12 }}>
      <div className="database-remote-backup-head">
        <div>
          <div className="row" style={{ gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0 }}>数据库快照同步</h3>
            <span className="sync-tip" style={{ whiteSpace: 'nowrap' }}>
              {summary}
            </span>
          </div>
          <p className="sync-tip" style={{ margin: '6px 0 0' }}>
            先把当前 JSON 备份原样写入已选数据库，恢复前会校验快照完整性。
          </p>
        </div>
      </div>

      <div className="database-remote-backup-body">
        <p className="sync-tip" style={{ margin: '0 0 10px' }}>
          当前备份范围：{backupScopeSummary}
        </p>
        <BackupScopeSelector scope={backupScope} onChange={onBackupScopeChange} />
        <div className="field" style={{ marginBottom: 10 }}>
          <label>API 令牌</label>
          <PasswordInput
            value={apiToken}
            placeholder="与服务端 LEDGERFLOW_API_TOKEN 保持一致"
            onChange={(event) => {
              onApiTokenChange(event.target.value);
            }}
            showLabel="显示"
            hideLabel="隐藏"
          />
          <small className="sync-tip">令牌只保存在当前浏览器，用于保护数据库快照读写接口。</small>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="primary button-with-icon"
            onClick={() => void handleUpload()}
            disabled={disabled || busy || !canCreateBackup}
          >
            <img src={BACKUP_ICON_URL} alt="" aria-hidden="true" />
            同步到数据库
          </button>
          <button
            type="button"
            className="button-with-icon"
            onClick={() => void handleLoadLatest()}
            disabled={disabled || busy}
          >
            <img src={RESTORE_ICON_URL} alt="" aria-hidden="true" />
            从数据库恢复
          </button>
          {status ? <span className="sync-tip">{status}</span> : null}
        </div>
      </div>

      <ConfirmDialog
        open={restoreOpen}
        title="确认从数据库恢复"
        description={
          <div>
            <p style={{ marginTop: 0 }}>
              将用数据库最新快照覆盖当前本地数据。建议确认已经导出本地备份后再继续。
            </p>
            <p className="sync-tip" style={{ marginBottom: 0 }}>
              快照时间：{formatTime(lastSnapshot?.createdAt)} · 大小：
              {formatBytes(lastSnapshot?.payloadBytes || 0)}
            </p>
          </div>
        }
        confirmText="确认恢复"
        cancelText="取消"
        danger
        onConfirm={handleConfirmRestore}
        onCancel={() => setRestoreOpen(false)}
      />
    </section>
  );
}
