import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth';

export default function Login() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { login, busy, error, setError } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const next = params.get('next') || '/';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const ok = await login(email.trim(), password);
    if (ok) navigate(next.startsWith('/') ? next : '/', { replace: true });
  };

  return (
    <div style={{ maxWidth: 420, margin: '48px auto' }}>
      <h1 style={{ marginBottom: 4 }}>Log in</h1>
      <p className="muted" style={{ marginBottom: 20, fontSize: 13 }}>
        Your paper portfolio, watchlist and preferences live in your account.
      </p>
      <div className="panel reveal">
        <form onSubmit={submit}>
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
            <label>Password</label>
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>
          {error && (
            <div className="down" style={{ fontSize: 13, marginBottom: 12 }}>
              {error}
            </div>
          )}
          <button className="btn primary" style={{ width: '100%' }} disabled={busy}>
            {busy ? 'Logging in…' : 'Log in'}
          </button>
        </form>
      </div>
      <p className="muted" style={{ marginTop: 14, fontSize: 13 }}>
        New here? <Link to={`/signup${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`}>Create an account</Link> — it takes seconds and starts you with ₹1,00,000 in virtual cash.
      </p>
    </div>
  );
}
