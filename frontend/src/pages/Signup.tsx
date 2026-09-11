import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth';

export default function Signup() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { signup, busy, error, setError } = useAuth();
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');

  const next = params.get('next') || '/';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const ok = await signup(email.trim(), password, displayName.trim() || undefined);
    if (ok) navigate(next.startsWith('/') ? next : '/', { replace: true });
  };

  return (
    <div style={{ maxWidth: 420, margin: '48px auto' }}>
      <h1 style={{ marginBottom: 4 }}>Create your account</h1>
      <p className="muted" style={{ marginBottom: 20, fontSize: 13 }}>
        Free forever. You get a ₹1,00,000 virtual paper-trading portfolio — no real money involved, ever.
      </p>
      <div className="panel reveal">
        <form onSubmit={submit}>
          <div style={{ marginBottom: 12 }}>
            <label>Display name <span className="dim">(optional)</span></label>
            <input
              className="input"
              type="text"
              autoComplete="nickname"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Chart Shark"
              maxLength={80}
            />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label>Email</label>
            <input
              className="input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label>Password <span className="dim">(8+ characters)</span></label>
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              minLength={8}
              required
            />
          </div>
          {error && (
            <div className="down" style={{ fontSize: 13, marginBottom: 12 }}>
              {error}
            </div>
          )}
          <button className="btn primary" style={{ width: '100%' }} disabled={busy}>
            {busy ? 'Creating…' : 'Create account'}
          </button>
        </form>
      </div>
      <p className="muted" style={{ marginTop: 14, fontSize: 13 }}>
        Already have one? <Link to={`/login${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`}>Log in</Link>
      </p>
    </div>
  );
}
