import { beforeEach, describe, expect, it } from 'vitest';
import { clearScopedBrowserData, ensureDeploymentScope } from './deploymentScope';

describe('deploymentScope', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('clears old deployment ledger and secret caches when the deployment changes', () => {
    localStorage.setItem('ledgerflow-deployment-instance', 'deployment-old');
    localStorage.setItem('ledgerflow-finance', '{"state":{"transactions":[{"id":"old"}]}}');
    localStorage.setItem('ledgerflow-ai-settings-api-key-persistent', 'sk-old');
    sessionStorage.setItem('ledgerflow-ai-settings-api-key', 'session-old');
    localStorage.setItem('unrelated-key', 'keep');

    expect(ensureDeploymentScope('deployment-new')).toBe(true);

    expect(localStorage.getItem('ledgerflow-deployment-instance')).toBe('deployment-new');
    expect(localStorage.getItem('ledgerflow-finance')).toBeNull();
    expect(localStorage.getItem('ledgerflow-ai-settings-api-key-persistent')).toBeNull();
    expect(sessionStorage.getItem('ledgerflow-ai-settings-api-key')).toBeNull();
    expect(localStorage.getItem('unrelated-key')).toBe('keep');
  });

  it('keeps scoped data for the same deployment', () => {
    localStorage.setItem('ledgerflow-deployment-instance', 'deployment-current');
    localStorage.setItem('ledgerflow-finance', '{"state":{"transactions":[]}}');

    expect(ensureDeploymentScope('deployment-current')).toBe(false);
    expect(localStorage.getItem('ledgerflow-finance')).not.toBeNull();
  });

  it('uses a legacy database identity when upgrading from an older app version', () => {
    localStorage.setItem('ledgerflow-finance', '{"state":{"transactions":[{"id":"old"}]}}');

    expect(ensureDeploymentScope('deployment-new', 'sqlite:2026-01-01T00:00:00.000Z')).toBe(true);
    expect(localStorage.getItem('ledgerflow-finance')).toBeNull();
    expect(localStorage.getItem('ledgerflow-deployment-instance')).toBe('deployment-new');
  });

  it('can clear local account data without losing the active deployment marker', () => {
    localStorage.setItem('ledgerflow-deployment-instance', 'deployment-current');
    localStorage.setItem('ledgerflow-finance', '{"state":{"transactions":[]}}');
    sessionStorage.setItem('ledgerflow-ai-settings-api-key', 'session-key');

    clearScopedBrowserData();

    expect(localStorage.getItem('ledgerflow-deployment-instance')).toBe('deployment-current');
    expect(localStorage.getItem('ledgerflow-finance')).toBeNull();
    expect(sessionStorage.getItem('ledgerflow-ai-settings-api-key')).toBeNull();
  });
});
