import { ENV } from '../config/env';

export interface AuthUser {
  id: string;
  ledgerUserId: string;
  email: string;
  displayName: string;
  status: string;
  createdAt: string | null;
  lastLoginAt: string | null;
}

export interface AuthStatusResponse {
  ok: boolean;
  authenticated: boolean;
  registrationOpen: boolean;
  user: AuthUser | null;
}

function getUrl(path: string) {
  const base = ENV.apiBaseUrl.endsWith('/') ? ENV.apiBaseUrl.slice(0, -1) : ENV.apiBaseUrl;
  return `${base}${path}`;
}

async function readResponse<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as T & { message?: string };
  if (!response.ok) throw new Error(body.message || `HTTP ${response.status}`);
  return body;
}

async function request<T>(path: string, init?: RequestInit) {
  return readResponse<T>(
    await fetch(getUrl(path), {
      credentials: 'same-origin',
      ...init,
      headers: {
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers
      }
    })
  );
}

export function getAuthStatus() {
  return request<AuthStatusResponse>('/auth/status');
}

export function registerAccount(input: {
  email: string;
  password: string;
  displayName: string;
}) {
  return request<{ ok: boolean; user: AuthUser; claimedLegacyData: boolean }>('/auth/register', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export function loginAccount(input: { email: string; password: string }) {
  return request<{ ok: boolean; user: AuthUser }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export function logoutAccount() {
  return request<{ ok: boolean }>('/auth/logout', { method: 'POST' });
}

export function updateAccountProfile(input: { displayName: string }) {
  return request<{ ok: boolean; user: AuthUser }>('/auth/profile', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export function changeAccountPassword(input: { currentPassword: string; newPassword: string }) {
  return request<{ ok: boolean }>('/auth/change-password', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export function revokeOtherAccountSessions() {
  return request<{ ok: boolean }>('/auth/revoke-sessions', { method: 'POST' });
}
