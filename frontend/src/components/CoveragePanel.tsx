import { useEffect, useState } from 'react';

interface CoverageFile {
  generatedAt: string;
  universe: number;
  totals: { quote: number; intraday: number; history: number; fundamentals: number; news: number; signals: number; tvmap: number };
  gaps: Record<string, string[]>;
}

const COVERAGE_URLS = [
  'https://cdn.jsdelivr.net/gh/amant03/trading_algo@automation-data/frontend/public/coverage.json',
  'https://raw.githubusercontent.com/amant03/trading_algo/automation-data/frontend/public/coverage.json',
  '/coverage.json',
];

const POINTS: { key: keyof CoverageFile['totals']; label: string }[] = [
  { key: 'quote', label: 'Quote' },
  { key: 'intraday', label: 'Intraday 1D' },
  { key: 'history', label: 'History 1Y' },
  { key: 'fundamentals', label: 'Fundamentals' },
  { key: 'news', label: 'News' },
  { key: 'signals', label: 'Signals' },
  { key: 'tvmap', label: 'TV map' },
];

export default function CoveragePanel() {
  const [cov, setCov] = useState<CoverageFile | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      for (const url of COVERAGE_URLS) {
        try {
          const res = await fetch(url, { cache: 'no-store' });
          if (!res.ok) continue;
          const ct = res.headers.get('content-type') ?? '';
          if (ct.includes('text/html')) continue;
          const data = (await res.json()) as CoverageFile;
          if (data && typeof data.universe === 'number' && data.totals) {
            if (live) setCov(data);
            return;
          }
        } catch {
          // try next mirror
        }
      }
    })();
    return () => { live = false; };
  }, []);

  if (!cov) return null;
  const uni = cov.universe || 1;

  return (
    <div className="panel reveal" style={{ marginBottom: 16 }}>
      <div className="panel-title">
        <h3>Data coverage — {uni.toLocaleString('en-IN')} stocks audited</h3>
        <span className="hint">
          {new Date(cov.generatedAt).toLocaleString('en-IN')} · gaps auto-filled weekly (screener.in + TradingView)
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '8px 18px' }}>
        {POINTS.map((p) => {
          const have = cov.totals[p.key] ?? 0;
          const pct = Math.round((have / uni) * 100);
          const missing = (cov.gaps?.[p.key] ?? []).length;
          return (
            <div key={p.key}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                <span className="muted">{p.label}</span>
                <span className={pct >= 90 ? 'up' : pct >= 50 ? '' : 'down'} style={{ fontWeight: 700 }}>{pct}%</span>
              </div>
              <div style={{ height: 5, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden' }}>
                <span style={{ display: 'block', height: '100%', width: `${pct}%`, background: pct >= 90 ? 'var(--up)' : pct >= 50 ? 'var(--amber, #ffb020)' : 'var(--down)' }} />
              </div>
              <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                {have.toLocaleString('en-IN')} have · {missing.toLocaleString('en-IN')} missing
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
