import { postSyncChange, SyncChangeRequest } from '../api/syncClient';

export type SyncDbType = 'redis';

type QueuedSyncChange = Omit<SyncChangeRequest, 'happenedAt'> & {
  happenedAt: string;
  queuedAt: string;
};

const OFFLINE_QUEUE_KEY = 'ledgerflow.sync.offline-queue.v1';
let syncInitialized = false;
let flushing = false;

function readQueue(): QueuedSyncChange[] {
  try {
    const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as QueuedSyncChange[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeQueue(queue: QueuedSyncChange[]) {
  localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue.slice(-200)));
}

async function flushSyncQueue() {
  if (flushing || !navigator.onLine) return;
  const queue = readQueue();
  if (queue.length === 0) return;
  flushing = true;
  try {
    const pending: QueuedSyncChange[] = [];
    for (const item of queue) {
      try {
        await postSyncChange({
          entity: item.entity,
          action: item.action,
          row: item.row,
          id: item.id,
          happenedAt: item.happenedAt
        });
      } catch {
        pending.push(item);
      }
    }
    writeQueue(pending);
  } finally {
    flushing = false;
  }
}

export function initOfflineSyncQueue() {
  if (syncInitialized || typeof window === 'undefined') return;
  syncInitialized = true;
  window.addEventListener('online', () => {
    void flushSyncQueue();
  });
  void flushSyncQueue();
}

export function hasEnabledSqlConnection() {
  return false;
}

export function resolveSyncTargetDbType(): SyncDbType | null {
  return null;
}

export async function syncChangeIfNeeded(payload: Omit<SyncChangeRequest, 'happenedAt'>) {
  const row: QueuedSyncChange = {
    ...payload,
    happenedAt: new Date().toISOString(),
    queuedAt: new Date().toISOString()
  };

  if (!navigator.onLine) {
    const queue = readQueue();
    queue.push(row);
    writeQueue(queue);
    return;
  }

  try {
    await postSyncChange({ ...payload, happenedAt: row.happenedAt });
  } catch {
    const queue = readQueue();
    queue.push(row);
    writeQueue(queue);
  }
}
