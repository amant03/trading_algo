import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLive } from '../ws';
import { fmtPct, cls } from '../format';
import type { Snapshot } from '../types';

export default function Ticker() {
  const snapshots = useLive((s) => s.snapshots);
  const [items, setItems] = useState<Snapshot[]>([]);

  useEffect(() => {
    const list = Object.values(snapshots);
    if (list.length) setItems(list);
  }, [snapshots]);

  const doubled = [...items, ...items];

  return (
    <div className="ticker">
      <div className="ticker-track">
        {doubled.map((s, i) => (
          <Link key={`${s.symbol}-${i}`} to={`/stock/${s.symbol}`} className="ticker-item" style={{ textDecoration: 'none' }}>
            <span className="sym">{s.symbol}</span>
            <span className="px">{s.price.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            <span className={cls('chg', s.changePct >= 0 ? 'up' : 'down')}>{fmtPct(s.changePct)}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
