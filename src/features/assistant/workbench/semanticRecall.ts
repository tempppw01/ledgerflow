import type { Account } from '../../../entities/account/types';
import type { Category } from '../../../entities/category/types';
import type { TransactionItem } from '../../../entities/transaction/types';
import { fetchEmbeddings } from '../api/openaiEmbeddingClient';
import { resolveTransactionLocalDay } from '../../../shared/lib/localDate';

const EMBEDDING_CACHE_PREFIX = 'ledgerflow-assistant-embedding-index-v1';
const MAX_INDEX_TRANSACTIONS = 180;
const EMBEDDING_BATCH_SIZE = 20;
const TOP_K = 6;
const MIN_SCORE = 0.58;

interface EmbeddingDoc {
  id: string;
  hash: string;
  text: string;
  vector: number[];
}

interface EmbeddingCachePayload {
  version: number;
  model: string;
  updatedAt: number;
  docs: EmbeddingDoc[];
}

export interface SemanticRecallHit {
  id: string;
  score: number;
  text: string;
}

interface SearchResult {
  id: string;
  score: number;
  text: string;
}

function hashText(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 33) ^ text.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}

function normalizeVector(vector: number[]): number[] {
  if (!Array.isArray(vector) || vector.length === 0) return [];
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!Number.isFinite(norm) || norm <= 0) return vector;
  return vector.map((value) => value / norm);
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return -1;
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
  }
  return dot;
}

function cacheKey(baseUrl: string, model: string): string {
  return `${EMBEDDING_CACHE_PREFIX}:${encodeURIComponent(baseUrl)}:${encodeURIComponent(model)}`;
}

export function getSemanticRecallCacheMeta(baseUrl: string, model: string): {
  exists: boolean;
  model: string;
  updatedAt: number;
  indexedDocs: number;
} {
  const cache = readCache(baseUrl, model);
  if (!cache) {
    return { exists: false, model, updatedAt: 0, indexedDocs: 0 };
  }
  return {
    exists: true,
    model: cache.model,
    updatedAt: cache.updatedAt,
    indexedDocs: Array.isArray(cache.docs) ? cache.docs.length : 0
  };
}

export function clearSemanticRecallCache(baseUrl: string, model: string) {
  try {
    window.localStorage.removeItem(cacheKey(baseUrl, model));
  } catch {
    // ignore storage remove errors
  }
}

function readCache(baseUrl: string, model: string): EmbeddingCachePayload | null {
  try {
    const raw = window.localStorage.getItem(cacheKey(baseUrl, model));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as EmbeddingCachePayload;
    if (!parsed || !Array.isArray(parsed.docs) || parsed.model !== model) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(baseUrl: string, model: string, docs: EmbeddingDoc[]) {
  try {
    const payload: EmbeddingCachePayload = {
      version: 1,
      model,
      updatedAt: Date.now(),
      docs
    };
    window.localStorage.setItem(cacheKey(baseUrl, model), JSON.stringify(payload));
  } catch {
    // ignore cache write errors
  }
}

function chunk<T>(list: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < list.length; i += size) {
    batches.push(list.slice(i, i + size));
  }
  return batches;
}

function buildTransactionDocs(
  transactions: TransactionItem[],
  categories: Category[],
  accounts: Account[]
): Array<{ id: string; hash: string; text: string }> {
  const categoryMap = new Map(categories.map((item) => [item.id, item.name]));
  const accountMap = new Map(accounts.map((item) => [item.id, item.name]));

  return [...transactions]
    .sort((a, b) => +new Date(b.date) - +new Date(a.date))
    .slice(0, MAX_INDEX_TRANSACTIONS)
    .map((tx) => {
      const date = resolveTransactionLocalDay(tx.date);
      const categoryName = categoryMap.get(tx.categoryId) || tx.categoryId || '未分类';
      const accountName = accountMap.get(tx.accountId) || tx.accountId || '未指定账户';
      const text = [
        `日期:${date}`,
        `类型:${tx.type}`,
        `金额:${Number(tx.amount || 0).toFixed(2)}`,
        `分类:${categoryName}`,
        `账户:${accountName}`,
        `备注:${tx.note || '无'}`,
        `标签:${Array.isArray(tx.tags) && tx.tags.length > 0 ? tx.tags.join('、') : '无'}`
      ].join(' | ');

      return {
        id: tx.id,
        hash: hashText(text),
        text
      };
    });
}

async function ensureIndex(
  params: {
    baseUrl: string;
    apiKey: string;
    model: string;
    docs: Array<{ id: string; hash: string; text: string }>;
    signal?: AbortSignal;
  }
): Promise<EmbeddingDoc[]> {
  const { baseUrl, apiKey, model, docs, signal } = params;
  const cache = readCache(baseUrl, model);
  const cachedById = new Map((cache?.docs || []).map((item) => [item.id, item]));

  const kept: EmbeddingDoc[] = [];
  const pending: Array<{ id: string; hash: string; text: string }> = [];

  for (const doc of docs) {
    const existing = cachedById.get(doc.id);
    if (existing && existing.hash === doc.hash && existing.vector.length > 0) {
      kept.push(existing);
      continue;
    }
    pending.push(doc);
  }

  if (pending.length === 0) {
    const nextDocs = docs
      .map((item) => kept.find((k) => k.id === item.id))
      .filter((item): item is EmbeddingDoc => Boolean(item));
    writeCache(baseUrl, model, nextDocs);
    return nextDocs;
  }

  const embedded: EmbeddingDoc[] = [];
  const batches = chunk(pending, EMBEDDING_BATCH_SIZE);
  for (const batch of batches) {
    const vectors = await fetchEmbeddings({
      baseUrl,
      apiKey,
      model,
      inputs: batch.map((item) => item.text),
      signal
    });
    for (let i = 0; i < batch.length; i += 1) {
      const vector = normalizeVector(vectors[i] || []);
      if (vector.length === 0) continue;
      embedded.push({
        id: batch[i].id,
        hash: batch[i].hash,
        text: batch[i].text,
        vector
      });
    }
  }

  const nextDocs = docs
    .map((item) => {
      const fromKept = kept.find((k) => k.id === item.id);
      if (fromKept) return fromKept;
      return embedded.find((e) => e.id === item.id);
    })
    .filter((item): item is EmbeddingDoc => Boolean(item));

  writeCache(baseUrl, model, nextDocs);
  return nextDocs;
}

function search(
  docs: EmbeddingDoc[],
  queryVector: number[],
  topK = TOP_K,
  minScore = MIN_SCORE
): SearchResult[] {
  return docs
    .map((doc) => ({ id: doc.id, score: cosineSimilarity(doc.vector, queryVector), text: doc.text }))
    .filter((item) => Number.isFinite(item.score) && item.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

export async function buildSemanticRecallContext(params: {
  baseUrl: string;
  apiKey: string;
  model: string;
  question: string;
  transactions: TransactionItem[];
  categories: Category[];
  accounts: Account[];
  signal?: AbortSignal;
}): Promise<{ context: string; hitCount: number; topScore: number; averageScore: number; latencyMs: number; indexedDocs: number; hits: SemanticRecallHit[] } | null> {
  const { baseUrl, apiKey, model, question, transactions, categories, accounts, signal } = params;
  const startedAt = performance.now();
  const cleanQuestion = question.trim();
  if (!cleanQuestion) return null;

  const sourceDocs = buildTransactionDocs(transactions, categories, accounts);
  if (sourceDocs.length === 0) return null;

  const indexedDocs = await ensureIndex({
    baseUrl,
    apiKey,
    model,
    docs: sourceDocs,
    signal
  });
  if (indexedDocs.length === 0) return null;

  const [queryVectorRaw] = await fetchEmbeddings({
    baseUrl,
    apiKey,
    model,
    inputs: [cleanQuestion],
    signal
  });
  const queryVector = normalizeVector(queryVectorRaw || []);
  if (queryVector.length === 0) return null;

  const hits = search(indexedDocs, queryVector);
  if (hits.length === 0) return null;

  const context = hits
    .map((item, index) => `${index + 1}. [相似度 ${item.score.toFixed(2)}] ${item.text}`)
    .join('\n');

  const averageScore = hits.reduce((sum, item) => sum + item.score, 0) / Math.max(1, hits.length);
  const latencyMs = Math.round(performance.now() - startedAt);

  return {
    context,
    hitCount: hits.length,
    topScore: hits[0]?.score || 0,
    averageScore,
    latencyMs,
    indexedDocs: indexedDocs.length,
    hits: hits.map((item) => ({ id: item.id, score: item.score, text: item.text }))
  };
}
