import '@testing-library/jest-dom';

// Node 22+ exposes an experimental global `localStorage` that is `typeof` "object"
// but throws when used unless --localstorage-file is passed. Probing it is the only
// reliable check; zustand's persist middleware needs a storage that really works.
function createMemoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, String(value)),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    get length() {
      return values.size;
    }
  };
}

function isStorageUsable(storage: unknown): boolean {
  if (!storage) return false;
  try {
    const probe = '__ledgerflow_probe__';
    (storage as Storage).setItem(probe, '1');
    (storage as Storage).removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

if (!isStorageUsable(globalThis.localStorage)) {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: createMemoryStorage()
  });
}

if (!isStorageUsable(globalThis.sessionStorage)) {
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    writable: true,
    value: createMemoryStorage()
  });
}
