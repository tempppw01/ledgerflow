import { ChangeEvent, useMemo, useRef, useState } from 'react';
import { ConnectionConfigManager } from '../../features/connection-config/ui/ConnectionConfigManager';
import {
  applyBillImportMode,
  BillImportMode,
  parseBillFileToTransactions
} from '../../shared/lib/billImport';
import { resolveImportDefaultAccountId } from '../../shared/lib/importAccount';
import {
  BackupWebdavConfig,
  createFinanceBackupPayload,
  downloadBackupJson,
  listWebdavBackupVersions,
  loadWebdavConfig,
  parseFinanceBackupPayload,
  saveWebdavConfig,
  WebdavBackupVersionItem,
  webdavDownloadBackup,
  webdavUploadBackup,
  sanitizeWebdavConfig
} from '../../shared/lib/backup';
import { useFinanceStore } from '../../shared/store/useFinanceStore';
import { useGlobalMemoryStore } from '../../shared/store/useGlobalMemoryStore';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog';
import { Toast, ToastVariant } from '../../shared/ui/Toast';

type BillSource = 'wechat' | 'alipay';

const MAX_BACKUP_FILE_SIZE_MB = 50;
const MAX_BACKUP_FILE_SIZE_BYTES = MAX_BACKUP_FILE_SIZE_MB * 1024 * 1024;
const MAX_BILL_FILE_SIZE_BYTES = 10 * 1024 * 1024;

const BACKUP_ACCEPTED_MIME_TYPES = new Set(['application/json', 'text/json']);
const BILL_ACCEPTED_EXTENSIONS = new Set(['.csv', '.txt', '.xlsx']);

function getFileExtension(fileName: string): string {
  const index = fileName.lastIndexOf('.');
  if (index < 0) return '';
  return fileName.slice(index).toLowerCase();
}

function validateBackupFile(file: File): void {
  const ext = getFileExtension(file.name);
  const hasValidMime = !file.type || BACKUP_ACCEPTED_MIME_TYPES.has(file.type);
  const hasValidExt = ext === '.json';

  if (!hasValidMime && !hasValidExt) {
    throw new Error('备份导入失败：仅支持 JSON 文件（.json）');
  }

  if (file.size > MAX_BACKUP_FILE_SIZE_BYTES) {
    throw new Error(`备份导入失败：文件过大，请上传不超过 ${MAX_BACKUP_FILE_SIZE_MB}MB 的 JSON 备份`);
  }
}

function validateBillFile(file: File): void {
  const ext = getFileExtension(file.name);
  if (!BILL_ACCEPTED_EXTENSIONS.has(ext)) {
    throw new Error('账单导入失败：仅支持 CSV/TXT/XLSX 文件');
  }

  if (file.size > MAX_BILL_FILE_SIZE_BYTES) {
    throw new Error('账单导入失败：文件过大，请上传不超过 10MB 的账单文件');
  }
}

export function DatabaseSettingsPage() {
  const hasHydrated = useFinanceStore((s) => s.hasHydrated);
  const transactions = useFinanceStore((s) => s.transactions);
  const categories = useFinanceStore((s) => s.categories);
  const accounts = useFinanceStore((s) => s.accounts);
  const subscriptions = useFinanceStore((s) => s.subscriptions);
  const trashedTransactions = useFinanceStore((s) => s.trashedTransactions);
  const trashedCategories = useFinanceStore((s) => s.trashedCategories);
  const trashedAccounts = useFinanceStore((s) => s.trashedAccounts);
  const balanceChangeEntries = useFinanceStore((s) => s.balanceChangeEntries);
  const trashedSubscriptions = useFinanceStore((s) => s.trashedSubscriptions);
  const addTransaction = useFinanceStore((s) => s.addTransaction);
  const updateTransaction = useFinanceStore((s) => s.updateTransaction);
  const addCategory = useFinanceStore((s) => s.addCategory);
  const addAccount = useFinanceStore((s) => s.addAccount);
  const replaceAllData = useFinanceStore((s) => s.replaceAllData);
  const clearAllAccountBills = useFinanceStore((s) => s.clearAllAccountBills);
  const globalMemories = useGlobalMemoryStore((s) => s.memories);
  const replaceAllGlobalMemories = useGlobalMemoryStore((s) => s.replaceAllData);

  const backupInputRef = useRef<HTMLInputElement | null>(null);
  const billInputRef = useRef<HTMLInputElement | null>(null);

  const [importSource, setImportSource] = useState<BillSource | null>(null);
  const [importMode, setImportMode] = useState<BillImportMode>('incremental');
  const [busy, setBusy] = useState(false);
  const [webdavStatus, setWebdavStatus] = useState('');
  const [toast, setToast] = useState<{ visible: boolean; variant: ToastVariant; message: string }>({
    visible: false,
    variant: 'success',
    message: ''
  });

  const [webdav, setWebdav] = useState<BackupWebdavConfig>(() => loadWebdavConfig());
  const [clearBillsOpen, setClearBillsOpen] = useState(false);
  const [webdavRestoreDialogOpen, setWebdavRestoreDialogOpen] = useState(false);
  const [webdavRestoreVersions, setWebdavRestoreVersions] = useState<WebdavBackupVersionItem[]>([]);
  const [selectedRestorePath, setSelectedRestorePath] = useState('');
  const [webdavAdvancedOpen, setWebdavAdvancedOpen] = useState(false);
  const [remoteConnectionOpen, setRemoteConnectionOpen] = useState(false);

  const totalRows = useMemo(
    () =>
      transactions.length +
      categories.length +
      accounts.length +
      subscriptions.length +
      globalMemories.length,
    [
      transactions.length,
      categories.length,
      accounts.length,
      subscriptions.length,
      globalMemories.length
    ]
  );

  const showToast = (message: string, variant: ToastVariant) => {
    setToast({ visible: true, message, variant });
  };

  const showWebdavStatus = (message: string) => {
    setWebdavStatus(message);
  };

  const ensureDefaultRefs = (source?: BillSource) => {
    const categoryId = categories[0]?.id || addCategory('默认分类');
    const fallbackAccountId = accounts[0]?.id || addAccount('默认账户', undefined, 0);
    const accountId = source
      ? resolveImportDefaultAccountId(accounts, source, fallbackAccountId)
      : fallbackAccountId;
    return { categoryId, accountId };
  };

  const handleExportJson = () => {
    const payload = createFinanceBackupPayload({
      transactions,
      categories,
      accounts,
      subscriptions,
      trashedTransactions,
      trashedCategories,
      trashedAccounts,
      balanceChangeEntries,
      trashedSubscriptions,
      globalMemories
    });
    downloadBackupJson(payload);
    showToast('备份导出成功（JSON）', 'success');
  };

  const handleBackupFileImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }

    try {
      validateBackupFile(file);
      ensureHydrated();
      const text = await file.text();
      const payload = parseFinanceBackupPayload(text);
      replaceAllData(payload.data);
      replaceAllGlobalMemories(payload.data.globalMemories);
      showToast(
        `备份导入成功：交易 ${payload.data.transactions.length} 条，分类 ${payload.data.categories.length} 条，账户 ${payload.data.accounts.length} 条，订阅 ${payload.data.subscriptions.length} 条，全局记忆 ${payload.data.globalMemories.length} 条。`,
        'success'
      );
    } catch (error) {
      showToast(error instanceof Error ? error.message : '备份导入失败', 'error');
    }
  };

  const handleImportBillFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    const source = importSource;
    event.target.value = '';
    setImportSource(null);

    if (!file || !source) {
      return;
    }

    try {
      validateBillFile(file);
      ensureHydrated();
      const refs = ensureDefaultRefs(source);
      const rows = await parseBillFileToTransactions({
        file,
        source,
        defaultCategoryId: refs.categoryId,
        defaultAccountId: refs.accountId
      });

      if (rows.length === 0) {
        showToast('未识别到可导入账单记录', 'warning');
        return;
      }

      const result = applyBillImportMode({
        mode: importMode,
        existing: transactions,
        incoming: rows
      });

      if (result.shouldClearBeforeImport) {
        clearAllAccountBills();
      }

      result.update.forEach((row) => updateTransaction(row.id, row.payload));
      result.append.forEach((row) => addTransaction(row));

      const changedCount = result.append.length + result.update.length;
      if (changedCount === 0) {
        showToast('导入完成：增量模式下未发现可新增或更新的账单', 'warning');
        return;
      }

      showToast(
        `${source === 'wechat' ? '微信' : '支付宝'}账单导入成功：新增 ${result.append.length} 条，更新 ${result.update.length} 条${result.skipped ? `，跳过 ${result.skipped} 条` : ''}`,
        'success'
      );
    } catch {
      showToast('账单导入失败：文件解析异常', 'error');
    }
  };

  const handleSaveWebdavConfig = () => {
    saveWebdavConfig(webdav);
    showToast('WebDAV 配置已保存', 'success');
  };

  const validateWebdav = () => {
    if (!webdav.endpoint.trim()) {
      throw new Error(
        webdav.proxyEnabled ? '请填写真实 WebDAV 地址（用于代理转发）' : '请填写 WebDAV 地址'
      );
    }
    if (!webdav.username.trim()) {
      throw new Error('请填写 WebDAV 用户名');
    }
    if (!webdav.password.trim()) {
      throw new Error('请填写 WebDAV 密码');
    }
    if (!webdav.remoteFilePath.trim()) {
      throw new Error('请填写远程文件路径');
    }

    try {
      sanitizeWebdavConfig(webdav);
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'WebDAV 配置不合法');
    }
  };

  const ensureHydrated = () => {
    if (!hasHydrated) {
      throw new Error('本地数据仍在加载中，请稍后重试');
    }
  };

  const handleWebdavUpload = async () => {
    try {
      ensureHydrated();
      validateWebdav();
      setBusy(true);
      showWebdavStatus('正在打包备份...');
      const payload = createFinanceBackupPayload({
        transactions,
        categories,
        accounts,
        subscriptions,
        trashedTransactions,
        trashedCategories,
        trashedAccounts,
        balanceChangeEntries,
        trashedSubscriptions,
        globalMemories
      });
      await webdavUploadBackup(webdav, payload, (stage) => {
        showWebdavStatus(stage);
      });
      saveWebdavConfig(webdav);
      showWebdavStatus('备份完成');
      showToast('WebDAV 备份成功', 'success');
    } catch (error) {
      showWebdavStatus('备份失败');
      showToast(error instanceof Error ? error.message : 'WebDAV 备份失败', 'error');
    } finally {
      setBusy(false);
      window.setTimeout(() => setWebdavStatus(''), 2400);
    }
  };

  const handleWebdavDownload = async () => {
    try {
      ensureHydrated();
      validateWebdav();
      setBusy(true);
      showWebdavStatus('拉取备份列表...');
      const versions = await listWebdavBackupVersions(webdav);
      setWebdavRestoreVersions(versions);
      setSelectedRestorePath(versions[0]?.remotePath || '');
      setWebdavRestoreDialogOpen(true);
      showWebdavStatus('已获取备份列表');
    } catch (error) {
      showWebdavStatus('获取失败');
      showToast(error instanceof Error ? error.message : 'WebDAV 下载失败', 'error');
    } finally {
      setBusy(false);
      window.setTimeout(() => setWebdavStatus(''), 2400);
    }
  };

  const handleConfirmWebdavRestore = async () => {
    try {
      ensureHydrated();
      validateWebdav();
      if (!selectedRestorePath) {
        throw new Error('请选择一个可恢复版本');
      }
      setBusy(true);
      showWebdavStatus('正在下载并恢复...');
      const payload = await webdavDownloadBackup(webdav, selectedRestorePath);
      replaceAllData(payload.data);
      replaceAllGlobalMemories(payload.data.globalMemories);
      saveWebdavConfig(webdav);
      setWebdavRestoreDialogOpen(false);
      showWebdavStatus('恢复完成');
      showToast('WebDAV 备份恢复成功', 'success');
    } catch (error) {
      showWebdavStatus('恢复失败');
      showToast(error instanceof Error ? error.message : 'WebDAV 下载失败', 'error');
    } finally {
      setBusy(false);
      window.setTimeout(() => setWebdavStatus(''), 2400);
    }
  };

  return (
    <div>
      <section className="panel">
        <h2>备份设置</h2>
        <p style={{ margin: 0 }}>
          集中处理本地备份、账单导入和 WebDAV 远程备份；远程数据库连接放在高级区域。
        </p>
      </section>

      <section className="panel database-data-hub" style={{ marginTop: 12 }}>
        <div className="database-data-hub-head">
          <div>
            <h3 style={{ marginTop: 0 }}>本地备份与账单导入</h3>
            <p className="sync-tip">
              先留一份备份，再导入新账单会更安心。这里可以保存整本账本，也可以把微信、支付宝账单一次补进来。
            </p>
          </div>
          <span className="database-data-hub-count">当前共 {totalRows} 条数据</span>
        </div>

        <div className="database-data-hub-grid">
          <div className="database-data-hub-block">
            <div>
              <span className="database-data-hub-label">完整备份</span>
              <h4>导出或恢复整本账本</h4>
            </div>
            <p className="sync-tip">
              适合换设备、批量整理前留档。交易、分类、账户、订阅和记忆都会一起保存。
            </p>
            <div className="database-data-hub-actions">
              <button type="button" className="primary" onClick={handleExportJson}>
                导出完整备份
              </button>
              <button type="button" onClick={() => backupInputRef.current?.click()}>
                导入备份文件
              </button>
              <input
                ref={backupInputRef}
                type="file"
                title="导入 JSON 备份"
                aria-label="导入 JSON 备份"
                accept="application/json,.json"
                style={{ display: 'none' }}
                onChange={handleBackupFileImport}
              />
            </div>
          </div>

          <div className="database-data-hub-block">
            <div>
              <span className="database-data-hub-label">账单导入</span>
              <h4>把微信 / 支付宝账单补进来</h4>
            </div>
            <p className="sync-tip">
              支持微信、支付宝官方账单 CSV / TXT（含制表符），以及微信 XLSX。
            </p>
            <div className="database-import-actions">
              <label className="field database-import-mode-field" style={{ marginBottom: 0 }}>
                遇到重复账单时
                <select
                  aria-label="账单导入模式"
                  value={importMode}
                  onChange={(e) => setImportMode(e.target.value as BillImportMode)}
                >
                  <option value="incremental">保留旧账单，重复但有变更时更新为最新</option>
                  <option value="merge">用新账单覆盖重复账单的导入字段</option>
                  <option value="overwrite">清空现有交易后重新导入</option>
                </select>
              </label>
              <button
                type="button"
                onClick={() => {
                  setImportSource('wechat');
                  billInputRef.current?.click();
                }}
                disabled={!hasHydrated}
              >
                导入微信账单
              </button>
              <button
                type="button"
                onClick={() => {
                  setImportSource('alipay');
                  billInputRef.current?.click();
                }}
                disabled={!hasHydrated}
              >
                导入支付宝账单
              </button>
              <input
                ref={billInputRef}
                type="file"
                title="导入账单文件"
                aria-label="导入账单文件"
                accept=".csv,text/csv,.txt,text/plain,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                style={{ display: 'none' }}
                onChange={handleImportBillFile}
              />
            </div>
          </div>
        </div>
      </section>

      <section className="panel" style={{ marginTop: 12 }}>
        <h3 style={{ marginTop: 0 }}>数据重制</h3>
        <p className="sync-tip">清空所有账户账单（交易记录），保留账户与分类。</p>
        <button type="button" className="danger" onClick={() => setClearBillsOpen(true)}>
          一键清空所有账户账单
        </button>
      </section>

      <section className="panel" style={{ marginTop: 12 }}>
        <div
          className="row"
          style={{
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 12,
            flexWrap: 'wrap'
          }}
        >
          <div>
            <h3 style={{ margin: 0 }}>WebDAV 备份</h3>
            <p className="sync-tip" style={{ margin: '6px 0 0' }}>
              用于远程备份与恢复，默认通过同源代理连接。
            </p>
          </div>
          <span className="sync-tip" style={{ whiteSpace: 'nowrap' }}>
            {webdav.proxyEnabled ? '代理已启用' : '浏览器直连'}
          </span>
        </div>

        <div className="grid grid-2" style={{ gap: 10, marginTop: 10 }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>{webdav.proxyEnabled ? '真实 WebDAV 地址' : 'WebDAV 地址'}</label>
            <input
              title={webdav.proxyEnabled ? '真实 WebDAV 地址' : 'WebDAV 地址'}
              placeholder="https://dav.example.com/remote.php/dav/files/user"
              value={webdav.endpoint}
              onChange={(e) => setWebdav((prev) => ({ ...prev, endpoint: e.target.value }))}
            />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>远程文件路径</label>
            <input
              title="远程文件路径"
              placeholder="ledgerflow/backup.json"
              value={webdav.remoteFilePath}
              onChange={(e) => setWebdav((prev) => ({ ...prev, remoteFilePath: e.target.value }))}
            />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>用户名</label>
            <input
              title="WebDAV 用户名"
              placeholder="请输入用户名"
              value={webdav.username}
              onChange={(e) => setWebdav((prev) => ({ ...prev, username: e.target.value }))}
            />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>密码</label>
            <input
              title="WebDAV 密码"
              placeholder="请输入密码"
              type="password"
              value={webdav.password}
              onChange={(e) => setWebdav((prev) => ({ ...prev, password: e.target.value }))}
            />
          </div>
        </div>

        <div style={{ marginTop: 10 }}>
          <button type="button" onClick={() => setWebdavAdvancedOpen((prev) => !prev)}>
            {webdavAdvancedOpen ? '收起高级选项' : '展开高级选项'}
          </button>
        </div>

        {webdavAdvancedOpen ? (
          <div className="grid grid-2" style={{ gap: 10, marginTop: 10 }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={webdav.proxyEnabled}
                  onChange={(e) =>
                    setWebdav((prev) => ({ ...prev, proxyEnabled: e.target.checked }))
                  }
                />
                启用同源代理
              </label>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>保留版本数</label>
              <input
                title="保留版本数"
                type="number"
                min={1}
                max={50}
                value={webdav.retainedVersions}
                onChange={(e) =>
                  setWebdav((prev) => ({ ...prev, retainedVersions: Number(e.target.value) || 1 }))
                }
              />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>代理入口路径</label>
              <input
                title="代理入口路径"
                placeholder="/api/webdav"
                value={webdav.proxyBasePath}
                onChange={(e) => setWebdav((prev) => ({ ...prev, proxyBasePath: e.target.value }))}
                disabled={!webdav.proxyEnabled}
              />
            </div>
          </div>
        ) : null}

        <p className="sync-tip" style={{ margin: '10px 0 0' }}>
          {webdav.proxyEnabled ? '当前：同源代理已启用。' : '当前：浏览器直连，可能受跨域限制。'}
        </p>

        <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <button type="button" onClick={handleSaveWebdavConfig} disabled={busy}>
            保存
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => void handleWebdavUpload()}
            disabled={busy}
          >
            立即备份
          </button>
          <button type="button" onClick={() => void handleWebdavDownload()} disabled={busy}>
            恢复备份
          </button>
          {webdavStatus ? <span className="sync-tip">{webdavStatus}</span> : null}
        </div>
      </section>

      <section className="panel" style={{ marginTop: 12 }}>
        <div
          className="row"
          style={{
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 12,
            flexWrap: 'wrap'
          }}
        >
          <div>
            <h3 style={{ marginTop: 0, marginBottom: 0 }}>远程数据库连接（高级）</h3>
            <p className="sync-tip" style={{ margin: '6px 0 0' }}>
              可选保存 MySQL / Redis 连接参数，不影响本地账本，也不会覆盖 WebDAV 备份。
            </p>
          </div>
          <button type="button" onClick={() => setRemoteConnectionOpen((prev) => !prev)}>
            {remoteConnectionOpen ? '收起连接配置' : '展开连接配置'}
          </button>
        </div>
        {remoteConnectionOpen ? <ConnectionConfigManager /> : null}
      </section>

      {webdavRestoreDialogOpen ? (
        <div
          className="dialog-overlay"
          role="presentation"
          onClick={() => setWebdavRestoreDialogOpen(false)}
        >
          <section
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-label="选择 WebDAV 恢复版本"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="dialog-header">选择要恢复的 WebDAV 备份版本</header>
            <div className="dialog-body">
              <div className="webdav-restore-list">
                {webdavRestoreVersions.map((item) => (
                  <label className="webdav-restore-item" key={item.remotePath}>
                    <input
                      type="radio"
                      name="webdav-restore-version"
                      checked={selectedRestorePath === item.remotePath}
                      onChange={() => setSelectedRestorePath(item.remotePath)}
                    />
                    <span className="webdav-restore-item-copy">
                      <strong>
                        {item.label}
                        {item.isLatest ? '（最新）' : ''}
                      </strong>
                      <small>{item.fileName}</small>
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <footer className="dialog-footer">
              <button type="button" onClick={() => setWebdavRestoreDialogOpen(false)}>
                取消
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => void handleConfirmWebdavRestore()}
                disabled={busy || !selectedRestorePath}
              >
                恢复所选版本
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      <Toast
        visible={toast.visible}
        variant={toast.variant}
        message={toast.message}
        onClose={() => setToast((prev) => ({ ...prev, visible: false }))}
      />

      <ConfirmDialog
        open={clearBillsOpen}
        title="确认清空账单"
        description={`将清空全部 ${transactions.length} 条交易，账户余额会按初始值重算。此操作不可恢复。`}
        confirmText="确认清空"
        cancelText="取消"
        danger
        onCancel={() => setClearBillsOpen(false)}
        onConfirm={() => {
          clearAllAccountBills();
          setClearBillsOpen(false);
          showToast('已清空所有账户账单', 'success');
        }}
      />
    </div>
  );
}
