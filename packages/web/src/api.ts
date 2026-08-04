// Replaces app/index.html's callOnce/call/api JSONP bridge (~lines 414-575) with a plain
// fetch()-based client hitting the new REST API — see plan §"Frontend (Cloudflare Pages)". A
// normal Cloudflare Pages page calling a normal REST API needs none of the JSONP/postMessage
// workarounds the old Apps Script transport required.
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787';

export interface ApiOk<T> {
  ok: true;
  data: T;
  message: string;
  meta: { generatedAt: string; cached: boolean; [key: string]: unknown };
}
export interface ApiFail {
  ok: false;
  message: string;
  code: string;
}
export type ApiResponse<T> = ApiOk<T> | ApiFail;

export class ApiRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

async function request<T>(path: string, options: RequestInit = {}, token?: string | null): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(options.headers as Record<string, string> | undefined) };
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  } catch (err) {
    // Real network failure (offline, DNS, CORS misconfiguration) — distinct from an application-
    // level ok:false response, which the server always returns with a real HTTP status instead.
    throw new ApiRequestError(err instanceof Error ? err.message : 'Network request failed.');
  }
  return (await res.json()) as ApiResponse<T>;
}

export interface LoginUser {
  userId: string;
  username: string;
  fullName: string | null;
  email: string | null;
  roleId: string;
  roleName: string;
  mustChangePassword: boolean;
  permissions: Record<string, boolean>;
}

export function login(username: string, password: string) {
  return request<{ token: string; user: LoginUser }>('/api/auth/login', {
    method: 'POST', body: JSON.stringify({ username, password }),
  });
}

export function logout(token: string) {
  return request<boolean>('/api/auth/logout', { method: 'POST' }, token);
}

export function changePassword(token: string, currentPassword: string | undefined, newPassword: string) {
  return request<boolean>('/api/auth/change-password', {
    method: 'POST', body: JSON.stringify({ currentPassword, newPassword }),
  }, token);
}

export function me(token: string) {
  return request<LoginUser>('/api/auth/me', {}, token);
}
