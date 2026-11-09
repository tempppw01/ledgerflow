import { describe, expect, it } from 'vitest';
import {
  buildCreditAssistantMessageText,
  extractCreditStructuredItems,
  extractStreamingCreditPreview,
  stripCreditJsonBlock
} from './parser';

describe('creditAssistant parser', () => {
  it('extracts structured items from assistant json blocks', () => {
    const answer = [
      '这里是总结。',
      '```json',
      JSON.stringify(
        {
          creditItems: [
            {
              title: '花呗分期',
              productType: '消费贷',
              dueAmount: '¥800',
              totalDebt: '¥3200',
              repaymentDate: '每月 8 日',
              rateType: 'APR',
              rateSource: 'explicit',
              confidence: 'high'
            }
          ]
        },
        null,
        2
      ),
      '```'
    ].join('\n');

    expect(extractCreditStructuredItems(answer)).toEqual([
      expect.objectContaining({
        title: '花呗分期',
        productType: '消费贷',
        dueAmount: '¥800',
        totalDebt: '¥3200',
        repaymentDate: '每月 8 日',
        rateType: 'APR',
        rateSource: 'explicit',
        confidence: 'high'
      })
    ]);
  });

  it('accepts plain JSON without a markdown fence', () => {
    const answer = JSON.stringify({
      creditItems: [
        {
          title: '招商银行信用卡',
          productType: '信用卡',
          dueAmount: '¥1200',
          repaymentDate: '每月 20 日'
        }
      ]
    });

    expect(extractCreditStructuredItems(answer)).toEqual([
      expect.objectContaining({
        title: '招商银行信用卡',
        productType: '信用卡',
        dueAmount: '¥1200'
      })
    ]);
  });

  it('finds a balanced JSON object surrounded by explanatory text', () => {
    const payload = JSON.stringify({
      creditItems: [
        {
          title: '招行信用卡',
          productType: '信用卡',
          totalDebt: '¥6800',
          note: '说明中允许出现 {花括号} 和 "引号"'
        }
      ]
    });
    const answer = `我先说明一下解析结果,示例数组 [1, 2]。\n${payload}\n以上信息请确认后再保存。`;

    expect(extractCreditStructuredItems(answer)).toEqual([
      expect.objectContaining({
        title: '招行信用卡',
        totalDebt: '¥6800'
      })
    ]);
  });

  it('strips plain balanced credit JSON from surrounding assistant copy', () => {
    const answer = `解析结果如下。\n${JSON.stringify({
      creditItems: [{ title: '招商银行信用卡', dueAmount: '¥3200' }]
    })}\n请确认卡片信息。`;
    const message = buildCreditAssistantMessageText(answer);

    expect(message).toBe('解析结果如下。\n\n请确认卡片信息。');
    expect(message).not.toContain('creditItems');
  });

  it('keeps all structured items when the model returns more than three', () => {
    const answer = JSON.stringify({
      creditItems: Array.from({ length: 5 }, (_, index) => ({
        title: `信贷项目 ${index + 1}`,
        productType: '信用卡',
        dueAmount: `¥${index + 1}00`
      }))
    });

    expect(extractCreditStructuredItems(answer)).toHaveLength(5);
  });

  it('drops empty rows and rows that only contain an inferred product category', () => {
    const answer = JSON.stringify({
      creditItems: [
        {},
        { productType: '信用卡', confidence: 'high' },
        { title: '招商银行信用卡', dueAmount: '¥3200' }
      ]
    });

    expect(extractCreditStructuredItems(answer)).toEqual([
      expect.objectContaining({
        title: '招商银行信用卡',
        productType: '信用卡'
      })
    ]);
  });

  it('extracts every streaming preview card instead of hard-limiting to three', () => {
    const answer = [
      '产品：招行信用卡',
      '当前应还：¥1200',
      '还款日：每月12日',
      '',
      '产品：花呗',
      '总待还：¥3000',
      '月供：¥500',
      '',
      '产品：房贷',
      '当前应还：¥4200',
      '',
      '产品：不应该出现在预览里的第四项',
      '当前应还：¥1'
    ].join('\n');

    const preview = extractStreamingCreditPreview(answer);
    expect(preview).toHaveLength(4);
    expect(preview[0]).toEqual(
      expect.objectContaining({
        title: '招行信用卡',
        productType: '信用卡',
        dueAmount: '¥1200'
      })
    );
    expect(preview[1].pendingFields).toContain('当前应还');
    expect(preview[3].title).toBe('不应该出现在预览里的第四项');
  });

  it('prefers the explicit credit-card label over a generic installment label', () => {
    const answer = [
      '```json',
      JSON.stringify(
        {
          creditItems: [
            {
              title: '招商银行信用卡',
              productType: '消费贷/信用卡分期',
              totalDebt: '¥5000',
              repaymentDate: '11月20日'
            }
          ]
        },
        null,
        2
      ),
      '```'
    ].join('\n');

    const [item] = extractCreditStructuredItems(answer);
    expect(item.productType).toBe('信用卡');
  });

  it('strips json blocks when building short credit assistant copy', () => {
    const answer = [
      '第一段说明。',
      '',
      '第二段说明。',
      '',
      '```json',
      '{"creditItems":[]}',
      '```'
    ].join('\n');

    expect(stripCreditJsonBlock(answer)).toContain('第一段说明。');
    expect(stripCreditJsonBlock(answer)).not.toContain('creditItems');
    expect(buildCreditAssistantMessageText(answer)).toBe('第一段说明。\n\n第二段说明。');
  });

  it('keeps the complete assistant response instead of truncating it', () => {
    const longParagraph = '这是需要完整保留的信贷说明。'.repeat(40);
    const answer = [
      '第一段说明。',
      '',
      longParagraph,
      '',
      '第三段说明。',
      '',
      '第四段说明。',
      '',
      '```json',
      '{"creditItems":[]}',
      '```'
    ].join('\n');
    const message = buildCreditAssistantMessageText(answer);

    expect(message).toContain(longParagraph);
    expect(message).toContain('第三段说明。');
    expect(message).toContain('第四段说明。');
    expect(message).not.toContain('creditItems');
  });

  it('derives missing fields from actual values instead of trusting the model list', () => {
    const answer = [
      '```json',
      JSON.stringify(
        {
          creditItems: [
            {
              title: '招商银行信用卡',
              dueAmount: '待补充',
              totalDebt: '¥12860.40',
              repaymentDate: '每月 25 日',
              pendingFields: []
            }
          ]
        },
        null,
        2
      ),
      '```'
    ].join('\n');

    const [item] = extractCreditStructuredItems(answer);
    expect(item.pendingFields).toEqual(['当前应还', '剩余期数', '每期金额', '利息/费率']);
  });
});
