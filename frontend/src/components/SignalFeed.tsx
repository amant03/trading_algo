import { useNavigate } from 'react-router-dom';
import { DirectionBadge } from './Badge';
import { fmt, fmtTime, cls } from '../format';
import type { Signal } from '../types';

export function SignalRow({ s }: { s: Signal }) {
  const navigate = useNavigate();
  return (
    <div className="feed-item" onClick={() => navigate(`/stock/${s.symbol}`)}>
      <div className="feed-main">
        <div className="feed-head">
          <span className="sym">{s.symbol}</span>
          <DirectionBadge dir={s.direction} />
        </div>
        <div className="feed-reason">{s.reason}</div>
        <div className="feed-meta">
          <span className="strat">{s.strategy}</span>
          <span className="px">@{fmt(s.price)}</span>
          <span className="t">{fmtTime(s.ts)}</span>
        </div>
      </div>
      <div className="strength">
        strength
        <div className="sbar">
          <i style={{ width: `${Math.min(100, Math.max(8, s.strength))}%` }} />
        </div>
        <span className={cls('mono', s.strength > 80 ? 'up' : s.strength < 40 ? 'down' : 'muted')} style={{ fontSize: 10 }}>
          {s.strength}/100
        </span>
      </div>
    </div>
  );
}

export default function SignalFeed({ signals, limit = 30 }: { signals: Signal[]; limit?: number }) {
  if (!signals.length) return <div className="empty">Waiting for the algorithm engine to fire signalsâ€¦</div>;
  return (
    <div className="feed">
      {signals.slice(0, limit).map((s) => (
        <SignalRow key={s.id} s={s} />
      ))}
    </div>
  );
}
