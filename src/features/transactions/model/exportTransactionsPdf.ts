import i18n from '../../../i18n';
import { toLocalDateKey } from '../../../shared/lib/localDate';
import { formatCurrency, formatDate } from '../../../shared/lib/format';
import { TransactionItem } from '../../../entities/transaction/types';
import { PDF_CHINESE_FONT_URL } from '../../../shared/config/brandAssets';
import {
  getTransactionDirection,
  isTransactionRefundLike,
  summarizeTransactions
} from '../../../shared/lib/transactionMetrics';

export type BulkPrintTemplate = 'full' | 'summary';

export type BulkPdfFieldOptions = {
  includeAccount: boolean;
  includeNote: boolean;
  includeOrderNo: boolean;
  includeTags: boolean;
};

export type BulkPdfRow = {
  item: TransactionItem;
  categoryName: string;
  accountName: string;
};

export type ExportTransactionsPdfInput = {
  rows: BulkPdfRow[];
  privacyMode: boolean;
  bulkPrintTemplate: BulkPrintTemplate;
  bulkPrintFields: BulkPdfFieldOptions;
  maskShareText: (value: string) => string;
};

let pdfRuntimePromise: Promise<[typeof import('pdf-lib'), typeof import('fontkit')]> | null = null;
let cachedFontBytesPromise: Promise<ArrayBuffer> | null = null;

/**
 * 非组件模块(不能调 hook)的 i18n:与 useTFallback 的 tf 同语义 —— key 命中就用翻译,否则用中文兜底。
 * 这样 PDF 导出(可能在 i18n 未初始化的单测环境里调用)仍会得到中文。
 */
function tf(key: string, fallback: string) {
  const translated = i18n.t(key, { defaultValue: fallback });
  return typeof translated === 'string' ? translated : fallback;
}

function txTypeLabel(item: TransactionItem) {
  if (isTransactionRefundLike(item)) {
    return item.adjustmentKind === 'refund' ? tf('txExport.type.refund', '退款') : tf('txExport.type.reversal', '冲正');
  }
  const { type } = item;
  return type === 'income'
    ? tf('txExport.type.income', '收入')
    : type === 'budget'
      ? tf('txExport.type.budget', '预算')
      : type === 'repayment'
        ? tf('txExport.type.repayment', '还款')
        : tf('txExport.type.expense', '支出');
}

function txStatusLabel(status?: TransactionItem['status']) {
  if (!status) return '—';
  return (
    {
      pending: tf('txExport.status.pending', '待处理'),
      completed: tf('txExport.status.completed', '已完成'),
      refunded: tf('txExport.status.refunded', '已退款'),
      closed: tf('txExport.status.closed', '已关闭'),
      failed: tf('txExport.status.failed', '失败')
    }[status] || status
  );
}

async function getPdfRuntime() {
  if (!pdfRuntimePromise) {
    pdfRuntimePromise = Promise.all([import('pdf-lib'), import('fontkit')]).catch((error) => {
      pdfRuntimePromise = null;
      throw error;
    });
  }

  return pdfRuntimePromise;
}

async function getCachedChineseFontBytes() {
  if (!cachedFontBytesPromise) {
    cachedFontBytesPromise = (async () => {
      const fontResponse = await fetch(PDF_CHINESE_FONT_URL);
      if (!fontResponse.ok) {
        throw new Error(tf('txExport.error.fontLoad', '中文字体加载失败，请联网后重试。'));
      }
      return fontResponse.arrayBuffer();
    })().catch((error) => {
      cachedFontBytesPromise = null;
      throw error;
    });
  }

  return cachedFontBytesPromise;
}

export async function exportTransactionsPdf(input: ExportTransactionsPdfInput) {
  const { rows, privacyMode, bulkPrintTemplate, bulkPrintFields, maskShareText } = input;

  const [{ PDFDocument, rgb }, fontkitModule] = await getPdfRuntime();

  const pdfDoc = await PDFDocument.create();
  const fontkit = 'default' in fontkitModule ? fontkitModule.default : fontkitModule;
  pdfDoc.registerFontkit(fontkit);

  const fontBytes = await getCachedChineseFontBytes();
  // 不能开启子集化:pdf-lib 1.17 依赖 subset.encodeStream() 返回 Node 流
  // (要 .on 和 pipe),而本项目装的 fontkit v2 只提供 encode()(返回字节),
  // 于是 embedFont 之后在 pdfDoc.save() 阶段抛
  // “subset.encodeStream(...).on is not a function”,整个导出失败。
  // 关掉子集化即可正常导出,代价是内嵌整套中文字体、PDF 体积偏大。
  // 想恢复小体积:把 fontkit 降到 1.x,或改用 @pdf-lib/fontkit。
  const font = await pdfDoc.embedFont(fontBytes, { subset: false });
  const fontSize = 10;
  const titleSize = 16;
  const lineHeight = 16;
  const margin = 40;
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const maxTextWidth = pageWidth - margin * 2;

  const summary = summarizeTransactions(rows.map((row) => row.item));
  const totalAmount = summary.overallTotal;
  const incomeTotal = summary.incomeTotal;
  const expenseTotal = summary.expenseTotal;

  const maskAmountText = (value: number) => (privacyMode ? '¥••••' : formatCurrency(value));
  const maskPrintText = (value?: string) => {
    if (!value?.trim()) return '—';
    return privacyMode ? maskShareText(value) : value;
  };

  const dateTimestamps = rows
    .map((row) => new Date(row.item.date).getTime())
    .filter((value) => Number.isFinite(value));
  const dateRangeText = dateTimestamps.length
    ? `${formatDate(new Date(Math.min(...dateTimestamps)).toISOString())} ～ ${formatDate(
        new Date(Math.max(...dateTimestamps)).toISOString()
      )}`
    : '—';
  const generatedAtText = new Date().toLocaleString(
    i18n.language?.startsWith('en') ? 'en-US' : 'zh-CN',
    { hour12: false }
  );

  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  let cursorY = pageHeight - margin;

  const ensureSpace = (requiredHeight: number) => {
    if (cursorY - requiredHeight < margin) {
      page = pdfDoc.addPage([pageWidth, pageHeight]);
      cursorY = pageHeight - margin;
    }
  };

  const drawLine = (
    textLine: string,
    x = margin,
    color = rgb(0.07, 0.09, 0.15),
    size = fontSize
  ) => {
    page.drawText(textLine, { x, y: cursorY, size, font, color });
    cursorY -= lineHeight;
  };

  page.drawText(tf('txExport.title', 'LedgerFlow 批量交易导出'), {
    x: margin,
    y: cursorY,
    size: titleSize,
    font,
    color: rgb(0.07, 0.09, 0.15)
  });
  cursorY -= 26;
  drawLine(`${tf('txExport.meta.dateRange', `时间范围：`)}${dateRangeText}`);
  drawLine(`${tf('txExport.meta.generatedAt', `生成时间：`)}${generatedAtText}`);
  drawLine(`${tf('txExport.meta.count', `交易条数：`)}${rows.length}${tf('txExport.meta.countUnit', ` 条`)}`);
  drawLine(
    `${tf('txExport.meta.amountTotal', `金额合计：`)}${maskAmountText(totalAmount)}${tf('txExport.meta.incomeTotal', ` ｜ 收入合计：`)}${maskAmountText(incomeTotal)}${tf('txExport.meta.expenseTotal', ` ｜ 支出合计：`)}${maskAmountText(expenseTotal)}`
  );
  drawLine(
    `${tf('txExport.meta.mode', `导出模式：`)}${privacyMode ? tf('txExport.mode.privacy', '隐私模式（已脱敏）') : tf('txExport.mode.full', '完整模式')}${tf('txExport.meta.template', ` ｜ 模板：`)}${bulkPrintTemplate === 'summary' ? tf('txExport.template.summary', '摘要') : tf('txExport.template.full', '完整')}`
  );
  cursorY -= 6;

  rows.forEach(({ item, categoryName, accountName }, index) => {
    const detailLineParts = [
      `${tf('txExport.field.category', `分类：`)}${maskPrintText(categoryName || tf('txExport.value.uncategorized', '未分类'))}`,
      bulkPrintFields.includeAccount ? `${tf('txExport.field.account', `账户：`)}${maskPrintText(accountName || tf('txExport.value.noAccount', '未指定账户'))}` : '',
      `${tf('txExport.field.status', `状态：`)}${txStatusLabel(item.status)}`,
      bulkPrintFields.includeOrderNo && item.orderNo
        ? `${tf('txExport.field.orderNo', `订单号：`)}${maskPrintText(item.orderNo)}`
        : '',
      bulkPrintFields.includeOrderNo && item.merchantOrderNo
        ? `${tf('txExport.field.merchantOrderNo', `商户单号：`)}${maskPrintText(item.merchantOrderNo)}`
        : ''
    ].filter(Boolean);

    const extraLines = [
      bulkPrintFields.includeNote && bulkPrintTemplate !== 'summary'
        ? `${tf('txExport.field.note', `备注：`)}${maskPrintText(item.note || '—')}`
        : '',
      bulkPrintFields.includeTags && item.tags?.length
        ? `${tf('txExport.field.tags', `标签：`)}${maskPrintText(item.tags.join(' / '))}`
        : ''
    ].filter(Boolean);

    const lines =
      bulkPrintTemplate === 'summary'
        ? [
            `${index + 1}. ${formatDate(item.date)}  ${txTypeLabel(item)}  ${getTransactionDirection(item) === 'inflow' ? '+' : '-'}${maskAmountText(item.amount)}`,
            detailLineParts
              .filter(
                (part) =>
                  !part.startsWith(tf('txExport.prefix.account', '账户：')) &&
                  !part.startsWith(tf('txExport.prefix.orderNo', '订单号：')) &&
                  !part.startsWith(tf('txExport.prefix.merchantOrderNo', '商户单号：'))
              )
              .join(' ｜ ')
          ]
        : [
            `${index + 1}. ${formatDate(item.date)}  ${txTypeLabel(item)}  ${getTransactionDirection(item) === 'inflow' ? '+' : '-'}${maskAmountText(item.amount)}`,
            detailLineParts.join(' ｜ '),
            ...extraLines
          ];

    const requiredHeight = lines.length * lineHeight + 10;
    ensureSpace(requiredHeight);

    lines.forEach((line) => {
      const normalized = String(line);
      if (font.widthOfTextAtSize(normalized, fontSize) <= maxTextWidth) {
        drawLine(normalized);
        return;
      }

      let buffer = '';
      for (const ch of normalized) {
        const next = buffer + ch;
        if (font.widthOfTextAtSize(next, fontSize) > maxTextWidth && buffer) {
          drawLine(buffer);
          buffer = ch;
        } else {
          buffer = next;
        }
      }
      if (buffer) drawLine(buffer);
    });

    cursorY -= 8;
  });

  const pdfBytes = await pdfDoc.save();
  const blob = new Blob([pdfBytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `ledgerflow-transactions-${toLocalDateKey(new Date())}.pdf`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
