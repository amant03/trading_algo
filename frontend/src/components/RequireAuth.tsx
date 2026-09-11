import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth';
import { useLive } from '../ws';

/**
 * Route guard for account-bound pages (/trade, /algorithms, /watchlist).
 * Logged-in users always pass. Logged-out users pass only when there is no
 * backend to log into (snapshot / offline / relay modes) — this keeps every
 * existing anonymous and static-deploy flow working exactly as before.
 */
export default function RequireAuth({ children }: { children: ReactNode }) {
  const token = useAuth((s) => s.token);
  const mode = useLive((s) => s.mode);
  const location = useLocation();
  if (token) return <>{children}</>;
  const backendLive = mode === 'live' || mode === 'polling';
  if (!backendLive) return <>{children}</>;
  return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
}
