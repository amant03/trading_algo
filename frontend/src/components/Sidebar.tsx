import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useLive } from '../ws';
import { useAuth } from '../auth';
import { fmtPct, cls } from '../format';
import type { Snapshot } from '../types';
import { DASH_SECTIONS } from '../lib/dashSections';

export default function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuth((s) => s.user);
  const snapshots = useLive((s) => s.snapshots);
  const watchlist = useLive((s) => s.watchlist);
  const [active, setActive] = useState<string>(DASH_SECTIONS[0].id);

  const symbol = location.pathname.startsWith('/stock/') ? location.pathname.split('/')[2] : null;
  const onDash = location.pathname === '/';

  const snap = (sym: string): Snapshot | undefined => snapshots[sym];

  useEffect(() => {
    if (!onDash) return;
    const nodes = DASH_SECTIONS
      .map((s) => document.getElementById(s.id))
      .filter((n): n is HTMLElement => n != null);
    if (!nodes.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        const vis = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (vis?.target.id) setActive(vis.target.id);
      },
      { rootMargin: '-15% 0px -60% 0px', threshold: [0.15, 0.4] },
    );
    nodes.forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, [onDash]);

  const go = (id: string) => {
    setActive(id);
    if (!onDash) {
      navigate('/');
      window.setTimeout(() => {
        document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 60);
      return;
    }
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <aside className="sidebar">
      <div className="side-label">Sections</div>
      <nav className="side-nav" aria-label="Dashboard sections">
        {DASH_SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            className={cls('side-nav-btn', onDash && active === s.id && 'on')}
            onClick={() => go(s.id)}
          >
            {s.label}
          </button>
        ))}
      </nav>

      {user && (
        <>
          <div className="side-label">Watchlist</div>
          {watchlist.length === 0 && (
            <div className="dim" style={{ fontSize: 12, padding: '0 8px' }}>
              Nothing yet — use the search bar on top or add from a stock page.
            </div>
          )}
          {watchlist.map((sym) => {
            const s = snap(sym);
            return (
              <div key={sym} className={cls('watch-row', symbol === sym && 'active')} onClick={() => navigate(`/stock/${sym}`)}>
                <span className="sym">{sym}</span>
                {s && (
                  <div className="meta">
                    <span className="px">{s.price.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    <span className={s.changePct >= 0 ? 'up' : 'down'} style={{ fontSize: 11 }}>{fmtPct(s.changePct)}</span>
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}
    </aside>
  );
}
