import { useEffect, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useLive } from '../ws';
import { fmtTime } from '../format';

const NAV = [
  { to: '/', label: 'Dashboard' },
  { to: '/trading', label: 'Trading' },
  { to: '/algorithms', label: 'Algorithms' },
  { to: '/watchlist', label: 'Watchlist' },
];

export default function Topbar() {
  const connected = useLive((s) => s.connected);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <header className="topbar">
      <Link to="/" className="brand">
        <div className="brand-mark">KA</div>
        <div>
          <div className="brand-name">
            KITE <em>AURORA</em>
          </div>
          <div className="brand-sub">Algo Trading Terminal</div>
        </div>
      </Link>
      <nav className="nav">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
            {n.label}
          </NavLink>
        ))}
      </nav>
      <div className="topbar-right">
        <span className="mono muted" style={{ fontSize: 12 }}>
          {fmtTime(now)}
        </span>
        <span className={connected ? 'live-pill' : 'live-pill'} style={connected ? undefined : { color: 'var(--down)', borderColor: 'rgba(255,92,92,0.3)', background: 'rgba(255,92,92,0.08)' }}>
          <span className="dot" style={connected ? undefined : { background: 'var(--down)' }} />
          {connected ? 'LIVE FEED' : 'RECONNECTING'}
        </span>
      </div>
    </header>
  );
}
