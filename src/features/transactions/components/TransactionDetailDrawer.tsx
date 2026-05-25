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
import { ALIPAY_LOGO_URL } from '../../../shared/config/brandAssets';
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
type DetailMode = 'professional' | 'timeline';
const DETAIL_MODE_STORAGE_KEY = 'ledgerflow.transactions.detailMode';
const ALIPAY_ACCOUNT_PATTERN = /(支付宝|alipay)/i;

function isAlipayAccountName(name: string): boolean {
  return ALIPAY_ACCOUNT_PATTERN.test(name);
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

function renderAccountLabel(accountName: string): ReactNode {
  if (!isAlipayAccountName(accountName)) {
    return accountName;
  }

  return (
    <span className="transaction-account-with-icon">
      <AlipayBrandIcon />
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
  return name.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'attachment';
}

function buildAttachmentRemotePath(transaction: TransactionItem, file: File): string {
  const config = loadWebdavConfig();
  const baseFolder = String(config.remoteFilePath || 'ledgerflow/backup.json').split('/').slice(0, -1).join('/');
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
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif"
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
  visibleSections,
  onToggleSection,
  onQuickAdd
}: TransactionDetailDrawerProps) {
  const [mode, setMode] = useState<DetailMode>(() => {
    const saved = window.localStorage.getItem(DETAIL_MODE_STORAGE_KEY);
    return saved === 'timeline' ? 'timeline' : 'professional';
  });
  const [attachmentUploading, setAttachmentUploading] = useState(false);
  const [drawerHeight, setDrawerHeight] = useState<number | null>(null);
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const resizeStateRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const setDetailMode = (next: DetailMode) => {
    setMode(next);
    window.localStorage.setItem(DETAIL_MODE_STORAGE_KEY, next);
  };

  const handleAttachmentSelect = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !transaction) {
      return;
    }

    if (!isWebdavReady()) {
      onAttachmentUploadStatus?.('当前未完成 WebDAV 配置，请先去数据库 / WebDAV 设置页完成配置。', 'warning');
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
      onAttachmentUploadStatus?.('当前未完成 WebDAV 配置，请先去数据库 / WebDAV 设置页完成配置。', 'warning');
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
  const timelineEvents = [
    {
      key: 'created',
      icon: '🧾',
      title: transaction.source === 'manual' ? '手工创建' : '导入创建',
      detail: `${formatDateTime(transaction.date)} 创建交易`,
      meta: `来源：${sourceLabel(source)}`
    },
    {
      key: 'ai-recognize',
      icon: '🤖',
      title: 'AI识别',
      detail:
        source === 'ai'
          ? '该笔交易来自上传账单/截图后的 AI 识别结果'
          : '本笔交易未经过 AI 识别流程',
      meta: source === 'ai' ? '状态：已识别入账' : '状态：跳过'
    },
    {
      key: 'manual-adjust',
      icon: '✍️',
      title: '人工修改',
      detail:
        transaction.status === 'pending'
          ? '当前仍为待处理，建议人工核对字段后确认'
          : '已完成人工确认或无需二次修改',
      meta: `交易状态：${transaction.status ? statusLabel(transaction.status) : '未标记'}`
    },
    {
      key: 'refund-link',
      icon: '🔁',
      title: '退款关联',
      detail:
        transaction.adjustmentKind === 'refund' || transaction.adjustmentKind === 'reversal'
          ? relatedOrigin
            ? `已关联原单：${relatedOrigin.note || relatedOrigin.id}`
            : '识别为退款/冲正，但原单缺失'
          : relatedRefunds.length > 0
            ? `该笔交易已关联 ${relatedRefunds.length} 条退款/冲正`
            : '暂无退款关联',
      meta:
        transaction.adjustmentKind === 'refund' || transaction.adjustmentKind === 'reversal'
          ? '关联类型：退款/冲正单'
          : '关联类型：普通交易'
    },
    {
      key: 'reconcile',
      icon: '✅',
      title: '对账确认',
      detail:
        transaction.status === 'completed' || transaction.status === 'closed'
          ? '该笔交易已进入完成态，可作为对账基准'
          : '该笔交易尚未完成，建议纳入今日待处理清单',
      meta:
        transaction.status === 'completed' || transaction.status === 'closed'
          ? '对账：已确认'
          : '对账：未确认'
    },
    {
      key: 'export-sync',
      icon: '📤',
      title: '导出 / 同步',
      detail: '可通过列表页导出 CSV 或发起同步，将该交易纳入外部账单流。',
      meta: '提示：当前页面未展示具体同步日志'
    }
  ];

  return (
    <div className="drawer-overlay" role="presentation" onClick={onClose}>
      <aside
        ref={drawerRef}
        className="drawer-panel"
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
            <small className="drawer-subtitle">支持模块化显示</small>
          </div>
          <div className="drawer-mode-wrap">
            <div className="drawer-mode-switch" role="tablist" aria-label="交易详情显示模式">
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'professional' ? 'true' : 'false'}
                className={mode === 'professional' ? 'active' : ''}
                title="适合编辑、对账：字段齐全、可快速修改"
                onClick={() => setDetailMode('professional')}
              >
                专业模式
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'timeline' ? 'true' : 'false'}
                className={mode === 'timeline' ? 'active' : ''}
                title="适合审计溯源：识别→清洗→入账→后续调整事件流"
                onClick={() => setDetailMode('timeline')}
              >
                时间轴模式
              </button>
            </div>
            <p className="drawer-mode-hint">
              {mode === 'professional'
                ? '专业模式：适合编辑、对账（字段齐全、可快速修改）'
                : '时间轴模式：适合审计溯源（识别→清洗→入账→后续调整）'}
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭详情">
            ✕
          </button>
        </header>

        <div className="drawer-body">
          {mode === 'timeline' ? (
            <section className="drawer-timeline-layout" aria-label="交易时间轴">
              <div className="drawer-timeline">
                {timelineEvents.map((item) => (
                  <article key={item.key} className="drawer-timeline-item">
                    <span className="drawer-timeline-icon">{item.icon}</span>
                    <div>
                      <p>{item.title}</p>
                      <strong>{item.detail}</strong>
                    </div>
                  </article>
                ))}
              </div>
              <aside className="drawer-timeline-side" aria-label="时间轴事件详情">
                <h4>事件详情</h4>
                <ul>
                  {timelineEvents.map((item) => (
                    <li key={`meta-${item.key}`}>
                      <strong>{item.title}</strong>
                      <p>{item.meta}</p>
                    </li>
                  ))}
                </ul>
                <div className="drawer-timeline-raw">
                  <h5>原始记录摘录</h5>
                  <p>
                    备注：{transaction.note || '（无）'}
                    <br />
                    订单号：{transaction.orderNo || '—'}
                    <br />
                    商家订单号：{transaction.merchantOrderNo || '—'}
                  </p>
                </div>
              </aside>
            </section>
          ) : null}

          {mode === 'professional' ? (
            <details className="drawer-modules" open>
              <summary>详情标题模块</summary>
              <div className="drawer-modules-grid">
                {[
                  { key: 'base' as const, label: '基础信息' },
                  { key: 'source' as const, label: '来源' },
                  { key: 'note' as const, label: '备注' },
                  { key: 'tags' as const, label: '标签' },
                  { key: 'json' as const, label: '原始 JSON' }
                ].map((item) => (
                  <label key={item.key}>
                    <input
                      type="checkbox"
                      checked={visibleSections[item.key]}
                      onChange={() => onToggleSection(item.key)}
                    />
                    <span>{item.label}</span>
                  </label>
                ))}
              </div>
            </details>
          ) : null}

          {mode === 'professional' && visibleSections.base ? (
            <>
              <div className="drawer-kv">
                <span>日期时间</span>
                <strong>{formatDateTime(transaction.date)}</strong>
              </div>
              <div className="drawer-kv">
                <span>最后修改</span>
                <strong>{formatDateTime(transaction.updatedAt || transaction.date)}</strong>
              </div>
              <div className="drawer-kv">
                <span>类型</span>
                <strong>{renderTypeLabel(transaction.type)}</strong>
              </div>
              <div className="drawer-kv">
                <span>分类</span>
                <strong>{categoryName}</strong>
              </div>
              <div className="drawer-kv">
                <span>账户</span>
                <strong>{renderAccountLabel(accountName)}</strong>
              </div>
              <div className="drawer-kv">
                <span>金额</span>
                <strong className={transaction.type === 'income' ? 'text-income' : 'text-expense'}>
                  {privacyMode
                    ? maskAmount()
                    : `${transaction.type === 'income' ? '+' : '-'}${formatCurrency(transaction.amount)}`}
                </strong>
              </div>
              {transaction.status ? (
                <div className="drawer-kv">
                  <span>交易状态</span>
                  <strong>
                    <span
                      className={`badge ${transaction.status === 'completed' ? 'badge-primary' : ''}`}
                    >
                      {statusLabel(transaction.status)}
                    </span>
                  </strong>
                </div>
              ) : null}
              {transaction.orderNo ? (
                <div className="drawer-kv">
                  <span>订单号</span>
                  <strong>{transaction.orderNo}</strong>
                </div>
              ) : null}
              {transaction.merchantOrderNo ? (
                <div className="drawer-kv">
                  <span>商家订单号</span>
                  <strong>
                    {privacyMode
                      ? maskMerchant(transaction.merchantOrderNo)
                      : transaction.merchantOrderNo}
                  </strong>
                </div>
              ) : null}
              {(transaction.adjustmentKind === 'refund' ||
                transaction.adjustmentKind === 'reversal' ||
                relatedRefunds.length > 0) && (
                <section
                  className="drawer-section drawer-adjustment-section"
                  aria-label="退款冲正关系"
                >
                  <h4>退款 / 冲正关系</h4>
                  <div className="drawer-kv">
                    <span>当前语义</span>
                    <strong>
                      {transaction.adjustmentKind === 'refund'
                        ? '退款单'
                        : transaction.adjustmentKind === 'reversal'
                          ? '冲正单'
                          : '原始交易'}
                    </strong>
                  </div>
                  {relatedOrigin ? (
                    <div className="drawer-kv">
                      <span>关联原单</span>
                      <strong>
                        {relatedOrigin.note || '（无备注）'} · {formatDateTime(relatedOrigin.date)}
                      </strong>
                    </div>
                  ) : null}
                  {relatedRefunds.length > 0 ? (
                    <div className="drawer-kv">
                      <span>关联退款/冲正</span>
                      <strong>{relatedRefunds.length} 条</strong>
                    </div>
                  ) : null}
                  {(transaction.adjustmentKind === 'refund' ||
                    transaction.adjustmentKind === 'reversal') &&
                  relatedOrigin ? (
                    <div className="drawer-kv">
                      <span>影响金额</span>
                      <strong className="text-income">
                        {privacyMode ? maskAmount() : `+${formatCurrency(transaction.amount)}`}
                      </strong>
                    </div>
                  ) : null}
                  {relatedRefunds.length > 0 ? (
                    <div className="drawer-kv">
                      <span>累计冲回</span>
                      <strong className="text-income">
                        {privacyMode
                          ? maskAmount()
                          : `+${formatCurrency(
                              relatedRefunds.reduce(
                                (sum, item) => sum + (Number(item.amount) || 0),
                                0
                              )
                            )}`}
                      </strong>
                    </div>
                  ) : null}
                </section>
              )}
            </>
          ) : null}

          {mode === 'professional' && abnormalAlert ? (
            <section className="drawer-section drawer-alert-section">
              <h4>⚠️ {abnormalAlert.title}</h4>
              <p>{abnormalAlert.detail}</p>
              <p className="muted" style={{ marginTop: 6 }}>
                AI 建议：如近期存在同金额/同备注流水，请优先核对是否重复入账。
              </p>
            </section>
          ) : null}

          {mode === 'professional' && visibleSections.source ? (
            <div className="drawer-kv">
              <span>来源</span>
              <strong>
                {source === 'ai' ? <span className="badge badge-primary">AI 记账</span> : null}
                {source === 'wechat' ? <span className="badge">微信导入</span> : null}
                {source === 'alipay' ? <span className="badge">支付宝</span> : null}
                {source === 'manual' ? <span className="badge">手工录入</span> : null}
              </strong>
            </div>
          ) : null}

          {mode === 'professional' && visibleSections.note ? (
            <section className="drawer-section">
              <h4>备注</h4>
              <p>{transaction.note || '（无）'}</p>
            </section>
          ) : null}

          {mode === 'professional' ? (
            <section className="drawer-section">
              <h4>附件</h4>
              <p className="muted" style={{ marginBottom: 8 }}>
                附件统一上传到 WebDAV；未配置时不可上传。
              </p>
              <input
                ref={fileInputRef}
                type="file"
                style={{ display: 'none' }}
                onChange={handleAttachmentSelect}
                aria-label="上传附件"
              />
              <button type="button" onClick={triggerAttachmentSelect} disabled={attachmentUploading}>
                {attachmentUploading ? '上传中…' : '插入附件 / 上传附件'}
              </button>
              {transaction.attachments && transaction.attachments.length > 0 ? (
                <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
                  {transaction.attachments.map((item) => (
                    <div key={item.id} className="drawer-kv">
                      <span>{item.name}</span>
                      <strong>
                        {formatDateTime(item.uploadedAt)} · {item.remotePath}
                      </strong>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted" style={{ marginTop: 8 }}>暂无附件。</p>
              )}
            </section>
          ) : null}

          {mode === 'professional' && visibleSections.tags ? (
            <section className="drawer-section">
              <h4>标签</h4>
              <div className="drawer-tags">
                {transaction.tags.length > 0
                  ? transaction.tags.map((tag) => (
                      <span key={tag} className="badge badge-primary">
                        {tag}
                      </span>
                    ))
                  : '（无）'}
              </div>
              {transaction.tags.length > 6 ? (
                <details className="drawer-tags-fold">
                  <summary>展开全部标签</summary>
                  <div className="drawer-tags" style={{ marginTop: 6 }}>
                    {transaction.tags.map((tag) => (
                      <span key={`${tag}-all`} className="badge badge-primary">
                        {tag}
                      </span>
                    ))}
                  </div>
                </details>
              ) : null}
            </section>
          ) : null}

          {mode === 'professional' && visibleSections.json ? (
            <section className="drawer-section">
              <h4>原始 JSON</h4>
              <pre>{JSON.stringify(transaction, null, 2)}</pre>
            </section>
          ) : null}
        </div>

        <footer className="drawer-footer">
          <button type="button" onClick={onCopyNote}>
            复制备注
          </button>
          <button type="button" onClick={onCopyJson}>
            复制 JSON
          </button>
          <button type="button" onClick={onShareBill}>
            📤 分享账单
          </button>
          <button type="button" onClick={handlePrint}>
            🖨️ 打印 A4
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
            <button type="button">✏️ 编辑</button>
          </Link>
          <button type="button" onClick={onAiRecategorize} disabled={aiRecategorizing}>
            {aiRecategorizing ? '🤖 AI 重分类中…' : '🤖 AI 重分类'}
          </button>
          <button type="button" className="danger" onClick={onDelete}>
            🗑️ 删除
          </button>
          <button
            type="button"
            className="drawer-add-link"
            aria-label="新增账目"
            onClick={onQuickAdd}
          >
            ＋
          </button>
        </footer>
      </aside>
    </div>
  );
}
