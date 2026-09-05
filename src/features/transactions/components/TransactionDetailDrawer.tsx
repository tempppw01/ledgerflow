import { ReactNode, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  TransactionAttachmentItem,
  TransactionItem,
  TransactionSource,
  TransactionStatus
} from '../../../entities/transaction/types';
import { formatCurrency, formatDateTime } from '../../../shared/lib/format';
import { buildA4PrintBaseStyles, buildA4PrintSheetStyles } from '../../../shared/lib/printStyles';
import {
  ALIPAY_LOGO_URL,
  LANDMARK_ICON_URL,
  PEN_TOOL_ICON_URL,
  WECHAT_LOGO_URL
} from '../../../shared/config/brandAssets';
import {
  loadWebdavConfig,
  sanitizeWebdavConfig,
  webdavUploadFile
} from '../../../shared/lib/backup';

const STATUS_LABELS: Record<TransactionStatus, string> = {
  pending: '待处理',
  completed: '已完成',
  refunded: '已退款',
  closed: '已关闭',
  failed: '失败'
};

function statusLabel(status: TransactionStatus): string {
  return STATUS_LABELS[status] || status;
}

function sourceLabel(source: TransactionSource): string {
  if (source === 'ai') return 'AI 记账';
  if (source === 'wechat') return '微信导入';
  if (source === 'alipay') return '支付宝';
  return '手工录入';
}

export type TransactionDetailSectionKey = 'base' | 'source' | 'note' | 'tags' | 'json';
const ALIPAY_ACCOUNT_PATTERN = /(支付宝|alipay)/i;
const WECHAT_ACCOUNT_PATTERN = /(微信|wechat|weixin)/i;
const BANK_ACCOUNT_PATTERN =
  /(银行|bank|信用卡|储蓄卡|借记卡|icbc|abc|ccb|boc|cmb|psbc|交通银行|招商银行|建设银行|工商银行|农业银行|中国银行)/i;

function isAlipayAccountName(name: string): boolean {
  return ALIPAY_ACCOUNT_PATTERN.test(name);
}

function isWechatAccountName(name: string): boolean {
  return WECHAT_ACCOUNT_PATTERN.test(name);
}

function isBankAccountName(name: string): boolean {
  return BANK_ACCOUNT_PATTERN.test(name);
}

function AlipayBrandIcon() {
  return (
    <img
      className="alipay-icon"
      src={ALIPAY_LOGO_URL}
      alt=""
      width="16"
      height="16"
      aria-hidden="true"
    />
  );
}

function WechatBrandIcon() {
  return (
    <img
      className="wechat-icon"
      src={WECHAT_LOGO_URL}
      alt=""
      width="16"
      height="16"
      aria-hidden="true"
    />
  );
}

function BankBrandIcon() {
  return (
    <img
      className="bank-icon"
      src={LANDMARK_ICON_URL}
      alt=""
      width="16"
      height="16"
      aria-hidden="true"
    />
  );
}

function renderAccountLabel(accountName: string): ReactNode {
  if (!isAlipayAccountName(accountName) && !isWechatAccountName(accountName) && !isBankAccountName(accountName)) {
    return accountName;
  }

  return (
    <span className="transaction-account-with-icon">
      {isAlipayAccountName(accountName) ? <AlipayBrandIcon /> : null}
      {isWechatAccountName(accountName) ? <WechatBrandIcon /> : null}
      {isBankAccountName(accountName) ? <BankBrandIcon /> : null}
      <span>{accountName}</span>
    </span>
  );
}

function renderTypeLabel(type: TransactionItem['type']) {
  if (type === 'income' || type === 'expense') {
    return (
      <span
        className={`transaction-type-badge transaction-type-badge-${type}`}
        aria-label={type === 'income' ? '收入' : '支出'}
      >
        {type === 'income' ? '收' : '支'}
      </span>
    );
  }

  return type === 'budget' ? '预算' : '还款';
}

function maskAmount(): string {
  return '¥••••';
}

function maskMerchant(value: string): string {
  if (!value) return '-';
  if (value.length <= 2) return '••';
  if (value.length <= 6) return `${value.slice(0, 1)}•••${value.slice(-1)}`;
  return `${value.slice(0, 2)}***${value.slice(-2)}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildAbnormalAlert(input: TransactionItem): { title: string; detail: string } | null {
  const amount = Number(input.amount) || 0;
  if (input.type !== 'expense' || amount < 500) return null;
  return {
    title: '金额异常提醒',
    detail: `该笔支出（${formatCurrency(amount)}）显著偏高，建议检查是否重复记账，或确认是否为一次性大额消费。`
  };
}

function isWebdavReady() {
  try {
    const config = sanitizeWebdavConfig(loadWebdavConfig());
    return Boolean(config.endpoint && config.username && config.password && config.remoteFilePath);
  } catch {
    return false;
  }
}

function sanitizeAttachmentFileName(name: string): string {
  return (
    name
      .replace(/[\\/:*?"<>|\s]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'attachment'
  );
}

function buildAttachmentRemotePath(transaction: TransactionItem, file: File): string {
  const config = loadWebdavConfig();
  const baseFolder = String(config.remoteFilePath || 'ledgerflow/backup.json')
    .split('/')
    .slice(0, -1)
    .join('/');
  const ext = file.name.includes('.') ? file.name.split('.').pop() : '';
  const safeName = sanitizeAttachmentFileName(file.name.replace(/\.[^.]+$/, ''));
  const finalName = `${transaction.id}-${Date.now()}-${safeName}${ext ? `.${ext}` : ''}`;
  return `${baseFolder || 'ledgerflow'}/attachments/${transaction.id}/${finalName}`;
}

function buildPrintStyles(): string {
  return `
    ${buildA4PrintBaseStyles({
      margin: '12mm',
      bodyBackground: '#ffffff',
      bodyColor: '#0f172a',
      fontFamily:
        "'MiSans Ledger', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans SC', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    })}

    ${buildA4PrintSheetStyles({
      bodyFontSize: '12px',
      bodyLineHeight: '1.6',
      sheetBackground: '#ffffff',
      sheetBorder: '1px solid #dbe3f0',
      sheetRadius: '10px',
      sheetPadding: '14mm',
      sheetShadow: 'none',
      printSheetPadding: '0'
    })}

    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
      border-bottom: 1px solid #e2e8f0;
      padding-bottom: 10px;
      margin-bottom: 12px;
    }

    .title {
      margin: 0;
      font-size: 18px;
      font-weight: 700;
    }

    .sub {
      margin: 4px 0 0;
      color: #64748b;
      font-size: 11px;
    }

    .amount {
      text-align: right;
      font-size: 20px;
      font-weight: 700;
      white-space: nowrap;
    }

    .amount.income {
      color: #16a34a;
    }

    .amount.expense {
      color: #dc2626;
    }

    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px 14px;
      margin-bottom: 12px;
    }

    .kv {
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 8px 10px;
      background: #f8fafc;
    }

    .kv label {
      display: block;
      color: #64748b;
      font-size: 11px;
      margin-bottom: 2px;
    }

    .kv strong {
      font-weight: 600;
      color: #0f172a;
      word-break: break-word;
    }

    .section {
      margin-top: 12px;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 10px;
      background: #fff;
    }

    .section h3 {
      margin: 0 0 8px;
      font-size: 13px;
    }

    .section p {
      margin: 0;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .tags {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .tag {
      border: 1px solid #c7d2fe;
      color: #1d4ed8;
      background: #eff6ff;
      border-radius: 999px;
      padding: 2px 8px;
      font-size: 11px;
    }

    .footer {
      margin-top: 16px;
      color: #94a3b8;
      font-size: 10px;
      text-align: right;
    }
  `;
}

interface TransactionDetailDrawerProps {
  open: boolean;
  transaction: TransactionItem | null;
  categoryName: string;
  accountName: string;
  source: TransactionSource;
  relatedOrigin?: TransactionItem | null;
  relatedRefunds?: TransactionItem[];
  onClose: () => void;
  onCopyNote: () => void;
  onCopyJson: () => void;
  onShareBill: () => void;
  onDelete: () => void;
  onRefund?: () => void;
  onAiRecategorize: () => void;
  onAttachmentUploaded?: (attachment: TransactionAttachmentItem) => void;
  onAttachmentUploadStatus?: (message: string, tone: 'success' | 'error' | 'warning') => void;
  aiRecategorizing?: boolean;
  privacyMode?: boolean;
  visibleSections: Record<TransactionDetailSectionKey, boolean>;
  onToggleSection: (key: TransactionDetailSectionKey) => void;
  onQuickAdd: () => void;
}

export function TransactionDetailDrawer({
  open,
  transaction,
  categoryName,
  accountName,
  source,
  relatedOrigin = null,
  relatedRefunds = [],
  onClose,
  onCopyNote,
  onCopyJson,
  onShareBill,
  onDelete,
  onRefund,
  onAiRecategorize,
  onAttachmentUploaded,
  onAttachmentUploadStatus,
  aiRecategorizing = false,
  privacyMode = false,
  visibleSections: _visibleSections,
  onToggleSection: _onToggleSection,
  onQuickAdd
}: TransactionDetailDrawerProps) {
  const [attachmentUploading, setAttachmentUploading] = useState(false);
  const [drawerHeight, setDrawerHeight] = useState<number | null>(null);
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const resizeStateRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleAttachmentSelect = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !transaction) {
      return;
    }

    if (!isWebdavReady()) {
      onAttachmentUploadStatus?.(
        '当前未完成 WebDAV 配置，请先去数据库 / WebDAV 设置页完成配置。',
        'warning'
      );
      return;
    }

    try {
      setAttachmentUploading(true);
      const config = sanitizeWebdavConfig(loadWebdavConfig());
      const remotePath = buildAttachmentRemotePath(transaction, file);
      const result = await webdavUploadFile(config, remotePath, file, file.type || undefined);
      onAttachmentUploaded?.({
        id: `att-${Date.now()}`,
        name: file.name,
        uploadedAt: new Date().toISOString(),
        remotePath: result.remotePath,
        mimeType: file.type || undefined,
        size: file.size
      });
      onAttachmentUploadStatus?.('附件已上传并关联到账单详情。', 'success');
    } catch (error) {
      onAttachmentUploadStatus?.(
        error instanceof Error ? error.message : '附件上传失败，请稍后重试。',
        'error'
      );
    } finally {
      setAttachmentUploading(false);
    }
  };

  const triggerAttachmentSelect = () => {
    if (!isWebdavReady()) {
      onAttachmentUploadStatus?.(
        '当前未完成 WebDAV 配置，请先去数据库 / WebDAV 设置页完成配置。',
        'warning'
      );
      return;
    }
    fileInputRef.current?.click();
  };

  const handlePrint = () => {
    if (!transaction) {
      return;
    }

    const printWindow = window.open('', '_blank', 'noopener,noreferrer,width=980,height=760');
    if (!printWindow) {
      return;
    }

    const amountText = `${transaction.type === 'income' ? '+' : '-'}${formatCurrency(transaction.amount)}`;
    const typeText =
      transaction.type === 'income'
        ? '收入'
        : transaction.type === 'expense'
          ? '支出'
          : transaction.type === 'budget'
            ? '预算'
            : '还款';

    const statusText = transaction.status ? statusLabel(transaction.status) : '—';
    const noteText = transaction.note?.trim() || '（无）';
    const tagsHtml =
      transaction.tags.length > 0
        ? transaction.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('')
        : '<span>（无）</span>';

    const html = `
      <!doctype html>
      <html lang="zh-CN">
        <head>
          <meta charset="utf-8" />
          <title>账单详情打印 - ${escapeHtml(transaction.id)}</title>
          <style>${buildPrintStyles()}</style>
        </head>
        <body>
          <main class="sheet">
            <header class="header">
              <div>
                <h1 class="title">账单详情</h1>
                <p class="sub">交易编号：${escapeHtml(transaction.id)}</p>
              </div>
              <div class="amount ${transaction.type === 'income' ? 'income' : 'expense'}">${escapeHtml(amountText)}</div>
            </header>

            <section class="grid">
              <div class="kv"><label>日期时间</label><strong>${escapeHtml(formatDateTime(transaction.date))}</strong></div>
              <div class="kv"><label>最后修改</label><strong>${escapeHtml(formatDateTime(transaction.updatedAt || transaction.date))}</strong></div>
              <div class="kv"><label>类型</label><strong>${escapeHtml(typeText)}</strong></div>
              <div class="kv"><label>分类</label><strong>${escapeHtml(categoryName)}</strong></div>
              <div class="kv"><label>账户</label><strong>${escapeHtml(accountName)}</strong></div>
              <div class="kv"><label>来源</label><strong>${escapeHtml(sourceLabel(source))}</strong></div>
              <div class="kv"><label>交易状态</label><strong>${escapeHtml(statusText)}</strong></div>
              <div class="kv"><label>订单号</label><strong>${escapeHtml(transaction.orderNo || '—')}</strong></div>
              <div class="kv"><label>商家订单号</label><strong>${escapeHtml(transaction.merchantOrderNo || '—')}</strong></div>
            </section>

            <section class="section">
              <h3>备注</h3>
              <p>${escapeHtml(noteText)}</p>
            </section>

            <section class="section">
              <h3>标签</h3>
              <div class="tags">${tagsHtml}</div>
            </section>

            <footer class="footer">打印时间：${escapeHtml(new Date().toLocaleString('zh-CN', { hour12: false }))}</footer>
          </main>
        </body>
      </html>
    `;

    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };

  useEffect(() => {
    if (!open) return;
    setDrawerHeight(null);
  }, [open, transaction?.id]);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const state = resizeStateRef.current;
      if (!state) return;
      const minHeight = Math.min(420, Math.round(window.innerHeight * 0.42));
      const maxHeight = Math.round(window.innerHeight - 24);
      const next = state.startHeight + (state.startY - event.clientY);
      setDrawerHeight(Math.min(maxHeight, Math.max(minHeight, next)));
    };

    const stopResize = () => {
      resizeStateRef.current = null;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', stopResize);
    window.addEventListener('pointercancel', stopResize);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', stopResize);
      window.removeEventListener('pointercancel', stopResize);
      stopResize();
    };
  }, []);

  const handleResizeStart = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!drawerRef.current) return;
    resizeStateRef.current = {
      startY: event.clientY,
      startHeight: drawerRef.current.getBoundingClientRect().height
    };
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'ns-resize';
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  if (!open || !transaction) return null;

  const abnormalAlert = buildAbnormalAlert(transaction);
  const isRefundOrReversal =
    transaction.adjustmentKind === 'refund' || transaction.adjustmentKind === 'reversal';
  const hasMoreInformation = Boolean(
    transaction.orderNo ||
      transaction.merchantOrderNo ||
      transaction.tags.length ||
      transaction.attachments?.length ||
      isRefundOrReversal ||
      relatedRefunds.length
  );

  return (
    <div className="drawer-overlay" role="presentation" onClick={onClose}>
      <aside
        ref={drawerRef}
        className="drawer-panel transaction-detail-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="交易详情"
        style={drawerHeight ? { height: `${drawerHeight}px` } : undefined}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="drawer-resize-handle"
          aria-label="拖拽调整详情抽屉高度"
          onPointerDown={handleResizeStart}
        >
          <span />
        </button>
        <header className="drawer-header">
          <div>
            <h3>交易详情</h3>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭详情">
            ✕
          </button>
        </header>

        <div className="drawer-body">
          <section className="transaction-detail-summary" aria-label="账单摘要">
            <div>
              <p className="transaction-detail-kicker">
                {renderTypeLabel(transaction.type)}
                <span>{categoryName}</span>
              </p>
              <strong className={transaction.type === 'income' ? 'text-income' : 'text-expense'}>
                {privacyMode
                  ? maskAmount()
                  : `${transaction.type === 'income' ? '+' : '-'}${formatCurrency(transaction.amount)}`}
              </strong>
            </div>
            <p>{formatDateTime(transaction.date)} · {renderAccountLabel(accountName)}</p>
          </section>

          {transaction.note ? <p className="transaction-detail-note">{transaction.note}</p> : null}

          <section className="transaction-detail-facts" aria-label="基础信息">
            <div><span>分类</span><strong>{categoryName}</strong></div>
            <div><span>账户</span><strong>{renderAccountLabel(accountName)}</strong></div>
            <div><span>来源</span><strong>{sourceLabel(source)}</strong></div>
            {transaction.status ? <div><span>状态</span><strong>{statusLabel(transaction.status)}</strong></div> : null}
          </section>

          {abnormalAlert ? <p className="transaction-detail-alert">⚠ {abnormalAlert.detail}</p> : null}

          {hasMoreInformation ? (
            <details className="transaction-detail-more">
              <summary>更多信息</summary>
              <div className="transaction-detail-more-content">
                {transaction.orderNo ? <p><span>订单号</span><strong>{transaction.orderNo}</strong></p> : null}
                {transaction.merchantOrderNo ? <p><span>商家订单号</span><strong>{privacyMode ? maskMerchant(transaction.merchantOrderNo) : transaction.merchantOrderNo}</strong></p> : null}
                {transaction.tags.length ? <div className="drawer-tags">{transaction.tags.map((tag) => <span key={tag} className="badge badge-primary">{tag}</span>)}</div> : null}
                {isRefundOrReversal || relatedRefunds.length ? <p><span>退款 / 冲正</span><strong>{isRefundOrReversal ? (relatedOrigin ? `关联原单：${relatedOrigin.note || relatedOrigin.id}` : '退款或冲正单') : `已关联 ${relatedRefunds.length} 条记录`}</strong></p> : null}
                {transaction.attachments?.length ? <div className="transaction-detail-attachments">{transaction.attachments.map((item) => <p key={item.id}><span>附件</span><strong>{item.name}</strong></p>)}</div> : null}
                <p><span>最后修改</span><strong>{formatDateTime(transaction.updatedAt || transaction.date)}</strong></p>
              </div>
            </details>
          ) : null}
          <input ref={fileInputRef} type="file" style={{ display: 'none' }} onChange={handleAttachmentSelect} aria-label="上传附件" />
        </div>

        <footer className="drawer-footer">
          <button type="button" onClick={onShareBill}>
            分享
          </button>
          {onRefund &&
          transaction &&
          transaction.adjustmentKind !== 'refund' &&
          transaction.adjustmentKind !== 'reversal' ? (
            <button
              type="button"
              className="drawer-refund-btn"
              onClick={onRefund}
              title="为这笔支出发起退款，并自动回补账户余额"
            >
              ↩️ 发起退款
            </button>
          ) : null}
          <Link to={`/transactions/${transaction.id}`} style={{ textDecoration: 'none' }}>
            <button type="button" className="button-with-icon primary">
              <img src={PEN_TOOL_ICON_URL} alt="" aria-hidden="true" />
              编辑
            </button>
          </Link>
          <button type="button" className="danger" onClick={onDelete}>
            删除
          </button>
          <details className="transaction-detail-actions-more">
            <summary>更多</summary>
            <div>
              <button type="button" onClick={onCopyNote}>复制备注</button>
              <button type="button" onClick={onCopyJson}>复制 JSON</button>
              <button type="button" onClick={handlePrint}>打印 A4</button>
              <button type="button" onClick={triggerAttachmentSelect} disabled={attachmentUploading}>{attachmentUploading ? '上传中…' : '上传附件'}</button>
              <button type="button" onClick={onAiRecategorize} disabled={aiRecategorizing}>{aiRecategorizing ? 'AI 重分类中…' : 'AI 重分类'}</button>
              <button type="button" onClick={onQuickAdd}>新增账目</button>
            </div>
          </details>
        </footer>
      </aside>
    </div>
  );
}
