export function buildA4PrintBaseStyles(options?: {
  margin?: string;
  bodyColor?: string;
  bodyBackground?: string;
  fontFamily?: string;
}) {
  const margin = options?.margin || '12mm 10mm 14mm';
  const bodyColor = options?.bodyColor || '#111827';
  const bodyBackground = options?.bodyBackground || '#ffffff';
  const fontFamily =
    options?.fontFamily ||
    "'Alibaba PuHuiTi Ledger', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans SC', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

  return `
    @page {
      size: A4;
      margin: ${margin};
    }

    * {
      box-sizing: border-box;
    }

    html {
      background: ${bodyBackground};
    }

    body {
      margin: 0;
      color: ${bodyColor};
      background: ${bodyBackground};
      font-family: ${fontFamily};
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    @media print {
      html, body {
        background: #ffffff;
      }
    }
  `;
}

export function buildA4PrintSheetStyles(options?: {
  bodyFontSize?: string;
  bodyLineHeight?: string;
  sheetBackground?: string;
  sheetBorder?: string;
  sheetRadius?: string;
  sheetPadding?: string;
  sheetShadow?: string;
  printSheetPadding?: string;
}) {
  const bodyFontSize = options?.bodyFontSize || '12px';
  const bodyLineHeight = options?.bodyLineHeight || '1.6';
  const sheetBackground = options?.sheetBackground || '#ffffff';
  const sheetBorder = options?.sheetBorder || '1px solid #e5e7eb';
  const sheetRadius = options?.sheetRadius || '12px';
  const sheetPadding = options?.sheetPadding || '14mm';
  const sheetShadow = options?.sheetShadow || '0 10px 30px rgba(15, 23, 42, 0.08)';
  const printSheetPadding = options?.printSheetPadding || '0';

  return `
    body {
      font-size: ${bodyFontSize};
      line-height: ${bodyLineHeight};
    }

    .sheet {
      width: 100%;
      box-sizing: border-box;
      background: ${sheetBackground};
      border: ${sheetBorder};
      border-radius: ${sheetRadius};
      padding: ${sheetPadding};
      box-shadow: ${sheetShadow};
    }

    @media print {
      .sheet {
        border: none;
        border-radius: 0;
        box-shadow: none;
        padding: ${printSheetPadding};
      }
    }
  `;
}
