export const AUTH_TOKEN_KEY = 'tradealgo.auth.token.v1';

export function getAuthToken(): string | null {
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY);
  } catch {
    return null;
  }
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const BASE: string = import.meta.env.VITE_API_URL ?? '';

/**
 * fetch() with a guaranteed timeout. Plain fetch() never settles if the
 * network stalls (Brave Shields holding cross-origin connections, dead
 * proxies, hung serverless cold starts) — and this app fires fetches on
 * 4s/8s/30s/60s timers. Without timeouts those pile up without bound and
 * their resolving store updates arrive as render storms: the tab freezes.
 * Every network call in the app must go through here (or api() below).
 */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  ms = 20000,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  const callerSignal = init.signal as AbortSignal | null | undefined;
  const onCallerAbort = (): void => ctrl.abort();
  if (callerSignal) {
    if (callerSignal.aborted) ctrl.abort();
    else callerSignal.addEventListener('abort', onCallerAbort, { once: true });
  }
  try {
    return await fetch(input, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', onCallerAbort);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getAuthToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetchWithTimeout(`${BASE}${path}`, {
    headers: { ...headers, ...((init?.headers as Record<string, string> | undefined) ?? {}) },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, (body as { error?: string })?.error ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export const get = <T>(path: string) => api<T>(path);
export const post = <T>(path: string, body: unknown) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(body) });
export const patch = <T>(path: string, body: unknown) =>
  api<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
export const del = <T>(path: string) => api<T>(path, { method: 'DELETE' });
