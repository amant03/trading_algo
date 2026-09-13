import { useCallback, useEffect, useMemo, useState } from 'react';
import { get } from '../api';

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

export default function Test() {
  const [symbol, setSymbol] = useState('RELIANCE');
  const [tv, setTv] = useState<TvSymbol | null>(null);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
  const [qty, setQty] = useState('1');
  const [msg, setMsg] = useState<string | null>(null);
  const [wallet, setWallet] = useState<TestWallet>(loadWallet);

  useEffect(() => {
    try {
      localStorage.setItem(WL_KEY, JSON.stringify(wallet));
    } catch { /* storage unavailable */ }
  }, [wallet]);

  const load = useCallback(async (sym: string) => {
    const clean = sym.trim().toUpperCase();
    if (!clean) return;
    setLoading(true);
    setError(null);
    try {
      const r = await get<TvResp>(`/api/tv?symbols=${encodeURIComponent(`NSE:${clean}`)}`);
      const row = r.symbols?.[0] ?? null;
      if (!row || row.close == null) {
        setTv(null);
        setError(`No TradingView data for NSE:${clean} — check the symbol and retry.`);
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
    void load(symbol);
    const t = setInterval(() => load(symbol), 60_000);
    return () => clearInterval(t);
  }, [load, symbol]);

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
          <input
            className="input"
            style={{ maxWidth: 220 }}
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            placeholder="NSE symbol, e.g. RELIANCE"
          />
          <button className="btn" onClick={() => load(symbol)} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
          {QUICK.map((s) => (
            <button key={s} className="btn" onClick={() => setSymbol(s)} disabled={loading}>{s}</button>
          ))}
        </div>
      </div>

      {error ? (
        <div className="panel reveal">
          <div className="empty">{error}</div>
          <button className="btn" style={{ marginTop: 8 }} onClick={() => load(symbol)}>Retry</button>
        </div>
      ) : !tv ? (
        <div className="panel reveal"><div className="empty">Loading TradingView snapshot…</div></div>
      ) : (
        <>
          <div className="panel reveal" style={{ marginBottom: 16 }}>
            <div className="panel-title">
              <h3>{tv.tv} · ₹{fmt(tv.close)}</h3>
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
              <div>Price vs SMA20 <b>₹{fmt(tv.sma20)}</b> / SMA50 <b>₹{fmt(tv.sma50)}</b> / SMA200 <b>₹{fmt(tv.sma200)}</b>
                {' '}· Volume: <b>{fmtInt(tv.volume)}</b></div>
            </div>
          </div>

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
        </>
      )}

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
