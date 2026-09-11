import { create } from 'zustand';
import { ApiError, AUTH_TOKEN_KEY, get as apiGet, post as apiPost, patch as apiPatch } from './api';
import type { AuthResponse, AuthUser } from './types';

const USER_KEY = 'tradealgo.auth.user.v1';

export function loadToken(): string | null {
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY);
  } catch {
    return null;
  }
}

function loadCachedUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    const u = JSON.parse(raw) as AuthUser;
    return typeof u?.id === 'number' && typeof u?.email === 'string' ? u : null;
  } catch {
    return null;
  }
}

function persist(token: string | null, user: AuthUser | null): void {
  try {
    if (token) localStorage.setItem(AUTH_TOKEN_KEY, token);
    else localStorage.removeItem(AUTH_TOKEN_KEY);
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(USER_KEY);
  } catch {
    // storage unavailable — session lasts until reload
  }
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  ready: boolean;
  busy: boolean;
  error: string | null;
  signup: (email: string, password: string, displayName?: string) => Promise<boolean>;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => void;
  refresh: () => Promise<void>;
  setOnboarded: () => Promise<void>;
  setError: (e: string | null) => void;
}

export const useAuth = create<AuthState>((set, get) => ({
  token: loadToken(),
  user: loadCachedUser(),
  ready: false,
  busy: false,
  error: null,

  signup: async (email, password, displayName) => {
    set({ busy: true, error: null });
    try {
      const r = await apiPost<AuthResponse>('/auth/signup', { email, password, displayName });
      persist(r.token, r.user);
      set({ token: r.token, user: r.user, ready: true, busy: false });
      return true;
    } catch (e) {
      set({ busy: false, error: (e as Error).message });
      return false;
    }
  },

  login: async (email, password) => {
    set({ busy: true, error: null });
    try {
      const r = await apiPost<AuthResponse>('/auth/login', { email, password });
      persist(r.token, r.user);
      set({ token: r.token, user: r.user, ready: true, busy: false });
      return true;
    } catch (e) {
      set({ busy: false, error: (e as Error).message });
      return false;
    }
  },

  logout: () => {
    const { token } = get();
    if (token) apiPost('/auth/logout', {}).catch(() => {});
    persist(null, null);
    set({ token: null, user: null, ready: true, error: null });
  },

  refresh: async () => {
    const { token } = get();
    if (!token) {
      set({ ready: true });
      return;
    }
    try {
      const r = await apiGet<{ user: AuthUser; accountId: number }>('/auth/me');
      persist(token, r.user);
      set({ user: r.user, ready: true });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        // Token rejected by the backend — drop the dead session.
        persist(null, null);
        set({ token: null, user: null, ready: true });
      } else {
        // Network error / no backend (offline & snapshot modes) — keep the
        // cached session; anonymous browsing and local paper trading continue.
        set({ ready: true });
      }
    }
  },

  setOnboarded: async () => {
    const { token, user } = get();
    if (!token || !user || user.hasOnboarded) return;
    try {
      const r = await apiPatch<{ user: AuthUser }>('/auth/me', { hasOnboarded: true });
      persist(token, r.user);
      set({ user: r.user });
    } catch {
      // offline — walkthrough state just won't persist server-side
    }
  },

  setError: (e) => set({ error: e }),
}));
