import { useCallback, useRef, useState, type FormEvent } from 'react';
import type { DebtItem, RepaymentRecord } from '../model/debtMetrics';
import type { CreditDraft } from '../model/creditDrafts';
import {
  parseCreditDraftFragment,
  upsertCreditDraft as mergeCreditDraftList
} from '../model/creditDrafts';
import {
  buildCreditAgentSystemPrompt,
  runCreditAgentCommand
} from '../../assistant/agent/creditAgentRunner';
import type { CreditAgentContext } from '../../assistant/agent/creditAgentTools';
import type { AgentActionView } from '../../assistant/agent/assistantAgentTools';

export interface RepaymentAgentBarProps {
  baseUrl: string;
  apiKey: string;
  model: string;
  debts: DebtItem[];
  repaymentRecords: RepaymentRecord[];
  monthlyIncome: number;
  addDebt: (payload: Omit<DebtItem, 'id'> & { id?: string }) => string;
  updateDebt: (id: string, payload: Omit<DebtItem, 'id'>) => void;
  removeDebt: (id: string) => void;
  addRepaymentRecord: (
    payload: Omit<RepaymentRecord, 'id' | 'createdAt'> & { id?: string; createdAt?: string }
  ) => string;
  removeRepaymentRecord: (id: string) => void;
  creditDrafts: CreditDraft[];
  upsertCreditDraft: (payload: Partial<CreditDraft>) => string;
  removeCreditDraft: (id: string) => void;
}

const QUICK_COMMANDS = ['本月还了多少、还差多少?', '哪几笔最该先还?', '花呗这个月还了吗?'] as const;

const ACTION_KIND_LABELS: Record<AgentActionView['kind'], string> = {
  read: '查询',
  create: '新增',
  update: '修改',
  delete: '删除'
};

/**
 * 还款管理页内嵌的信贷 Agent:用自然语言查询或被授权地改动台账,
 * 每次改动都保留可撤销记录。
 */
export function RepaymentAgentBar(props: RepaymentAgentBarProps) {
  const {
    baseUrl,
    apiKey,
    model,
    debts,
    repaymentRecords,
    monthlyIncome,
    creditDrafts,
    addDebt,
    updateDebt,
    removeDebt,
    addRepaymentRecord,
    removeRepaymentRecord,
    upsertCreditDraft,
    removeCreditDraft
  } = props;
  const [input, setInput] = useState('');
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const [actions, setActions] = useState<AgentActionView[]>([]);
  const undoRef = useRef(new Map<string, () => void>());
  const runningRef = useRef(false);

  const buildContext = useCallback(
    (drafts = creditDrafts): CreditAgentContext => ({
      debts: [...debts],
      repaymentRecords: [...repaymentRecords],
      creditDrafts: [...drafts],
      monthlyIncome,
      addDebt,
      updateDebt,
      removeDebt,
      addRepaymentRecord,
      removeRepaymentRecord,
      upsertCreditDraft,
      removeCreditDraft
    }),
    [
      addDebt,
      addRepaymentRecord,
      creditDrafts,
      debts,
      monthlyIncome,
      removeCreditDraft,
      removeDebt,
      removeRepaymentRecord,
      repaymentRecords,
      updateDebt,
      upsertCreditDraft
    ]
  );

  const run = useCallback(
    async (command: string) => {
      const text = command.trim();
      if (!text || runningRef.current) return;
      if (!apiKey.trim() || !model.trim()) {
        setError('请先在设置页配置可用的 AI 模型与 API Key。');
        return;
      }
      runningRef.current = true;
      setRunning(true);
      setError('');
      setAnswer('');
      undoRef.current.clear();
      setActions([]);
      try {
        let activeCreditDrafts = creditDrafts;
        const fragment = parseCreditDraftFragment(text);
        if (fragment) {
          const merged = mergeCreditDraftList(activeCreditDrafts, fragment);
          activeCreditDrafts = merged.drafts;
          upsertCreditDraft(merged.draft);
        }
        const ctx = buildContext(activeCreditDrafts);
        const result = await runCreditAgentCommand({
          baseUrl,
          apiKey,
          model,
          systemPrompt: buildCreditAgentSystemPrompt(ctx),
          text,
          ctx
        });
        result.undo.forEach((entry) => undoRef.current.set(entry.id, entry.run));
        setActions(result.actions);
        setAnswer(
          result.content.trim() ||
            (result.actions.length > 0
              ? `已按你的要求处理:${result.actions.map((action) => action.label).join(';')}`
              : '没有可返回的结果,请换个说法再试。')
        );
        setInput('');
      } catch (err) {
        setError((err as Error).message || '处理失败,请检查模型配置后重试。');
      } finally {
        runningRef.current = false;
        setRunning(false);
      }
    },
    [apiKey, baseUrl, buildContext, creditDrafts, model, upsertCreditDraft]
  );

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void run(input);
  };

  const undo = (actionId: string) => {
    const handler = undoRef.current.get(actionId);
    if (!handler) return;
    try {
      handler();
      undoRef.current.delete(actionId);
      setActions((prev) => prev.filter((item) => item.id !== actionId));
    } catch (err) {
      setError((err as Error).message || '撤销失败');
    }
  };

  return (
    <div className="repayment-agent-bar">
      <form className="repayment-agent-input" onSubmit={onSubmit}>
        <label className="repayment-agent-label" htmlFor="repayment-agent-command">
          AI 台账助手
        </label>
        <div className="repayment-agent-input-row">
          <input
            id="repayment-agent-command"
            type="text"
            value={input}
            placeholder="直接说,例如“花呗今天还了 300”“哪笔最该先还”"
            onChange={(event) => setInput(event.target.value)}
            disabled={running}
          />
          <button type="submit" disabled={running || !input.trim()}>
            {running ? '处理中...' : '执行'}
          </button>
        </div>
      </form>

      <div className="repayment-agent-quick">
        {QUICK_COMMANDS.map((command) => (
          <button key={command} type="button" onClick={() => void run(command)} disabled={running}>
            {command}
          </button>
        ))}
      </div>

      {error ? <p className="repayment-agent-error">{error}</p> : null}

      {answer ? (
        <div className="repayment-agent-result">
          <p className="repayment-agent-answer">{answer}</p>
          {actions.length > 0 ? (
            <div className="repayment-agent-actions">
              <span className="repayment-agent-actions-head">
                {actions.some((action) => action.kind !== 'read') ? '本次操作' : '本次查询'}
              </span>
              {actions.map((action) => (
                <div key={action.id} className={`repayment-agent-action is-${action.kind}`}>
                  <b>{ACTION_KIND_LABELS[action.kind]}</b>
                  <span>{action.label}</span>
                  {action.undoable ? (
                    <button type="button" onClick={() => undo(action.id)}>
                      撤销
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
