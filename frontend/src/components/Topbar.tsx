import { useEffect, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useLive, type FeedMode } from '../ws';
import { useAuth } from '../auth';
import { fmtTime } from '../format';
import StockSearch from './StockSearch';

const NAV = [
  { to: '/', label: 'Dashboard' },
  { to: '/us', label: 'USA' },
  { to: '/trading', label: 'Trading' },
  { to: '/algorithms', label: 'Algorithms' },
  { to: '/paper', label: 'Paper Lab' },
  { to: '/watchlist', label: 'Watchlist' },
];

const MODE_LABEL: Record<FeedMode, string> = {
  live: 'LIVE FEED',
  relay: 'LIVE QUOTES',
  polling: 'REST POLLING',
  snapshot: 'LAST CI SNAPSHOT',
  offline: 'OFFLINE',
};

const MODE_COLOR: Record<FeedMode, { fg: string; bg: string; dot: string }> = {
  live: { fg: 'var(--up)', bg: 'rgba(0,184,119,0.08)', dot: 'var(--up)' },
  relay: { fg: 'var(--up)', bg: 'rgba(0,184,119,0.08)', dot: 'var(--up)' },
  polling: { fg: 'var(--amber)', bg: 'rgba(255,179,71,0.08)', dot: 'var(--amber)' },
  snapshot: { fg: '#4cc9f0', bg: 'rgba(76,201,240,0.08)', dot: '#4cc9f0' },
  offline: { fg: 'var(--down)', bg: 'rgba(255,92,92,0.08)', dot: 'var(--down)' },
};

export default function Topbar() {
  const mode = useLive((s) => s.mode);
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const navigate = useNavigate();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const color = MODE_COLOR[mode];

  return (
    <header className="topbar">
      <Link to="/" className="brand">
        <div className="brand-mark">TA</div>
        <div>
          <div className="brand-name">
            TRADE <em>ALGO</em>
          </div>
          <div className="brand-sub">Algorithmic Trading Terminal</div>
        </div>
      </Link>
      <nav className="nav">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
            {n.label}
          </NavLink>
        ))}
      </nav>
      <StockSearch />
      <div className="topbar-right">
        {user ? (
          <span className="account-menu">
            <span className="account-name" title={user.email}>{user.displayName}</span>
            <button
              className="account-logout"
              onClick={() => {
                logout();
                navigate('/');
              }}
            >
              Logout
            </button>
          </span>
        ) : (
          <span className="account-menu">
            <Link to="/login" className="account-link">Log in</Link>
            <Link to="/signup" className="account-link signup">Sign up</Link>
          </span>
        )}
        <span className="mono muted" style={{ fontSize: 12 }}>
          {fmtTime(now)}
        </span>
        <span
          className="live-pill"
          title={
            mode === 'live'
              ? 'WebSocket stream connected to the backend'
              : mode === 'relay'
                ? 'Live NSE quotes streaming via serverless relay — strategy data from CI snapshot'
                : mode === 'polling'
                  ? 'Backend reachable over REST — polling every 4s'
                  : mode === 'snapshot'
                    ? 'No live backend — showing last automation snapshot'
                    : 'No backend and no snapshot available'
          }
          style={{ color: color.fg, borderColor: color.fg + '4d', background: color.bg }}
        >
          <span className="dot" style={{ background: color.dot }} />
          {MODE_LABEL[mode]}
        </span>
      </div>
    </header>
  );
}
