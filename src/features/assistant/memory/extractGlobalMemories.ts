import { sendAiChat } from '../api/openaiCompatibleClient';
import { fetchEmbeddings } from '../api/openaiEmbeddingClient';
import type {
  GlobalMemoryDraft,
  GlobalMemorySourceKind,
  GlobalMemoryType
} from '../../../shared/store/globalMemory';

export interface AssistantChatHistoryItemLite {
  role: 'user' | 'assistant';
  text: string;
}

interface ExtractedMemoryRow {
  title: string;
  content: string;
  type: GlobalMemoryType;
  confidence?: number;
}

const SUPPORTED_TYPES: GlobalMemoryType[] = [
  'user_preference',
  'financial_habit',
  'risk_preference',
  'display_preference'
];

function normalizeType(value: unknown): GlobalMemoryType | null {
  return SUPPORTED_TYPES.includes(value as GlobalMemoryType) ? (value as GlobalMemoryType) : null;
}

export async function extractGlobalMemoriesFromConversation(params: {
  baseUrl: string;
  apiKey: string;
  model: string;
  embeddingModel: string;
  history: AssistantChatHistoryItemLite[];
  source: GlobalMemorySourceKind;
  signal?: AbortSignal;
}): Promise<GlobalMemoryDraft[]> {
  const { baseUrl, apiKey, model, embeddingModel, history, source, signal } = params;
  const turns = history
    .filter((item) => item.text.trim())
    .slice(-10)
    .map((item) => `${item.role === 'user' ? '用户' : '助手'}：${item.text.trim()}`)
    .join('\n');

  if (!turns || !embeddingModel.trim()) return [];

  const reply = await sendAiChat({
    baseUrl,
    apiKey,
    model,
    signal,
    systemPrompt:
      '你是长期偏好提炼器。请只从多轮对话中提炼稳定、长期、有产品价值的用户偏好。宁可少提，也不要猜。同一主题只保留 1 条更完整的记忆，禁止把同一事实拆成多个近义标题；如果支付方式、消费时段、频率等属于同一个稳定习惯，应合并到同一条 content 中。只返回 JSON 数组，格式：[{"title":"...","content":"...","type":"user_preference|financial_habit|risk_preference|display_preference","confidence":0.00}]。不要输出其他说明。禁止提取一次性任务、临时情绪、模糊猜测。',
    messages: [
      {
        role: 'user',
        text: `请从下面对话中提炼最多 3 条长期记忆：\n\n${turns}`
      }
    ]
  });

  const normalized = reply.content.trim().replace(/^```json\s*/i, '').replace(/```$/i, '');
  const parsed = JSON.parse(normalized) as ExtractedMemoryRow[];
  if (!Array.isArray(parsed)) return [];

  const candidates = parsed
    .map((item): GlobalMemoryDraft | null => {
      const title = String(item?.title || '').trim();
      const content = String(item?.content || '').trim();
      const type = normalizeType(item?.type);
      const confidence = Number(item?.confidence || 0);
      if (!title || !content || !type) return null;
      const normalizedConfidence = Number.isFinite(confidence)
        ? Math.max(0, Math.min(1, confidence))
        : 0.7;
      return {
        title,
        content,
        type,
        source,
        origin: 'extracted',
        confidence: normalizedConfidence,
        score: normalizedConfidence,
        embeddingText: [title, content, type].join('\n'),
        sourceTrace: [
          {
            kind: source,
            label: '多轮对话自动提炼（LLM + Embedding）',
            excerpt: content,
            recordedAt: new Date().toISOString()
          }
        ]
      };
    })
    .filter((item): item is GlobalMemoryDraft => item !== null)
    .slice(0, 3);

  if (!candidates.length) return [];

  const vectors = await fetchEmbeddings({
    baseUrl,
    apiKey,
    model: embeddingModel.trim(),
    inputs: candidates.map((item) => item.embeddingText || `${item.title}\n${item.content}\n${item.type}`),
    signal
  });

  return candidates.filter((_, index) => Array.isArray(vectors[index]) && vectors[index].length > 0);
}
