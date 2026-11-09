import type { CreditExtractedItem } from './types';
import { inferCreditProductTypeLabel } from './debtClassification';

const CREDIT_PENDING_FIELD_ORDER = [
  '产品名称',
  '当前应还',
  '剩余待还',
  '还款日',
  '剩余期数',
  '每期金额',
  '利息/费率'
] as const;
const CREDIT_SUBSTANTIVE_FIELDS = [
  'dueAmount',
  'totalDebt',
  'repaymentDate',
  'remainingPeriods',
  'monthlyAmount',
  'interest'
] as const;
const CREDIT_PLACEHOLDER_VALUES = new Set([
  '待补充',
  '待确认',
  '待识别',
  '未识别',
  '未知',
  '暂无',
  '识别中',
  '-',
  '--'
]);

export function hasCreditFieldValue(value?: string): boolean {
  const text = String(value || '').trim();
  return Boolean(text) && !CREDIT_PLACEHOLDER_VALUES.has(text);
}

function hasSubstantiveCreditFields(
  values: Partial<Record<(typeof CREDIT_SUBSTANTIVE_FIELDS)[number], string>>
): boolean {
  return CREDIT_SUBSTANTIVE_FIELDS.some((field) => hasCreditFieldValue(values[field]));
}

function cleanCreditFieldValue(value: string): string {
  return hasCreditFieldValue(value) ? value.trim() : '';
}

export function deriveCreditPendingFields(
  item: Pick<
    CreditExtractedItem,
    | 'title'
    | 'dueAmount'
    | 'totalDebt'
    | 'repaymentDate'
    | 'remainingPeriods'
    | 'monthlyAmount'
    | 'interest'
    | 'rateType'
  >,
  modelPendingFields: string[] = []
): string[] {
  const derived = CREDIT_PENDING_FIELD_ORDER.filter((field) => {
    if (field === '产品名称') return !hasCreditFieldValue(item.title);
    if (field === '当前应还') return !hasCreditFieldValue(item.dueAmount);
    if (field === '剩余待还') return !hasCreditFieldValue(item.totalDebt);
    if (field === '还款日') return !hasCreditFieldValue(item.repaymentDate);
    if (field === '剩余期数') return !hasCreditFieldValue(item.remainingPeriods);
    if (field === '每期金额') return !hasCreditFieldValue(item.monthlyAmount);
    return !hasCreditFieldValue(item.interest) && !hasCreditFieldValue(item.rateType);
  });
  const knownFields = new Set(CREDIT_PENDING_FIELD_ORDER);
  const extraPending = modelPendingFields
    .map((field) => String(field || '').trim())
    .filter(
      (field) => field && !knownFields.has(field as (typeof CREDIT_PENDING_FIELD_ORDER)[number])
    );
  return Array.from(new Set([...derived, ...extraPending]));
}

function splitCreditBlocks(answer: string) {
  const text = String(answer || '').trim();
  if (!text) return [];

  return text
    .split(/\n(?=产品|平台|项目|标题|1\.|2\.|3\.|-\s*(?:产品|平台|项目|标题))/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function pickFirstMatchedText(block: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const matched = block.match(pattern);
    if (matched?.[1]?.trim()) {
      return matched[1].trim();
    }
  }

  return '';
}

export function extractStreamingCreditPreview(answer: string): CreditExtractedItem[] {
  const text = String(answer || '').trim();
  if (!text) return [];

  const blocks = splitCreditBlocks(text);

  const candidates: Array<CreditExtractedItem | null> = (blocks.length > 1 ? blocks : [text]).map(
    (block, index) => {
      const title = cleanCreditFieldValue(
        pickFirstMatchedText(block, [
          /产品(?:\/平台)?[：:】]\s*([^\n]+)/i,
          /平台(?:\/产品)?[：:】]\s*([^\n]+)/i,
          /标题[：:】]\s*([^\n]+)/i
        ])
      );
      const dueAmount = cleanCreditFieldValue(
        pickFirstMatchedText(block, [
          /当前应还(?:金额)?[：:】]\s*([^\n]+)/i,
          /本期应还[：:】]\s*([^\n]+)/i
        ])
      );
      const totalDebt = cleanCreditFieldValue(
        pickFirstMatchedText(block, [
          /总欠款[：:】]\s*([^\n]+)/i,
          /剩余待还[：:】]\s*([^\n]+)/i,
          /总待还[：:】]\s*([^\n]+)/i
        ])
      );
      const repaymentDate = cleanCreditFieldValue(
        pickFirstMatchedText(block, [
          /还款日(?:期)?[：:】]\s*([^\n]+)/i,
          /扣款日[：:】]\s*([^\n]+)/i
        ])
      );
      const remainingPeriods = cleanCreditFieldValue(
        pickFirstMatchedText(block, [
          /剩余期数[：:】]\s*([^\n]+)/i,
          /(剩余[0-9一二三四五六七八九十]+期)/i
        ])
      );
      const monthlyAmount = cleanCreditFieldValue(
        pickFirstMatchedText(block, [
          /每期(?:金额|应还)?[：:】]\s*([^\n]+)/i,
          /月供[：:】]\s*([^\n]+)/i
        ])
      );
      const interest = cleanCreditFieldValue(
        pickFirstMatchedText(block, [
          /利息(?:\/费率|\/手续费|\/服务费)?[：:】]\s*([^\n]+)/i,
          /费率[：:】]\s*([^\n]+)/i,
          /服务费[：:】]\s*([^\n]+)/i
        ])
      );
      const riskHint = pickFirstMatchedText(block, [
        /风险提示[：:】]\s*([^\n]+)/i,
        /风险[：:】]\s*([^\n]+)/i
      ]);
      const actionSuggestion = pickFirstMatchedText(block, [
        /下一步(?:建议)?[：:】]\s*([^\n]+)/i,
        /建议动作[：:】]\s*([^\n]+)/i,
        /建议[：:】]\s*([^\n]+)/i
      ]);

      const productType = inferCreditProductTypeLabel(title, block);

      const pendingFields = deriveCreditPendingFields({
        title,
        dueAmount,
        totalDebt,
        repaymentDate,
        remainingPeriods,
        monthlyAmount
      });

      if (
        !title &&
        !hasSubstantiveCreditFields({
          dueAmount,
          totalDebt,
          repaymentDate,
          remainingPeriods,
          monthlyAmount,
          interest
        })
      ) {
        return null;
      }

      return {
        id: `streaming-credit-${index}`,
        title: title || `识别中项目 ${index + 1}`,
        productType,
        dueAmount: dueAmount || undefined,
        totalDebt: totalDebt || undefined,
        repaymentDate: repaymentDate || undefined,
        remainingPeriods: remainingPeriods || undefined,
        monthlyAmount: monthlyAmount || undefined,
        interest: interest || undefined,
        riskHint: riskHint || undefined,
        actionSuggestion: actionSuggestion || undefined,
        pendingFields,
        confidence: title && (dueAmount || totalDebt || repaymentDate) ? 'medium' : 'low'
      };
    }
  );

  return candidates.filter((item): item is CreditExtractedItem => item !== null);
}

function findBalancedJsonEnd(
  text: string,
  start: number,
  opening: '{' | '[',
  closing: '}' | ']'
): number {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === opening) {
      depth += 1;
    } else if (char === closing) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return -1;
}

function collectStructuredJsonCandidates(answer: string): string[] {
  const text = String(answer || '');
  const candidates: string[] = [];

  for (const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    const candidate = match[1]?.trim();
    if (candidate) candidates.push(candidate);
  }

  for (let index = 0; index < text.length; index += 1) {
    const opening = text[index];
    if (opening !== '{' && opening !== '[') continue;
    const closing = opening === '{' ? '}' : ']';
    const end = findBalancedJsonEnd(text, index, opening, closing);
    if (end < 0) continue;
    candidates.push(text.slice(index, end + 1).trim());
    index = end;
  }

  return Array.from(new Set(candidates));
}

function parseStructuredCreditRows(raw: string): Array<Record<string, unknown>> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    const directRows = Array.isArray(parsed) ? parsed : null;
    if (
      directRows &&
      directRows.length > 0 &&
      !directRows.every((row) => Boolean(row) && typeof row === 'object' && !Array.isArray(row))
    ) {
      return null;
    }
    const rows =
      directRows ||
      (parsed &&
      typeof parsed === 'object' &&
      Array.isArray((parsed as { creditItems?: unknown }).creditItems)
        ? (parsed as { creditItems: unknown[] }).creditItems
        : null);
    if (!rows) return null;
    return rows.filter(
      (row): row is Record<string, unknown> =>
        Boolean(row) && typeof row === 'object' && !Array.isArray(row)
    );
  } catch {
    return null;
  }
}

function findStructuredCreditRows(answer: string): Array<Record<string, unknown>> | null {
  for (const candidate of collectStructuredJsonCandidates(answer)) {
    const rows = parseStructuredCreditRows(candidate);
    if (rows !== null) return rows;
  }
  return null;
}

export function extractCreditStructuredItems(answer: string): CreditExtractedItem[] {
  const rows = findStructuredCreditRows(answer);
  if (rows === null) return [];

  const items: Array<CreditExtractedItem | null> = rows.map((item, index) => {
    const title = cleanCreditFieldValue(String(item.title || item.product || item.platform || ''));
    const rawProductType = String(item.productType || item.type || '').trim();
    const productType = inferCreditProductTypeLabel(rawProductType, title);
    const dueAmount = cleanCreditFieldValue(String(item.dueAmount || ''));
    const totalDebt = cleanCreditFieldValue(String(item.totalDebt || item.remainingDebt || ''));
    const repaymentDate = cleanCreditFieldValue(String(item.repaymentDate || item.dueDate || ''));
    const remainingPeriods = cleanCreditFieldValue(
      String(item.remainingPeriods || item.periodsLeft || '')
    );
    const monthlyAmount = cleanCreditFieldValue(
      String(item.monthlyAmount || item.perPeriodAmount || '')
    );
    const interest = cleanCreditFieldValue(String(item.interest || item.fee || ''));
    const rateType = String(item.rateType || item.rateLabel || '').trim();
    const rateSource: CreditExtractedItem['rateSource'] =
      item.rateSource === 'explicit' ||
      item.rateSource === 'inferred' ||
      item.rateSource === 'pending'
        ? item.rateSource
        : undefined;
    const riskHint = String(item.riskHint || item.risk || '').trim();
    const actionSuggestion = String(item.actionSuggestion || item.nextStep || '').trim();
    const modelPendingFields = Array.isArray(item.pendingFields)
      ? item.pendingFields.map((field) => String(field).trim()).filter(Boolean)
      : [];
    const pendingFields = deriveCreditPendingFields(
      {
        title,
        dueAmount,
        totalDebt,
        repaymentDate,
        remainingPeriods,
        monthlyAmount,
        interest,
        rateType
      },
      modelPendingFields
    );
    const confidence: CreditExtractedItem['confidence'] =
      item.confidence === 'high' || item.confidence === 'medium' || item.confidence === 'low'
        ? item.confidence
        : 'medium';

    if (
      !title &&
      !hasSubstantiveCreditFields({
        dueAmount,
        totalDebt,
        repaymentDate,
        remainingPeriods,
        monthlyAmount,
        interest
      })
    ) {
      return null;
    }

    return {
      id: `credit-${index}-${title || productType || 'unknown'}`,
      title: title || '待确认信贷项目',
      productType: productType === '待识别' ? '其他' : productType,
      dueAmount: dueAmount || undefined,
      totalDebt: totalDebt || undefined,
      repaymentDate: repaymentDate || undefined,
      remainingPeriods: remainingPeriods || undefined,
      monthlyAmount: monthlyAmount || undefined,
      interest: interest || undefined,
      rateType: rateType || undefined,
      rateSource,
      riskHint: riskHint || undefined,
      actionSuggestion: actionSuggestion || undefined,
      pendingFields,
      confidence
    };
  });

  return items.filter((item): item is CreditExtractedItem => item !== null);
}

export function stripCreditJsonBlock(answer: string): string {
  let stripped = String(answer || '').replace(
    /```(?:json)?\s*([\s\S]*?)```/gi,
    (block, body: string) => (parseStructuredCreditRows(body.trim()) === null ? block : '')
  );

  for (const candidate of collectStructuredJsonCandidates(stripped)) {
    if (parseStructuredCreditRows(candidate) === null) continue;
    stripped = stripped.replace(candidate, '');
  }

  return stripped.replace(/\n{3,}/g, '\n\n').trim();
}

export function buildCreditAssistantMessageText(answer: string): string {
  const plain = stripCreditJsonBlock(answer).trim();
  if (!plain) return answer.trim();
  return plain;
}
