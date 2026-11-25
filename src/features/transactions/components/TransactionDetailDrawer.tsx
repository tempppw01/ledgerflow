import { ReactNode, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useDialogFocus } from '../../../shared/lib/useDialogFocus';
import { useNavigate } from 'react-router-dom';
import {
  TransactionAttachmentItem,
  TransactionItem,
  TransactionSource,
  TransactionStatus
} from '../../../entities/transaction/types';
import { useTranslation } from 'react-i18next';
import { formatCurrency } from '../../../shared/lib/format';
import { escapeHtml } from '../../../shared/lib/escapeHtml';
import { getDateLocale } from '../../../shared/lib/i18nDate';
import { useTFallback, type TfFallback } from '../../../shared/lib/useTFallback';
import {
  getTransactionDirection,
  isTransactionRefundLike
} from '../../../shared/lib/transactionMetrics';
import { buildA4PrintBaseStyles, buildA4PrintSheetStyles } from '../../../shared/lib/printStyles';
import { printHtmlWithIframe } from '../model/printUtils';
import { PrintPreviewDialog } from '../ui/PrintPreviewDialog';
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

/**
 * 状态与来源的取值这里只放 key + 中文兜底，真正的中英文案在 locale 里。
 * key 复用交易表格已经建立的同名 key：抽屉是从表格某一行打开的，
 * 同一笔交易在两处的「已完成 / 手工录入」必须是同一个说法。
 */
const STATUS_LABEL_ENTRIES: Record<TransactionStatus, { key: string; fallback: string }> = {
  pending: { key: 'transactions.table.status.pending', fallback: '待处理' },
  completed: { key: 'transactions.table.status.completed', fallback: '已完成' },
  refunded: { key: 'transactions.table.status.refunded', fallback: '已退款' },
  closed: { key: 'transactions.table.status.closed', fallback: '已关闭' },
  failed: { key: 'transactions.table.status.failed', fallback: '失败' }
};

const SOURCE_LABEL_ENTRIES: Record<TransactionSource, { key: string; fallback: string }> = {
  ai: { key: 'transactions.filters.sourceAi', fallback: 'AI 记账' },
  wechat: { key: 'transactions.filters.sourceWechat', fallback: '微信导入' },
  alipay: { key: 'transactions.filters.sourceAlipay', fallback: '支付宝' },
  manual: { key: 'transactions.filters.sourceManual', fallback: '手工录入' }
};

const TYPE_LABEL_ENTRIES: Record<
  'income' | 'expense' | 'budget' | 'repayment' | 'refund' | 'reversal',
  { key: string; fallback: string }
> = {
  income: { key: 'transactions.table.type.income', fallback: '收入' },
  expense: { key: 'transactions.table.type.expense', fallback: '支出' },
  budget: { key: 'transactions.table.type.budget', fallback: '预算' },
  repayment: { key: 'transactions.table.type.repayment', fallback: '还款' },
  refund: { key: 'transactions.table.type.refund', fallback: '退款' },
  reversal: { key: 'transactions.table.type.reversal', fallback: '冲正' }
};

/** 单字徽标：中文一个字，英文沿用表格已经确定的首字母约定（I/E/Rf/Rv）。 */
const TYPE_BADGE_ENTRIES = {
  income: { key: 'transactions.table.badge.income', fallback: '收' },
  expense: { key: 'transactions.table.badge.expense', fallback: '支' },
  refund: { key: 'transactions.table.badge.refund', fallback: '退' },
  reversal: { key: 'transactions.table.badge.reversal', fallback: '冲' }
} as const;

/**
 * 抽屉高度的上下限。
 *
 * 抽出来是为了让**指针拖拽和键盘调节用同一份计算** —— 两边各写一遍的话,
 * 键盘会调到一个拖拽永远到不了的高度,aria-valuenow 也会报出假读数
 * (表格列宽那里就踩过:报 656 而实际被钳在 640)。
 */
const DRAWER_MIN_HEIGHT_CAP = 420;
const DRAWER_VIEWPORT_MARGIN = 24;
/** 键盘一次调多少;按住 Shift 用粗档。 */
const DRAWER_KEYBOARD_STEP = 16;
const DRAWER_KEYBOARD_COARSE_STEP = 48;

function getDrawerHeightBounds() {
  return {
    min: Math.min(DRAWER_MIN_HEIGHT_CAP, Math.round(window.innerHeight * 0.42)),
    max: Math.round(window.innerHeight - DRAWER_VIEWPORT_MARGIN)
  };
}

function statusLabel(status: TransactionStatus, tf: TfFallback): string {
  const entry = STATUS_LABEL_ENTRIES[status];
  return entry ? tf(entry.key, entry.fallback) : status;
}

function sourceLabel(source: TransactionSource, tf: TfFallback): string {
  const entry = SOURCE_LABEL_ENTRIES[source];
  return entry ? tf(entry.key, entry.fallback) : source;
}

function typeLabel(transaction: TransactionItem, tf: TfFallback): string {
  if (isTransactionRefundLike(transaction)) {
    const kind = transaction.adjustmentKind === 'refund' ? 'refund' : 'reversal';
    return tf(TYPE_LABEL_ENTRIES[kind].key, TYPE_LABEL_ENTRIES[kind].fallback);
  }
  if (transaction.type === 'income' || transaction.type === 'expense') {
    return tf(
      TYPE_LABEL_ENTRIES[transaction.type].key,
      TYPE_LABEL_ENTRIES[transaction.type].fallback
    );
  }
  const kind = transaction.type === 'budget' ? 'budget' : 'repayment';
  return tf(TYPE_LABEL_ENTRIES[kind].key, TYPE_LABEL_ENTRIES[kind].fallback);
}

function formatDrawerTime(date: Date, language?: string): string {
  return new Intl.DateTimeFormat(getDateLocale(language), {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(date);
}

/** 抽屉里的日期时间跟随界面语言（中英不同习惯），不再写死 zh-CN。 */
function formatDrawerDateTime(value: string, language?: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return formatDrawerTime(date, language);
}

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
  if (
    !isAlipayAccountName(accountName) &&
    !isWechatAccountName(accountName) &&
    !isBankAccountName(accountName)
  ) {
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

function typeBadge(kind: keyof typeof TYPE_BADGE_ENTRIES, tf: TfFallback): string {
  return tf(TYPE_BADGE_ENTRIES[kind].key, TYPE_BADGE_ENTRIES[kind].fallback);
}

function renderTypeLabel(transaction: TransactionItem, tf: TfFallback) {
  const { type } = transaction;
  if (isTransactionRefundLike(transaction)) {
    const kind = transaction.adjustmentKind === 'refund' ? 'refund' : 'reversal';
    const label = tf(TYPE_LABEL_ENTRIES[kind].key, TYPE_LABEL_ENTRIES[kind].fallback);
    return (
      <span
        className={`transaction-type-badge transaction-type-badge-${
          getTransactionDirection(transaction) === 'inflow' ? 'income' : 'expense'
        }`}
        aria-label={label}
        title={label}
      >
        {typeBadge(kind, tf)}
      </span>
    );
  }

  if (type === 'income' || type === 'expense') {
    return (
      <span
        className={`transaction-type-badge transaction-type-badge-${type}`}
        aria-label={tf(TYPE_LABEL_ENTRIES[type].key, TYPE_LABEL_ENTRIES[type].fallback)}
      >
        {typeBadge(type, tf)}
      </span>
    );
  }

  return typeLabel(transaction, tf);
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

function buildAbnormalAlert(
  input: TransactionItem,
  tf: TfFallback
): { title: string; detail: string } | null {
  const amount = Number(input.amount) || 0;
  if (input.type !== 'expense' || isTransactionRefundLike(input) || amount < 500) return null;
  return {
    title: tf('txDrawer.alert.title', '金额异常提醒'),
    detail: tf(
      'txDrawer.alert.detail',
      '该笔支出（{amount}）显著偏高，建议检查是否重复记账，或确认是否为一次性大额消费。'
    ).replace('{amount}', formatCurrency(amount))
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
  onQuickAdd
}: TransactionDetailDrawerProps) {
  const [attachmentUploading, setAttachmentUploading] = useState(false);
  const [drawerHeight, setDrawerHeight] = useState<number | null>(null);
  /** 打开时量到的真实高度,用于在用户还没调过时报告 aria-valuenow。 */
  const [drawerMeasuredHeight, setDrawerMeasuredHeight] = useState(0);
  /** 单笔打印也先给预览:之前这里 window.open 带 noopener 返回值恒为 null,点了等于没反应。 */
  const [printPreviewHtml, setPrintPreviewHtml] = useState<string | null>(null);
  const drawerRef = useRef<HTMLDivElement | null>(null);
  // Escape 关闭 + 焦点收进抽屉 / 关闭后还给触发按钮。
  useDialogFocus(open && Boolean(transaction), drawerRef, onClose);
  const resizeStateRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const navigate = useNavigate();
  const tf = useTFallback();
  const { i18n } = useTranslation();
  const language = i18n.resolvedLanguage || i18n.language || 'zh';
  const htmlLang = language.startsWith('en') ? 'en' : 'zh-CN';

  const handleAttachmentSelect = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !transaction) {
      return;
    }

    if (!isWebdavReady()) {
      onAttachmentUploadStatus?.(
        tf(
          'txDrawer.upload.webdavRequired',
          '当前未完成 WebDAV 配置，请先去数据库 / WebDAV 设置页完成配置。'
        ),
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
      onAttachmentUploadStatus?.(
        tf('txDrawer.upload.success', '附件已上传并关联到账单详情。'),
        'success'
      );
    } catch (error) {
      onAttachmentUploadStatus?.(
        error instanceof Error
          ? error.message
          : tf('txDrawer.upload.failed', '附件上传失败，请稍后重试。'),
        'error'
      );
    } finally {
      setAttachmentUploading(false);
    }
  };

  const triggerAttachmentSelect = () => {
    if (!isWebdavReady()) {
      onAttachmentUploadStatus?.(
        tf(
          'txDrawer.upload.webdavRequired',
          '当前未完成 WebDAV 配置，请先去数据库 / WebDAV 设置页完成配置。'
        ),
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

    const direction = getTransactionDirection(transaction);
    const amountText = `${direction === 'inflow' ? '+' : '-'}${formatCurrency(transaction.amount)}`;
    const typeText = typeLabel(transaction, tf);

    const statusText = transaction.status ? statusLabel(transaction.status, tf) : '—';
    const noteText = transaction.note?.trim() || tf('txDrawer.print.noNote', '（无）');
    const tagsHtml =
      transaction.tags.length > 0
        ? transaction.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('')
        : `<span>${tf('txDrawer.print.noNote', '（无）')}</span>`;

    const html = `
      <!doctype html>
      <html lang="${escapeHtml(htmlLang)}">
        <head>
          <meta charset="utf-8" />
          <title>${escapeHtml(tf('txDrawer.print.title', '账单详情打印 - {id}').replace('{id}', transaction.id))}</title>
          <style>${buildPrintStyles()}</style>
        </head>
        <body>
          <main class="sheet">
            <header class="header">
              <div>
                <h1 class="title">${escapeHtml(tf('txDrawer.print.heading', '账单详情'))}</h1>
                <p class="sub">${escapeHtml(tf('txDrawer.print.txId', '交易编号：{id}').replace('{id}', transaction.id))}</p>
              </div>
              <div class="amount ${direction === 'inflow' ? 'income' : 'expense'}">${escapeHtml(amountText)}</div>
            </header>

            <section class="grid">
              <div class="kv"><label>${escapeHtml(tf('txDrawer.field.dateTime', '日期时间'))}</label><strong>${escapeHtml(formatDrawerDateTime(transaction.date, language))}</strong></div>
              <div class="kv"><label>${escapeHtml(tf('txDrawer.field.updatedAt', '最后修改'))}</label><strong>${escapeHtml(formatDrawerDateTime(transaction.updatedAt || transaction.date, language))}</strong></div>
              <div class="kv"><label>${escapeHtml(tf('txDrawer.field.type', '类型'))}</label><strong>${escapeHtml(typeText)}</strong></div>
              <div class="kv"><label>${escapeHtml(tf('txDrawer.field.category', '分类'))}</label><strong>${escapeHtml(categoryName)}</strong></div>
              <div class="kv"><label>${escapeHtml(tf('txDrawer.field.account', '账户'))}</label><strong>${escapeHtml(accountName)}</strong></div>
              <div class="kv"><label>${escapeHtml(tf('txDrawer.field.source', '来源'))}</label><strong>${escapeHtml(sourceLabel(source, tf))}</strong></div>
              <div class="kv"><label>${escapeHtml(tf('txDrawer.field.txStatus', '交易状态'))}</label><strong>${escapeHtml(statusText)}</strong></div>
              <div class="kv"><label>${escapeHtml(tf('txDrawer.field.orderNo', '订单号'))}</label><strong>${escapeHtml(transaction.orderNo || '—')}</strong></div>
              <div class="kv"><label>${escapeHtml(tf('txDrawer.field.merchantOrderNo', '商家订单号'))}</label><strong>${escapeHtml(transaction.merchantOrderNo || '—')}</strong></div>
            </section>

            <section class="section">
              <h3>${escapeHtml(tf('txDrawer.field.note', '备注'))}</h3>
              <p>${escapeHtml(noteText)}</p>
            </section>

            <section class="section">
              <h3>${escapeHtml(tf('txDrawer.field.tags', '标签'))}</h3>
              <div class="tags">${tagsHtml}</div>
            </section>

            <footer class="footer">${escapeHtml(tf('txDrawer.print.time', '打印时间：{value}').replace('{value}', formatDrawerTime(new Date(), language)))}</footer>
          </main>
        </body>
      </html>
    `;

    // 与批量打印一致:先预览,确认后再走隐藏 iframe 打印。
    setPrintPreviewHtml(html);
  };

  useEffect(() => {
    if (!open) return;
    setDrawerHeight(null);
    /*
     * 打开时量一次真实高度:抽屉的初始高度是 CSS 决定的,而 aria-valuenow 需要一个
     * 渲染期就能读到的数字。不量的话它会报 0,而同一元素上的 aria-valuemin 是 300 多 ——
     * 读屏用户会听到一个自相矛盾的值。量一次也让第一下方向键从当前高度起算。
     */
    const node = drawerRef.current;
    setDrawerMeasuredHeight(node ? Math.round(node.getBoundingClientRect().height) : 0);
  }, [open, transaction?.id]);

  // 抽屉关闭时把预览一起收起,避免下次打开残留上一笔的打印内容。
  useEffect(() => {
    if (!open) {
      setPrintPreviewHtml(null);
    }
  }, [open]);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const state = resizeStateRef.current;
      if (!state) return;
      const { min, max } = getDrawerHeightBounds();
      const next = state.startHeight + (state.startY - event.clientY);
      setDrawerHeight(Math.min(max, Math.max(min, next)));
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

  const handleResizeStart = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drawerRef.current) return;
    resizeStateRef.current = {
      startY: event.clientY,
      startHeight: drawerRef.current.getBoundingClientRect().height
    };
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'ns-resize';
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  /*
   * WCAG 2.1.1(键盘可达):这个手柄原来只有 onPointerDown —— 能 Tab 到,
   * 但按什么都调不动高度,等于只有鼠标用户能改。补 Window Splitter 的键盘入口。
   *
   * 从**当前实际高度**起算:首次调节前抽屉高度由 CSS 决定,要先量一次,
   * 否则第一下会从 min 起跳,把抽屉一下压到最矮。
   */
  const handleResizeKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const node = drawerRef.current;
    if (!node) return;
    const { min, max } = getDrawerHeightBounds();
    const base = drawerHeight ?? (node.getBoundingClientRect().height || drawerMeasuredHeight);
    const step = event.shiftKey ? DRAWER_KEYBOARD_COARSE_STEP : DRAWER_KEYBOARD_STEP;
    let next: number | null = null;
    // 手柄在抽屉**顶部**,往上拖是变高 —— 所以 ArrowUp 增、ArrowDown 减,和拖拽方向一致。
    if (event.key === 'ArrowUp') next = base + step;
    else if (event.key === 'ArrowDown') next = base - step;
    else if (event.key === 'Home') next = min;
    else if (event.key === 'End') next = max;
    if (next === null) return;
    event.preventDefault();
    setDrawerHeight(Math.min(max, Math.max(min, next)));
  };

  if (!open || !transaction) return null;

  /*
   * 报给辅助技术的当前值必须落在 [min, max] 里。测量失败时(元素还没布局,
   * 比如 jsdom 里 getBoundingClientRect 恒为 0)会量到 0,而 min 是 300 多 ——
   * 直接把 0 报出去就是"最小值 323、当前值 0"这种自相矛盾的话。
   * 钳一下只会影响测量失败那一瞬;真实浏览器里量到的就是真实高度,不受影响。
   */
  const drawerBounds = getDrawerHeightBounds();
  const drawerValueNow = Math.min(
    drawerBounds.max,
    Math.max(drawerBounds.min, Math.round(drawerHeight ?? drawerMeasuredHeight))
  );

  const abnormalAlert = buildAbnormalAlert(transaction, tf);
  const isRefundOrReversal = isTransactionRefundLike(transaction);
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
        aria-label={tf('txDrawer.title', '交易详情')}
        style={drawerHeight ? { height: `${drawerHeight}px` } : undefined}
        onClick={(event) => event.stopPropagation()}
      >
        <div
          className="drawer-resize-handle"
          /*
           * 用 separator(Window Splitter)而不是 button:手柄要报告"当前高度是多少、
           * 能调到多少",而 aria-valuenow 只对 range 类角色有效 —— 挂在 button 上
           * 无障碍树会直接忽略它。CSS 里本来就把边框和背景清空了,换成 div 视觉不变。
           */
          role="separator"
          tabIndex={0}
          aria-orientation="horizontal"
          aria-label={tf('txDrawer.resizeAria', '拖拽调整详情抽屉高度')}
          aria-valuenow={drawerValueNow}
          aria-valuemin={drawerBounds.min}
          aria-valuemax={drawerBounds.max}
          onPointerDown={handleResizeStart}
          onKeyDown={handleResizeKeyDown}
        >
          <span />
        </div>
        <header className="drawer-header">
          <div>
            <h3>{tf('txDrawer.title', '交易详情')}</h3>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label={tf('txDrawer.closeAria', '关闭详情')}
          >
            ✕
          </button>
        </header>

        <div className="drawer-body">
          <section
            className="transaction-detail-summary"
            aria-label={tf('txDrawer.summaryAria', '账单摘要')}
          >
            <div>
              <p className="transaction-detail-kicker">
                {renderTypeLabel(transaction, tf)}
                <span>{categoryName}</span>
              </p>
              <strong
                className={
                  getTransactionDirection(transaction) === 'inflow' ? 'text-income' : 'text-expense'
                }
              >
                {privacyMode
                  ? maskAmount()
                  : `${getTransactionDirection(transaction) === 'inflow' ? '+' : '-'}${formatCurrency(transaction.amount)}`}
              </strong>
            </div>
            <p>
              {formatDrawerDateTime(transaction.date, language)} · {renderAccountLabel(accountName)}
            </p>
          </section>

          {transaction.note ? <p className="transaction-detail-note">{transaction.note}</p> : null}

          <section
            className="transaction-detail-facts"
            aria-label={tf('txDrawer.factsAria', '基础信息')}
          >
            <div>
              <span>{tf('txDrawer.field.category', '分类')}</span>
              <strong>{categoryName}</strong>
            </div>
            <div>
              <span>{tf('txDrawer.field.account', '账户')}</span>
              <strong>{renderAccountLabel(accountName)}</strong>
            </div>
            <div>
              <span>{tf('txDrawer.field.source', '来源')}</span>
              <strong>{sourceLabel(source, tf)}</strong>
            </div>
            {transaction.status ? (
              <div>
                <span>{tf('txDrawer.field.status', '状态')}</span>
                <strong>{statusLabel(transaction.status, tf)}</strong>
              </div>
            ) : null}
          </section>

          {abnormalAlert ? (
            <p className="transaction-detail-alert">⚠ {abnormalAlert.detail}</p>
          ) : null}

          {hasMoreInformation ? (
            <details className="transaction-detail-more">
              <summary>{tf('txDrawer.moreInfo', '更多信息')}</summary>
              <div className="transaction-detail-more-content">
                {transaction.orderNo ? (
                  <p>
                    <span>{tf('txDrawer.field.orderNo', '订单号')}</span>
                    <strong>{transaction.orderNo}</strong>
                  </p>
                ) : null}
                {transaction.merchantOrderNo ? (
                  <p>
                    <span>{tf('txDrawer.field.merchantOrderNo', '商家订单号')}</span>
                    <strong>
                      {privacyMode
                        ? maskMerchant(transaction.merchantOrderNo)
                        : transaction.merchantOrderNo}
                    </strong>
                  </p>
                ) : null}
                {transaction.tags.length ? (
                  <div className="drawer-tags">
                    {transaction.tags.map((tag) => (
                      <span key={tag} className="badge badge-primary">
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : null}
                {isRefundOrReversal || relatedRefunds.length ? (
                  <p>
                    <span>{tf('txDrawer.refund.section', '退款 / 冲正')}</span>
                    <strong>
                      {isRefundOrReversal
                        ? relatedOrigin
                          ? tf('txDrawer.relatedOrigin', '关联原单：{note}').replace(
                              '{note}',
                              relatedOrigin.note || relatedOrigin.id
                            )
                          : tf('txDrawer.refund.only', '退款或冲正单')
                        : tf('txDrawer.refund.relatedCount', '已关联 {count} 条记录').replace(
                            '{count}',
                            String(relatedRefunds.length)
                          )}
                    </strong>
                  </p>
                ) : null}
                {transaction.attachments?.length ? (
                  <div className="transaction-detail-attachments">
                    {transaction.attachments.map((item) => (
                      <p key={item.id}>
                        <span>{tf('txDrawer.field.attachment', '附件')}</span>
                        <strong>{item.name}</strong>
                      </p>
                    ))}
                  </div>
                ) : null}
                <p>
                  <span>{tf('txDrawer.field.updatedAt', '最后修改')}</span>
                  <strong>
                    {formatDrawerDateTime(transaction.updatedAt || transaction.date, language)}
                  </strong>
                </p>
              </div>
            </details>
          ) : null}
          <input
            ref={fileInputRef}
            type="file"
            style={{ display: 'none' }}
            onChange={handleAttachmentSelect}
            aria-label={tf('txDrawer.upload.action', '上传附件')}
          />
        </div>

        <footer className="drawer-footer">
          <button type="button" onClick={onShareBill}>
            {tf('txDrawer.share', '分享')}
          </button>
          {onRefund &&
          transaction &&
          transaction.adjustmentKind !== 'refund' &&
          transaction.adjustmentKind !== 'reversal' &&
          (!transaction.status || transaction.status === 'completed') ? (
            <button
              type="button"
              className="drawer-refund-btn"
              onClick={onRefund}
              title={tf('txDrawer.refund.hint', '为这笔支出发起退款，并自动回补账户余额')}
            >
              {tf('txDrawer.refund.action', '↩️ 发起退款')}
            </button>
          ) : null}
          <button
            type="button"
            className="button-with-icon primary"
            onClick={() => navigate(`/transactions/${transaction.id}`)}
          >
            <img src={PEN_TOOL_ICON_URL} alt="" aria-hidden="true" />
            {tf('txDrawer.edit', '编辑')}
          </button>
          <button type="button" className="danger" onClick={onDelete}>
            {tf('txDrawer.delete', '删除')}
          </button>
          <details className="transaction-detail-actions-more">
            <summary>{tf('txDrawer.more', '更多')}</summary>
            <div>
              <button type="button" onClick={onCopyNote}>
                {tf('txDrawer.copyNote', '复制备注')}
              </button>
              <button type="button" onClick={onCopyJson}>
                {tf('txDrawer.copyJson', '复制 JSON')}
              </button>
              <button type="button" onClick={handlePrint}>
                {tf('txDrawer.printA4', '打印 A4')}
              </button>
              <button
                type="button"
                onClick={triggerAttachmentSelect}
                disabled={attachmentUploading}
              >
                {attachmentUploading
                  ? tf('txDrawer.upload.uploading', '上传中…')
                  : tf('txDrawer.upload.action', '上传附件')}
              </button>
              <button type="button" onClick={onAiRecategorize} disabled={aiRecategorizing}>
                {aiRecategorizing
                  ? tf('txDrawer.ai.uploading', 'AI 重分类中…')
                  : tf('txDrawer.ai.action', 'AI 重分类')}
              </button>
              <button type="button" onClick={onQuickAdd}>
                {tf('txDrawer.quickAdd', '新增账目')}
              </button>
            </div>
          </details>
        </footer>
      </aside>

      <PrintPreviewDialog
        open={printPreviewHtml !== null}
        html={printPreviewHtml ?? ''}
        title={tf('txPage.print.previewTitle', '打印预览')}
        onCancel={() => setPrintPreviewHtml(null)}
        onPrint={() => {
          const html = printPreviewHtml;
          if (!html) {
            return;
          }
          try {
            printHtmlWithIframe(html);
            setPrintPreviewHtml(null);
          } catch (error) {
            // 打印失败时保留预览让用户重试,不再像以前那样点了毫无反应。
            console.error('[ledgerflow] transaction print failed', error);
          }
        }}
      />
    </div>
  );
}
