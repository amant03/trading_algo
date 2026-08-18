import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { get } from '../api';
import { useLive } from '../ws';
import { fmtPct, cls } from '../format';
import type { Instrument, Snapshot } from '../types';

export default function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const snapshots = useLive((s) => s.snapshots);
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [watchlist, setWatchlist] = useState<string[]>([]);

  const symbol = location.pathname.startsWith('/stock/') ? location.pathname.split('/')[2] : null;

  useEffect(() => {
    get<Instrument[]>('/api/instruments').then(setInstruments).catch(() => {});
    get<string[]>('/api/watchlist').then(setWatchlist).catch(() => {});
  }, []);

  const snap = (sym: string): Snapshot | undefined => snapshots[sym];

  const gainers = instruments
    .map((i) => ({ i, s: snap(i.symbol) }))
    .filter((x) => x.s)
    .sort((a, b) => (b.s!.changePct) - (a.s!.changePct))
    .slice(0, 6);

  return (
    <aside className="sidebar">
      <div className="side-label">Watchlist</div>
      {watchlist.length === 0 && <div className="dim" style={{ fontSize: 12, padding: '0 8px' }}>No symbols yet — add from a stock page.</div>}
      {watchlist.map((sym) => {
        const s = snap(sym);
        return (
          <div key={sym} className={cls('watch-row', symbol === sym && 'active')} onClick={() => navigate(`/stock/${sym}`)}>
            <span className="sym">{sym}</span>
            {s && (
              <div className="meta">
                <span className="px">{s.price.toLocaleString('en-IN')}</span>
                <span className={s.changePct >= 0 ? 'up' : 'down'} style={{ fontSize: 11 }}>{fmtPct(s.changePct)}</span>
              </div>
            )}
          </div>
        );
      })}

      <div className="side-label">Top Movers</div>
      {gainers.map(({ i, s }) => (
        <div key={i.symbol} className="watch-row" onClick={() => navigate(`/stock/${i.symbol}`)}>
          <span className="sym">{i.symbol}</span>
          {s && (
            <div className="meta">
              <span className="px">{s.price.toLocaleString('en-IN')}</span>
              <span className={s.changePct >= 0 ? 'up' : 'down'} style={{ fontSize: 11 }}>{fmtPct(s.changePct)}</span>
            </div>
          )}
        </div>
      ))}
    </aside>
  );
}
