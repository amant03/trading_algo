import { useCallback, useEffect, useMemo, useState } from 'react';
import { get } from '../api';
import { useLive } from '../ws';

// TradingView-powered paper trading lab. Quotes + technical ratings come from
// the unofficial TradingView scanner endpoint via our /api/tv proxy (the same
// endpoint the open-source Mathieu2301/TradingView-API library's getTA()
// uses). TradingView offers no order execution, so every trade here is a
// simulated paper fill at the TV close price (+0.05% slippage), tracked in a
// local wallet (localStorage) until the self-hosted backend arrives.

interface TvTA { all: number | null; ma: number | null; other: number | null }
interface TvSymbol {
  tv: string;
  close: number | null;
  changePct: number | null;
  volume: number | null;
  rsi: number | null;
  macd: number | null;
  macdSignal: number | null;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  ema20: number | null;
  bbUpper: number | null;
  bbLower: number | null;
  ta: Record<string, TvTA>;
}
interface TvResp { asOf: string; symbols: TvSymbol[] }

interface TestPos { qty: number; avg: number; realized: number }
interface TestTrade {
  id: number; tv: string; side: 'BUY' | 'SELL'; qty: number;
  price: number; ts: number; realized: number | null;
}
interface TestWallet {
  cash: number;
  positions: Record<string, TestPos>;
  trades: TestTrade[];
  seq: number;
}

const WL_KEY = 'tradealgo.testwallet.v1';
const START_CASH = 100000;
const MAX_SYMBOLS = 15;
const SLIP = 0.0005;
const TFS = ['1', '5', '15', '60', '240', '1D', '1W', '1M'];
const QUICK = ['RELIANCE', 'HDFCBANK', 'INFY', 'TCS', 'SBIN', 'ITC', 'LT', 'TATAMOTORS'];

// Universe symbol -> TradingView ticker (scripts/ci/tv-map.ts). Covers
// 99.7% of the 5,138-stock universe; unmapped symbols fall back to NSE:SYM.
const TVMAP_URLS = [
  'https://cdn.jsdelivr.net/gh/amant03/trading_algo@automation-data/frontend/public/tv-map.json',
  'https://raw.githubusercontent.com/amant03/trading_algo/automation-data/frontend/public/tv-map.json',
  'https://raw.githubusercontent.com/amant03/trading_algo/main/frontend/public/tv-map.json',
  '/tv-map.json',
];
interface TvMapFile { universe: number; resolved: number; map: Record<string, string> }
// Live "Most attractive now" rows from /api/attractive (TradingView scanner,
// scored 0–100 server-side). Replaces the old static tv-rank.json feed.
interface AttractiveRow {
  symbol: string; name: string; price: number | null; changePct: number | null;
  weekPct: number | null; volume: number | null; relVol: number | null;
  marketCap: number | null; marketCapDisplay: string; capBucket: string | null;
  pe: number | null; sector: string; exchange: string; rsi: number | null;
  rating: number | null; score: number; reasons: string[];
}
interface AttractiveResp {
  ts: number; source: string; market: string; currency: string;
  total: number; count: number;
  sectors: { name: string; count: number }[];
  rows: AttractiveRow[];
}
type RankMarket = 'in' | 'us';
const CAP_OPTS: Record<RankMarket, { id: string; label: string }[]> = {
  in: [
    { id: '', label: 'All caps' },
    { id: 'large', label: 'Large (₹1L cr+)' },
    { id: 'mid', label: 'Mid (₹25k cr+)' },
    { id: 'small', label: 'Small' },
  ],
  us: [
    { id: '', label: 'All caps' },
    { id: 'mega', label: 'Mega ($200B+)' },
    { id: 'large', label: 'Large ($10B+)' },
    { id: 'mid', label: 'Mid ($2B+)' },
    { id: 'small', label: 'Small' },
  ],
};
let tvMapCache: TvMapFile | null = null;
async function loadTvMap(): Promise<TvMapFile | null> {
  if (tvMapCache) return tvMapCache;
  for (const url of TVMAP_URLS) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) continue;
      const j = (await res.json()) as TvMapFile;
      if (j?.map) {
        tvMapCache = j;
        return j;
      }
    } catch { /* try next */ }
  }
  return null;
}
function resolveTv(symbol: string, map: Record<string, string>): string {
  const clean = symbol.trim().toUpperCase();
  if (/^[A-Z]+:[A-Z0-9&.\-_]{1,20}$/.test(clean)) return clean; // already exchange-qualified
  if (/^(NSE|BSE):/.test(clean)) return clean;
  return map[clean] ?? `NSE:${clean}`;
}

function freshWallet(): TestWallet {
  return { cash: START_CASH, positions: {}, trades: [], seq: 0 };
}
function loadWallet(): TestWallet {
  try {
    const raw = localStorage.getItem(WL_KEY);
    if (!raw) return freshWallet();
    const w = JSON.parse(raw) as TestWallet;
    if (typeof w?.cash !== 'number' || !w.positions || !Array.isArray(w.trades)) return freshWallet();
    return w;
  } catch {
    return freshWallet();
  }
}

function scoreLabel(v: number | null): { text: string; cls: string } {
  if (v == null || !isFinite(v)) return { text: '—', cls: 'muted' };
  if (v >= 0.5) return { text: 'Strong Buy', cls: 'up' };
  if (v >= 0.1) return { text: 'Buy', cls: 'up' };
  if (v > -0.1) return { text: 'Neutral', cls: 'muted' };
  if (v > -0.5) return { text: 'Sell', cls: 'down' };
  return { text: 'Strong Sell', cls: 'down' };
}
function fmt(n: number | null, d = 2): string {
  if (n == null || !isFinite(n)) return '—';
  return n.toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d });
}
function fmtInt(n: number | null): string {
  if (n == null || !isFinite(n)) return '—';
  return Math.round(n).toLocaleString('en-IN');
}

function ScoreBar({ v }: { v: number | null }) {
  if (v == null || !isFinite(v)) return <span className="muted">—</span>;
  const pct = Math.max(0, Math.min(100, ((v + 1) / 2) * 100));
  return (
    <span className="scorebar" title={`score ${v.toFixed(3)} (−1 strong sell … +1 strong buy)`}>
      <span className="scorebar-mark" style={{ left: `${pct}%` }} />
    </span>
  );
}

export default function Test() {
  const universe = useLive((s) => s.universe);
  const [symbol, setSymbol] = useState('RELIANCE');
  const [tvMap, setTvMap] = useState<Record<string, string>>({});
  const [coverage, setCoverage] = useState<{ universe: number; resolved: number } | null>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [tv, setTv] = useState<TvSymbol | null>(null);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
  const [qty, setQty] = useState('1');
  const [msg, setMsg] = useState<string | null>(null);
  const [wallet, setWallet] = useState<TestWallet>(loadWallet);
  const [rankRows, setRankRows] = useState<AttractiveRow[]>([]);
  const [rankSectors, setRankSectors] = useState<{ name: string; count: number }[]>([]);
  const [rankAsOf, setRankAsOf] = useState<number | null>(null);
  const [rankMarket, setRankMarket] = useState<RankMarket>('in');
  const [rankSector, setRankSector] = useState('');
  const [rankCap, setRankCap] = useState('');
  const [rankFilter, setRankFilter] = useState('');
  const [rankShown, setRankShown] = useState(50);
  const [rankLoading, setRankLoading] = useState(false);
  const [rankError, setRankError] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(WL_KEY, JSON.stringify(wallet));
    } catch { /* storage unavailable */ }
  }, [wallet]);

  useEffect(() => {
    let live = true;
    loadTvMap().then((f) => {
      if (!live || !f) return;
      setTvMap(f.map);
      setCoverage({ universe: f.universe, resolved: f.resolved });
    });
    return () => { live = false; };
  }, []);

  const tvTicker = useMemo(() => resolveTv(symbol, tvMap), [symbol, tvMap]);
  const labCur = /^(NSE|BSE):/.test(tvTicker) ? '₹' : '$';
  const labIndian = labCur === '₹';

  const loadRank = useCallback(async (market: RankMarket, sector: string, cap: string) => {
    setRankLoading(true);
    setRankError(null);
    try {
      const qs = new URLSearchParams({ market, limit: '60' });
      if (sector) qs.set('sector', sector);
      if (cap) qs.set('cap', cap);
      const r = await get<AttractiveResp>(`/api/attractive?${qs.toString()}`);
      setRankRows(r.rows ?? []);
      setRankSectors(r.sectors ?? []);
      setRankAsOf(r.ts ?? Date.now());
    } catch (e) {
      setRankError(e instanceof Error ? e.message : 'Attractive scan failed.');
    } finally {
      setRankLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRank(rankMarket, rankSector, rankCap);
    const t = setInterval(() => loadRank(rankMarket, rankSector, rankCap), 60_000);
    return () => clearInterval(t);
  }, [loadRank, rankMarket, rankSector, rankCap]);

  const rankPool = useMemo(() => {
    const term = rankFilter.trim().toUpperCase();
    if (!term) return rankRows;
    return rankRows.filter((r) => r.symbol.includes(term) || r.name.toUpperCase().includes(term));
  }, [rankRows, rankFilter]);

  const suggestions = useMemo(() => {
    const term = symbol.trim().toUpperCase().replace(/\s+/g, '');
    if (!term || /^(NSE|BSE):/.test(term) || term.length < 2) return [];
    const out: Array<{ symbol: string; name: string }> = [];
    for (const u of universe) {
      const sym = u.symbol.toUpperCase();
      if (sym === term) return [{ symbol: u.symbol, name: u.name }];
      if (sym.startsWith(term) || u.name.toUpperCase().includes(term)) {
        out.push({ symbol: u.symbol, name: u.name });
        if (out.length >= 8) break;
      }
    }
    return out;
  }, [symbol, universe]);

  const load = useCallback(async (ticker: string) => {
    const clean = ticker.trim().toUpperCase();
    if (!clean) return;
    setLoading(true);
    setError(null);
    try {
      const r = await get<TvResp>(`/api/tv?symbols=${encodeURIComponent(clean)}`);
      const row = r.symbols?.[0] ?? null;
      if (!row || row.close == null) {
        setTv(null);
        setError(`No TradingView data for ${clean} — this listing may not be on TradingView. Try another symbol.`);
      } else {
        setTv(row);
        setAsOf(r.asOf);
      }
    } catch (e) {
      setTv(null);
      setError(e instanceof Error ? e.message : 'TradingView snapshot failed.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(tvTicker);
    const t = setInterval(() => load(tvTicker), 60_000);
    return () => clearInterval(t);
  }, [load, tvTicker]);

  const gauge = useMemo(() => scoreLabel(tv?.ta?.['1D']?.all ?? null), [tv]);

  const place = () => {
    setMsg(null);
    if (!tv || tv.close == null) {
      setMsg('No live price yet — wait for the TradingView snapshot.');
      return;
    }
    const q = Math.floor(Number(qty));
    if (!Number.isFinite(q) || q <= 0) {
      setMsg('Quantity must be a positive integer.');
      return;
    }
    const px = tv.close * (side === 'BUY' ? 1 + SLIP : 1 - SLIP);
    const id = wallet.seq + 1;
    if (side === 'BUY') {
      const cost = px * q;
      if (wallet.cash < cost) {
        setMsg(`Not enough Test cash — needs ~₹${fmtInt(cost)}, have ₹${fmtInt(wallet.cash)}.`);
        return;
      }
      const syms = Object.keys(wallet.positions);
      if (!wallet.positions[tv.tv] && syms.length >= MAX_SYMBOLS) {
        setMsg(`Max ${MAX_SYMBOLS} Test positions — sell something first.`);
        return;
      }
      const p = wallet.positions[tv.tv] ?? { qty: 0, avg: 0, realized: 0 };
      const avg = (p.avg * p.qty + px * q) / (p.qty + q);
      setWallet({
        cash: wallet.cash - cost,
        positions: { ...wallet.positions, [tv.tv]: { qty: p.qty + q, avg, realized: p.realized } },
        trades: [{ id, tv: tv.tv, side, qty: q, price: px, ts: Date.now(), realized: null }, ...wallet.trades].slice(0, 200),
        seq: id,
      });
      setMsg(`Bought ${q} ${tv.tv} @ ₹${fmt(px)} (simulated).`);
    } else {
      const p = wallet.positions[tv.tv];
      if (!p || p.qty < q) {
        setMsg(`You hold ${p?.qty ?? 0} ${tv.tv} in Test — short selling is not allowed.`);
        return;
      }
      const realized = (px - p.avg) * q;
      const next: TestWallet = {
        cash: wallet.cash + px * q,
        positions: { ...wallet.positions },
        trades: [{ id, tv: tv.tv, side, qty: q, price: px, ts: Date.now(), realized }, ...wallet.trades].slice(0, 200),
        seq: id,
      };
      const left = p.qty - q;
      if (left <= 0) delete next.positions[tv.tv];
      else next.positions[tv.tv] = { qty: left, avg: p.avg, realized: p.realized + realized };
      setWallet(next);
      setMsg(`Sold ${q} ${tv.tv} @ ₹${fmt(px)} (${realized >= 0 ? '+' : ''}₹${fmt(realized)} realised, simulated).`);
    }
  };

  const invested = useMemo(
    () => Object.entries(wallet.positions).reduce((s, [, p]) => s + p.qty * p.avg, 0),
    [wallet.positions],
  );
  const realised = useMemo(
    () => wallet.trades.reduce((s, t) => s + (t.realized ?? 0), 0) +
      Object.values(wallet.positions).reduce((s, p) => s + p.realized, 0),
    [wallet.trades, wallet.positions],
  );

  return (
    <div>
      <h1 style={{ marginBottom: 4 }}>Test <span className="muted" style={{ fontSize: 13 }}>· TradingView paper lab</span></h1>
      <p className="muted" style={{ marginBottom: 20, fontSize: 13 }}>
        Live snapshot from TradingView's scanner (unofficial API) + simulated paper fills at the TV price.
        No real money, no real orders — a sandbox for trying TV-driven ideas.
      </p>

      <div className="panel reveal" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ position: 'relative' }}>
            <input
              className="input"
              style={{ width: 240 }}
              value={symbol}
              onChange={(e) => { setSymbol(e.target.value.toUpperCase()); setSuggestOpen(true); }}
              onFocus={() => setSuggestOpen(true)}
              onBlur={() => setTimeout(() => setSuggestOpen(false), 150)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && suggestions.length) setSymbol(suggestions[0].symbol);
              }}
              placeholder="Any of 5,138 stocks, e.g. RELIANCE"
            />
            {suggestOpen && suggestions.length > 0 && (
              <div className="search-results" style={{ maxHeight: 320, overflowY: 'auto' }}>
                {suggestions.map((s) => (
                  <div key={s.symbol} className="search-item" onMouseDown={(e) => { e.preventDefault(); setSymbol(s.symbol); setSuggestOpen(false); }}>
                    <span className="sym">{s.symbol}</span>
                    <span className="name">{s.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <button className="btn" onClick={() => load(tvTicker)} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
          {QUICK.map((s) => (
            <button key={s} className="btn" onClick={() => setSymbol(s)} disabled={loading}>{s}</button>
          ))}
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          TradingView ticker: <b>{tvTicker}</b>
          {coverage ? ` · covers ${coverage.resolved.toLocaleString('en-IN')}/${coverage.universe.toLocaleString('en-IN')} universe stocks` : ''}
        </p>
      </div>

      {error ? (
        <div className="panel reveal">
          <div className="empty">{error}</div>
          <button className="btn" style={{ marginTop: 8 }} onClick={() => load(tvTicker)}>Retry</button>
        </div>
      ) : !tv ? (
        <div className="panel reveal"><div className="empty">Loading TradingView snapshot…</div></div>
      ) : (
        <>
          <div className="panel reveal" style={{ marginBottom: 16 }}>
            <div className="panel-title">
              <h3>{tv.tv} · {labCur}{fmt(tv.close)}</h3>
              <span className={tv.changePct != null && tv.changePct < 0 ? 'down' : 'up'}>
                {tv.changePct != null ? `${tv.changePct >= 0 ? '+' : ''}${tv.changePct.toFixed(2)}%` : '—'}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
              <div>
                <div className="muted" style={{ fontSize: 11 }}>TRADINGVIEW 1D RATING</div>
                <div className={gauge.cls} style={{ fontSize: 22, fontWeight: 800 }}>
                  {gauge.text}
                  <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>
                    {' '}({tv.ta?.['1D']?.all != null ? tv.ta['1D'].all.toFixed(2) : '—'})
                  </span>
                </div>
                <ScoreBar v={tv.ta?.['1D']?.all ?? null} />
              </div>
              <div className="muted" style={{ fontSize: 12 }}>
                {asOf ? `Snapshot ${new Date(asOf).toLocaleTimeString('en-IN')}` : ''} · auto-refresh 60s
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {TFS.map((tf) => {
                const g = scoreLabel(tv.ta?.[tf]?.all ?? null);
                return (
                  <span key={tf} className="pill" title={`MA: ${scoreLabel(tv.ta?.[tf]?.ma ?? null).text} · Oscillators: ${scoreLabel(tv.ta?.[tf]?.other ?? null).text}`}>
                    <span className="muted">{tf}</span>{' '}
                    <span className={g.cls}>{g.text}</span>
                  </span>
                );
              })}
            </div>
            <div className="dep-geo" style={{ marginTop: 12 }}>
              <div>RSI(14): <b>{fmt(tv.rsi, 1)}</b> {tv.rsi != null && (tv.rsi > 70 ? '(overbought)' : tv.rsi < 30 ? '(oversold)' : '(neutral)')}
                {' '}· MACD: <b>{fmt(tv.macd, 2)}</b> vs signal <b>{fmt(tv.macdSignal, 2)}</b></div>
              <div>Price vs SMA20 <b>{labCur}{fmt(tv.sma20)}</b> / SMA50 <b>{labCur}{fmt(tv.sma50)}</b> / SMA200 <b>{labCur}{fmt(tv.sma200)}</b>
                {' '}· Volume: <b>{fmtInt(tv.volume)}</b></div>
            </div>
          </div>

          {labIndian ? (
          <div className="panel reveal reveal-1" style={{ marginBottom: 16 }}>
            <div className="panel-title"><h3>Paper trade @ ₹{fmt(tv.close)}</h3><span className="hint">simulated fill +0.05% slippage</span></div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button className={`btn ${side === 'BUY' ? 'primary' : ''}`} onClick={() => setSide('BUY')}>BUY</button>
              <button className={`btn ${side === 'SELL' ? 'primary' : ''}`} onClick={() => setSide('SELL')}>SELL</button>
              <input
                className="input"
                style={{ maxWidth: 120 }}
                inputMode="numeric"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                placeholder="Qty"
              />
              <button className="btn primary" onClick={place}>Place {side}</button>
            </div>
            {msg && <p style={{ fontSize: 13, marginTop: 8 }}>{msg}</p>}
          </div>
          ) : (
          <div className="panel reveal reveal-1" style={{ marginBottom: 16 }}>
            <div className="panel-title"><h3>Snapshot only — US symbol</h3></div>
            <p className="muted" style={{ fontSize: 13, lineHeight: 1.6 }}>
              The ₹ Test wallet only trades NSE/BSE listings. For US paper trading use the{' '}
              <a href="#/us" style={{ color: 'var(--cyan)', textDecoration: 'none' }}>USA tab</a> (live screener) or{' '}
              <a href="#/paper" style={{ color: 'var(--cyan)', textDecoration: 'none' }}>Paper Lab → Live / Week Backtest</a>{' '}
              ($1,000 fresh daily, 1% stop).
            </p>
          </div>
          )}
        </>
      )}

      <div className="panel reveal reveal-2" style={{ marginBottom: 16 }}>
        <div className="panel-title">
          <h3>Most attractive now</h3>
          <span className="hint">
            {rankAsOf ? `live TV scan ${new Date(rankAsOf).toLocaleTimeString('en-IN')}` : 'scanning…'}
            {' '}· score 0–100 = rating 35 + day 20 + week 10 + RSI 15 + volume 10 + value 10
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
          <button className={`btn ${rankMarket === 'in' ? 'primary' : ''}`} onClick={() => { setRankMarket('in'); setRankSector(''); setRankCap(''); setRankShown(50); }}>
            India
          </button>
          <button className={`btn ${rankMarket === 'us' ? 'primary' : ''}`} onClick={() => { setRankMarket('us'); setRankSector(''); setRankCap(''); setRankShown(50); }}>
            USA
          </button>
          <select
            className="input"
            style={{ maxWidth: 220 }}
            value={rankSector}
            onChange={(e) => { setRankSector(e.target.value); setRankShown(50); }}
            title="Filter by sector"
          >
            <option value="">All sectors</option>
            {rankSectors.map((s) => (
              <option key={s.name} value={s.name}>{s.name} ({s.count})</option>
            ))}
          </select>
          <select
            className="input"
            style={{ maxWidth: 180 }}
            value={rankCap}
            onChange={(e) => { setRankCap(e.target.value); setRankShown(50); }}
            title="Filter by market capitalisation"
          >
            {CAP_OPTS[rankMarket].map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
          <input
            className="input"
            style={{ maxWidth: 200 }}
            value={rankFilter}
            onChange={(e) => { setRankFilter(e.target.value); setRankShown(50); }}
            placeholder={`Search ${rankPool.length} stocks…`}
          />
          <button className="btn" onClick={() => loadRank(rankMarket, rankSector, rankCap)} disabled={rankLoading}>
            {rankLoading ? 'Scanning…' : 'Refresh'}
          </button>
        </div>
        {rankError ? (
          <div className="empty">{rankError} <button className="btn" style={{ marginLeft: 8 }} onClick={() => loadRank(rankMarket, rankSector, rankCap)}>Retry</button></div>
        ) : rankPool.length === 0 ? (
          <div className="empty">
            {rankLoading ? 'Scanning TradingView…' : 'No stocks match those filters — loosen the sector or cap filter.'}
          </div>
        ) : (
          <>
            <div className="table-wrap">
              <table className="s-table">
                <thead>
                  <tr><th>#</th><th>Symbol</th><th>Price</th><th>Day</th><th>Score</th><th>RSI</th><th>Sector</th><th>Mkt Cap</th><th>Why attractive</th></tr>
                </thead>
                <tbody>
                  {rankPool.slice(0, rankShown).map((r, i) => {
                    const cur = rankMarket === 'in' ? '₹' : '$';
                    return (
                      <tr
                        key={`${r.exchange}:${r.symbol}`}
                        style={{ cursor: 'pointer' }}
                        title={rankMarket === 'in' ? `Load ${r.symbol} into the lab above` : `View ${r.symbol} snapshot above (US is view-only in this lab)`}
                        onClick={() => {
                          setSymbol(rankMarket === 'in' ? r.symbol : `${r.exchange}:${r.symbol}`);
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                      >
                        <td>{i + 1}</td>
                        <td><b>{r.symbol}</b> <span className="muted">{r.name.length > 24 ? `${r.name.slice(0, 24)}…` : r.name}</span></td>
                        <td>{cur}{fmt(r.price)}</td>
                        <td className={r.changePct != null && r.changePct < 0 ? 'down' : 'up'}>
                          {r.changePct != null ? `${r.changePct >= 0 ? '+' : ''}${r.changePct.toFixed(1)}%` : '—'}
                        </td>
                        <td>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ display: 'inline-block', width: 56, height: 6, borderRadius: 3, background: 'rgba(148,163,184,0.15)', overflow: 'hidden' }}>
                              <span style={{ display: 'block', height: '100%', width: `${Math.max(0, Math.min(100, r.score))}%`, background: r.score >= 60 ? 'var(--up)' : r.score >= 40 ? 'var(--amber, #ffb020)' : 'var(--down)', borderRadius: 3 }} />
                            </span>
                            <b>{r.score.toFixed(0)}</b>
                          </span>
                        </td>
                        <td>{r.rsi != null ? r.rsi.toFixed(0) : '—'}</td>
                        <td className="muted">{r.sector || '—'}</td>
                        <td className="muted">{r.marketCapDisplay}</td>
                        <td className="muted" style={{ fontSize: 12 }}>{r.reasons.join(' · ')}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {rankShown < rankPool.length && (
              <button className="btn" style={{ marginTop: 10 }} onClick={() => setRankShown((n) => n + 50)}>
                Show more ({rankPool.length - rankShown} left)
              </button>
            )}
          </>
        )}
      </div>

      <div className="panel reveal reveal-2">
        <div className="panel-title">
          <h3>Test wallet · ₹{fmtInt(wallet.cash)} cash</h3>
          <button
            className="btn"
            onClick={() => {
              if (window.confirm('Reset the Test wallet to ₹1,00,000?')) setWallet(freshWallet());
            }}
          >
            Reset
          </button>
        </div>
        <p className="muted" style={{ fontSize: 12 }}>
          Invested ~₹{fmtInt(invested)} · Realised P&amp;L ₹{fmt(realised)} · Local only — moves to your account when the backend arrives.
        </p>
        {Object.keys(wallet.positions).length === 0 ? (
          <div className="empty">No Test positions yet — pick a symbol above and place your first simulated trade.</div>
        ) : (
          <div className="table-wrap">
            <table className="s-table">
              <thead><tr><th>Symbol</th><th>Qty</th><th>Avg</th><th>Realised</th></tr></thead>
              <tbody>
                {Object.entries(wallet.positions).map(([s, p]) => (
                  <tr key={s}><td>{s}</td><td>{p.qty}</td><td>₹{fmt(p.avg)}</td><td>₹{fmt(p.realized)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {wallet.trades.length > 0 && (
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table className="s-table">
              <thead><tr><th>#</th><th>Symbol</th><th>Side</th><th>Qty</th><th>Price</th><th>Time</th></tr></thead>
              <tbody>
                {wallet.trades.slice(0, 20).map((t) => (
                  <tr key={t.id}>
                    <td>{t.id}</td><td>{t.tv}</td>
                    <td className={t.side === 'BUY' ? 'up' : 'down'}>{t.side}</td>
                    <td>{t.qty}</td><td>₹{fmt(t.price)}</td>
                    <td>{new Date(t.ts).toLocaleString('en-IN')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="muted" style={{ fontSize: 11, marginTop: 12 }}>
        Data: TradingView scanner via an unofficial API (rate-limited, may lag the exchange).
        All Test trades are simulated paper fills for learning — not investment advice.
      </p>
    </div>
  );
}
