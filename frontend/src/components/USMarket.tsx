import { useCallback, useEffect, useMemo, useState } from 'react';
import type { USQuote } from '../../api/us';

// Direct TradingView scan (same call tvscreener's StockScreener makes) used as a
// browser fallback when the /api/us relay is unreachable. Mirrors
// frontend/api/us.ts columns/payload.
const SCAN_URL = 'https://scanner.tradingview.com/global/scan';
const COLUMNS = [
  'name',
  'description',
  'close',
  'change',
  'change_abs',
  'volume',
  'market_cap_basic',
  'price_earnings_ttm',
  'sector',
  'exchange',
  'Recommend.All',
];

async function fetchDirect(limit: number): Promise<USQuote[]> {
  const res = await fetch(SCAN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://www.tradingview.com',
      Referer: 'https://www.tradingview.com/',
    },
    body: JSON.stringify({
      filter: [],
      options: { lang: 'en' },
      symbols: { query: { types: [] }, tickers: [] },
      sort: { sortBy: 'market_cap_basic', sortOrder: 'desc' },
      range: [0, limit],
      columns: COLUMNS,
      markets: ['america'],
    }),
  });
  if (!res.ok) throw new Error(`direct scan failed: ${res.status}`);
  const body = (await res.json()) as { data?: { s: string; d: (number | string | null)[] }[] };
  return (body.data ?? []).map((row) => {
    const d = row.d ?? [];
    const num = (v: unknown): number | null => (typeof v === 'number' && isFinite(v) ? v : null);
    const str = (v: unknown): string => (typeof v === 'string' ? v : '');
    const ticker = (str(row.s).split(':').pop() ?? str(row.s)).toUpperCase();
    return {
      symbol: ticker,
      name: str(d[1]) || str(d[0]) || ticker,
      price: num(d[2]),
      change: num(d[4]),
      changePct: num(d[3]),
      volume: num(d[5]) != null ? Math.round(num(d[5]) as number) : null,
      marketCap: num(d[6]),
      pe: num(d[7]),
      sector: str(d[8]),
      exchange: str(d[9]),
      rating: num(d[10]),
    };
  });
}

type SortKey = 'symbol' | 'price' | 'changePct' | 'volume' | 'marketCap' | 'pe' | 'rating';

const money = (n: number | null | undefined): string =>
  n == null || !isFinite(n) ? '—' : `$${n.toLocaleString('en-US', { maximumFractionDigits: n < 10 ? 2 : 0 })}`;

const compact = (n: number | null | undefined): string => {
  if (n == null || !isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return `${n}`;
};

const ratingLabel = (r: number | null): string => {
  if (r == null || !isFinite(r)) return '—';
  if (r >= 0.5) return 'Strong Buy';
  if (r >= 0.1) return 'Buy';
  if (r <= -0.5) return 'Strong Sell';
  if (r <= -0.1) return 'Sell';
  return 'Neutral';
};

export default function USMarket() {
  const [rows, setRows] = useState<USQuote[]>([]);
  const [ts, setTs] = useState<number | null>(null);
  const [source, setSource] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('marketCap');
  const [sortAsc, setSortAsc] = useState(false);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/us?limit=60', { cache: 'no-store' });
      const ct = res.headers.get('content-type') ?? '';
      if (res.ok && !ct.includes('text/html')) {
        const data = (await res.json()) as { rows?: USQuote[]; ts?: number; source?: string };
        if (data.rows?.length) {
          setRows(data.rows);
          setTs(data.ts ?? Date.now());
          setSource(data.source === 'cache' ? 'cache · TradingView' : 'live · TradingView');
          setErr(null);
          setLoading(false);
          return;
        }
      }
      throw new Error('relay empty');
    } catch {
      // Fallback: call the TradingView scanner directly from the browser
      // (same request tvscreener's StockScreener issues).
      try {
        const direct = await fetchDirect(60);
        if (direct.length) {
          setRows(direct);
          setTs(Date.now());
          setSource('live · TradingView (direct)');
          setErr(null);
        } else {
          setErr('US screener returned no rows — retry in a moment.');
        }
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'US market data unavailable right now.');
      } finally {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase();
    const base = q
      ? rows.filter((r) => r.symbol.includes(q) || r.name.toUpperCase().includes(q))
      : rows;
    const val = (r: USQuote): number | string => {
      switch (sortKey) {
        case 'symbol': return r.symbol;
        case 'price': return r.price ?? Number.NEGATIVE_INFINITY;
        case 'changePct': return r.changePct ?? Number.NEGATIVE_INFINITY;
        case 'volume': return r.volume ?? Number.NEGATIVE_INFINITY;
        case 'marketCap': return r.marketCap ?? Number.NEGATIVE_INFINITY;
        case 'pe': return r.pe ?? Number.NEGATIVE_INFINITY;
        case 'rating': return r.rating ?? Number.NEGATIVE_INFINITY;
      }
    };
    return [...base].sort((a, b) => {
      const av = val(a);
      const bv = val(b);
      if (typeof av === 'string') return sortAsc ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
      return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
  }, [rows, query, sortKey, sortAsc]);

  const toggle = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };
  const arrow = (key: SortKey) => (sortKey === key ? (sortAsc ? ' ▲' : ' ▼') : '');

  return (
    <div>
      <div className="panel reveal" style={{ marginBottom: 12, padding: '12px 16px' }}>
        <div className="panel-title" style={{ marginBottom: 8 }}>
          <h3>US Market — live via TradingView screener</h3>
          <span className="hint">
            {loading ? 'fetching…' : `${filtered.length} stocks · ${source}${ts ? ` · ${new Date(ts).toLocaleTimeString('en-IN')}` : ''}`}
          </span>
        </div>
        <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.55 }}>
          Same data source as the{' '}
          <a href="https://github.com/deepentropy/tvscreener" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--cyan)', textDecoration: 'none' }}>
            tvscreener
          </a>{' '}
          Python library (TradingView scanner <span className="mono">global/scan</span>, market <span className="mono">america</span>, sorted by market cap).
          Auto-refreshes every 60s. Search filters by ticker or company name.
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search e.g. AAPL, Tesla…"
            style={{
              flex: '1 1 220px',
              maxWidth: 320,
              padding: '7px 10px',
              borderRadius: 6,
              border: '1px solid rgba(148,163,184,0.2)',
              background: 'rgba(148,163,184,0.06)',
              color: 'var(--text)',
              fontSize: 13,
            }}
          />
          <button className="btn" onClick={() => { setLoading(true); void load(); }}>
            Refresh now
          </button>
        </div>
      </div>

      {err && <div className="empty">{err}</div>}
      {loading && !rows.length && !err && <div className="empty">Loading US market data…</div>}

      {filtered.length > 0 && (
        <div className="panel reveal">
          <div className="table" style={{ minWidth: 760 }}>
            <div className="tr head">
              <span onClick={() => toggle('symbol')} style={{ cursor: 'pointer' }}>Symbol{arrow('symbol')}</span>
              <span>Company</span>
              <span onClick={() => toggle('price')} style={{ cursor: 'pointer' }}>Price{arrow('price')}</span>
              <span onClick={() => toggle('changePct')} style={{ cursor: 'pointer' }}>Chg %{arrow('changePct')}</span>
              <span onClick={() => toggle('volume')} style={{ cursor: 'pointer' }}>Volume{arrow('volume')}</span>
              <span onClick={() => toggle('marketCap')} style={{ cursor: 'pointer' }}>Mkt Cap{arrow('marketCap')}</span>
              <span onClick={() => toggle('pe')} style={{ cursor: 'pointer' }}>P/E{arrow('pe')}</span>
              <span onClick={() => toggle('rating')} style={{ cursor: 'pointer' }}>Rating{arrow('rating')}</span>
            </div>
            {filtered.map((r) => (
              <div key={r.symbol} className="tr">
                <span className="mono" style={{ fontWeight: 700 }}>{r.symbol}</span>
                <span className="muted" style={{ fontSize: 12 }} title={`${r.sector} · ${r.exchange}`}>
                  {r.name}
                </span>
                <span className="mono">{money(r.price)}</span>
                <span className={r.changePct == null ? '' : r.changePct > 0.005 ? 'up' : r.changePct < -0.005 ? 'down' : ''}>
                  {r.changePct == null ? '—' : `${r.changePct >= 0 ? '+' : ''}${r.changePct.toFixed(2)}%`}
                </span>
                <span className="mono muted">{r.volume != null ? r.volume.toLocaleString('en-US') : '—'}</span>
                <span className="mono">{compact(r.marketCap)}</span>
                <span className="mono">{r.pe != null ? r.pe.toFixed(1) : '—'}</span>
                <span className="muted" style={{ fontSize: 12 }}>{ratingLabel(r.rating)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
