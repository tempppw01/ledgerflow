import { sendAiChat } from '../api/openaiCompatibleClient';
import {
  CREDIT_ANALYSIS_AGENT_PROMPT,
  buildRepaymentPromptContext
} from '../workbench/workbenchUtils';
import { calculateDebtSummary } from '../../debt/model/debtMetrics';
import { buildCreditDraftPromptContext } from '../../debt/model/creditDrafts';
import type { AgentActionView, AgentToolExecution } from './assistantAgentTools';
import {
  CREDIT_AGENT_INSTRUCTIONS,
  CREDIT_AGENT_TOOLS,
  executeCreditToolCall,
  type CreditAgentContext
} from './creditAgentTools';

type SendAiChatInput = Parameters<typeof sendAiChat>[0];
type AgentMessage = SendAiChatInput['messages'][number];

/** 还款管理页与信贷管家共用的 Agent 单次提问内最大「模型 → 工具 → 模型」轮次。 */
const MAX_CREDIT_AGENT_ROUNDS = 5;

export interface CreditAgentUndoEntry {
  id: string;
  run: () => void;
}

export interface CreditAgentRunResult {
  content: string;
  reasoning: string;
  actions: AgentActionView[];
  undo: CreditAgentUndoEntry[];
}

/** 组合信贷管家系统提示词:分析边界 + 工具规则 + 当前台账快照。 */
export function buildCreditAgentSystemPrompt(ctx: CreditAgentContext): string {
  const summary = calculateDebtSummary(ctx.debts, ctx.monthlyIncome);
  const repaymentContext = buildRepaymentPromptContext({
    debts: ctx.debts,
    repaymentRecords: ctx.repaymentRecords
  });
  const overview = [
    `当前台账:${ctx.debts.length} 笔负债,总待还 ¥${summary.totalDebt.toFixed(2)}`,
    `每月应还 ¥${summary.totalMinimumPayment.toFixed(2)}`,
    `负债压力 ${(summary.pressureRatio * 100).toFixed(1)}%`,
    `月收入 ¥${(Number(ctx.monthlyIncome) || 0).toFixed(2)}`
  ].join(';');
  const draftContext = buildCreditDraftPromptContext(ctx.creditDrafts);
  return [
    CREDIT_ANALYSIS_AGENT_PROMPT,
    CREDIT_AGENT_INSTRUCTIONS,
    overview,
    repaymentContext,
    draftContext
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * 非流式的信贷 Agent 循环:模型可先读台账、再增删改,最后用自然语言总结。
 * 与服务商不兼容 tools 时自动降级为纯对话。
 */
export async function runCreditAgentCommand(input: {
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  text: string;
  ctx: CreditAgentContext;
  signal?: AbortSignal;
  maxRounds?: number;
}): Promise<CreditAgentRunResult> {
  const messages: AgentMessage[] = [{ role: 'user', text: input.text }];
  const actions: AgentActionView[] = [];
  const undo: CreditAgentUndoEntry[] = [];
  const maxRounds = Math.max(1, input.maxRounds ?? MAX_CREDIT_AGENT_ROUNDS);
  let content = '';
  let reasoning = '';
  let toolsAvailable = true;

  const request = (useTools: boolean) =>
    sendAiChat({
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
      model: input.model,
      systemPrompt: input.systemPrompt,
      messages,
      signal: input.signal,
      tools: useTools ? CREDIT_AGENT_TOOLS : undefined
    });

  for (let round = 0; round < maxRounds; round += 1) {
    let reply;
    try {
      reply = await request(toolsAvailable);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (toolsAvailable && /HTTP_(400|404|422)/.test(message)) {
        toolsAvailable = false;
        reply = await request(false);
      } else {
        throw error;
      }
    }

    content = reply.content || content;
    reasoning = reply.reasoning || reasoning;
    const calls = reply.toolCalls || [];
    if (calls.length === 0) break;

    messages.push({
      role: 'assistant',
      text: reply.content || '',
      toolCalls: calls.map((call) => ({
        id: call.id,
        type: 'function' as const,
        function: { name: call.name, arguments: call.arguments }
      }))
    });

    calls.forEach((call) => {
      let execution: AgentToolExecution;
      try {
        execution = executeCreditToolCall(call, input.ctx);
      } catch (error) {
        execution = {
          content: JSON.stringify({
            ok: false,
            error: error instanceof Error ? error.message : '工具执行失败'
          }),
          views: [],
          undo: []
        };
      }
      actions.push(...execution.views);
      undo.push(...execution.undo);
      messages.push({ role: 'tool', text: execution.content, toolCallId: call.id });
    });
  }

  return { content, reasoning, actions, undo };
}
