export const LEDGERFLOW_API_TOKEN_STORAGE_KEY = 'ledgerflow-mysql-snapshot-api-token';

export function readStoredLedgerflowApiToken() {
  try {
    return window.localStorage.getItem(LEDGERFLOW_API_TOKEN_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function writeStoredLedgerflowApiToken(value: string) {
  try {
    const token = value.trim();
    if (token) {
      window.localStorage.setItem(LEDGERFLOW_API_TOKEN_STORAGE_KEY, token);
      return;
    }
    window.localStorage.removeItem(LEDGERFLOW_API_TOKEN_STORAGE_KEY);
  } catch {
    // ignore storage errors
  }
}
