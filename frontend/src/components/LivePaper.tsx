import { useEffect, useState } from 'react';

interface LiveTrade {
  time: string;
  strategy: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  qty: number;
  price: number;
  pnl: number;
  retPct: number | null;
  exitClass: 'entry' | 'eod' | 'signal-exit' | 'stop-loss';
  reason: string;
  tech: string;
}

interface LiveOpen {
  strategy: string;
  symbol: string;
  qty: number;
  entryPrice: number;
  lastPrice: number;
  unrealized: number;
  unrealizedPct: number;
  entryTime: string;
  entryReason: string;
}

interface LiveLeg {
  date: string;
  weekday: string;
  status: 'open' | 'closed' | 'holiday';
  startCapital: number;
  cash: number;
  realizedPnl: number;
  unrealizedPnl: number;
  dayPnl: number;
  dayPnlPct: number;
  wins: number;
  losses: number;
  open: LiveOpen[];
  trades: LiveTrade[];
  bars: number;
}

interface LiveStore {
  ts: string;
  in: LiveLeg | null;
  us: LiveLeg | null;
}

const LIVE_URLS = [
  'https://cdn.jsdelivr.net/gh/amant03/trading_algo@automation-data/frontend/public/paper/live.json',
  'https://raw.githubusercontent.com/amant03/trading_algo/automation-data/frontend/public/paper/live.json',
  '/paper/live.json',
];

const STRAT_LABELS = new Map([
  ['ma_cross', 'MA Cross'],
  ['rsi_reversal', 'RSI Reversal'],
  ['macd_cross', 'MACD Cross'],
  ['bb_breakout', 'Bollinger'],
  ['supertrend', 'Supertrend'],
]);

const moneyIn = (n: number | null | undefined, digits = 0): string =>
  n == null || !isFinite(n) ? '—' : `₹${n.toLocaleString('en-IN', { maximumFractionDigits: digits })}`;

const moneyUs = (n: number | null | undefined, digits = 0): string =>
  n == null || !isFinite(n) ? '—' : `$${n.toLocaleString('en-US', { maximumFractionDigits: digits })}`;

const cls = (n: number | null | undefined): string => (n == null ? '' : n > 0.004 ? 'up' : n < -0.004 ? 'down' : '');

const prettyDate = (date: string): string => {
  const d = new Date(`${date}T12:00:00`);
  return isNaN(d.getTime()) ? date : d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
};

function LegPanel({
  title,
  pill,
  pillFg,
  pillBg,
  leg,
  money,
  refreshedAt,
}: {
  title: string;
  pill: string;
  pillFg: string;
  pillBg: string;
  leg: LiveLeg | null;
  money: (n: number | null | undefined, d?: number) => string;
  refreshedAt: string;
}) {
  const [showTrades, setShowTrades] = useState(false);
  if (!leg) return <div className="empty">No live session published for this market yet.</div>;
  const live = leg.status === 'open';
  const sells = leg.trades.filter((t) => t.side === 'SELL');

  return (
    <div className="panel reveal" style={{ padding: '14px 18px' }}>
      <div className="panel-title" style={{ flexWrap: 'wrap', gap: 10 }}>
        <h3>
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.08em', color: pillFg, background: pillBg, borderRadius: 4, padding: '2px 7px', marginRight: 8 }}>
            {pill}
          </span>
          {title}
        </h3>
        <span className="hint" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="dot" style={{ background: live ? 'var(--up)' : 'var(--down)', width: 7, height: 7, borderRadius: '50%', display: 'inline-block' }} />
          {leg.status === 'open' ? 'SESSION LIVE' : leg.status === 'closed' ? `CLOSED · ${prettyDate(leg.date)}` : 'NO SESSION'} · {refreshedAt}
        </span>
      </div>

      <div className="stat-grid" style={{ marginBottom: 12 }}>
        <div className="stat-card">
          <div className="stat-label">Day P&L (live)</div>
          <div className={cls(leg.dayPnl)} style={{ fontSize: 22, fontWeight: 800 }}>{money(leg.dayPnl)}</div>
          <div className="stat-sub">{leg.dayPnlPct >= 0 ? '+' : ''}{leg.dayPnlPct}% of fresh {money(leg.startCapital)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Realised / Open</div>
          <div className={cls(leg.realizedPnl)}>{money(leg.realizedPnl)} <span className="muted">/</span> <span className={cls(leg.unrealizedPnl)}>{money(leg.unrealizedPnl)}</span></div>
          <div className="stat-sub">{leg.wins} won · {leg.losses} lost · {sells.length} round trips</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Open positions</div>
          <div className="mono" style={{ fontSize: 22, fontWeight: 800 }}>{leg.open.length}</div>
          <div className="stat-sub">1% stop on each · no take-profit</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Cash</div>
          <div className="mono">{money(leg.cash)}</div>
          <div className="stat-sub">{leg.bars} bars replayed today</div>
        </div>
      </div>

      {leg.open.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div className="muted" style={{ fontSize: 11, letterSpacing: '0.08em', marginBottom: 6 }}>HELD NOW — MARKED TO LATEST BAR</div>
          <div className="table">
            <div className="tr head">
              <span>Method</span><span>Symbol</span><span>Qty</span><span>Entry</span><span>Last</span><span>Unrealised</span>
            </div>
            {leg.open.map((p) => (
              <div className="tr" key={p.strategy + p.symbol}>
                <span className="muted">{STRAT_LABELS.get(p.strategy) ?? p.strategy}</span>
                <span className="mono" style={{ fontWeight: 700 }}>{p.symbol}</span>
                <span className="mono">{p.qty}</span>
                <span className="mono">{money(p.entryPrice, 2)} <small className="muted">{p.entryTime}</small></span>
                <span className="mono">{money(p.lastPrice, 2)}</span>
                <span className={cls(p.unrealized)} style={{ fontWeight: 700 }}>
                  {money(p.unrealized)} <small>({p.unrealizedPct >= 0 ? '+' : ''}{p.unrealizedPct}%)</small>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <button className="btn" style={{ fontSize: 12 }} onClick={() => setShowTrades(!showTrades)}>
        {showTrades ? 'Hide today\u2019s trades' : `Show today\u2019s trades (${leg.trades.length}) — newest first`}
      </button>
      {showTrades && (
        <div style={{ marginTop: 10, overflowX: 'auto' }}>
          {leg.trades.length ? (
            <div className="table paper-ledger" style={{ minWidth: 980 }}>
              <div className="tr head">
                <span>Time</span><span>Method</span><span>Symbol</span><span>Side</span>
                <span>Qty</span><span>Price</span><span>P&L</span><span>Exit</span><span>Technical reason</span>
              </div>
              {leg.trades.map((t, i) => (
                <div key={i} className="tr">
                  <span className="mono muted">{t.time}</span>
                  <span className="muted">{STRAT_LABELS.get(t.strategy) ?? t.strategy}</span>
                  <span className="mono" style={{ fontWeight: 700 }}>{t.symbol}</span>
                  <span className={t.side === 'BUY' ? 'up' : 'down'} style={{ fontWeight: 700 }}>{t.side}</span>
                  <span className="mono">{t.qty}</span>
                  <span className="mono">{money(t.price, 2)}</span>
                  <span className={cls(t.side === 'SELL' ? t.pnl : null)} style={{ fontWeight: 600 }}>
                    {t.side === 'SELL' ? `${money(t.pnl)}${t.retPct != null ? ` (${t.retPct >= 0 ? '+' : ''}${t.retPct}%)` : ''}` : '—'}
                  </span>
                  <span className="muted" style={{ fontSize: 11 }}>
                    {t.exitClass === 'entry' ? 'Entry' : t.exitClass === 'stop-loss' ? 'Stop-loss' : t.exitClass === 'signal-exit' ? 'Signal exit' : 'Square-off'}
                  </span>
                  <span style={{ fontSize: 12, lineHeight: 1.5, whiteSpace: 'normal', textAlign: 'left' }}>
                    <div>{t.reason}</div>
                    <div className="mono muted" style={{ fontSize: 11, marginTop: 3 }}>{t.tech}</div>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty">No signals yet today — methods enter only when their setup triggers.</div>
          )}
        </div>
      )}
    </div>
  );
}

export default function LivePaper() {
  const [store, setStore] = useState<LiveStore | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const load = async () => {
      for (const url of LIVE_URLS) {
        try {
          const res = await fetch(url, { cache: 'no-store' });
          if (!res.ok) continue;
          const ct = res.headers.get('content-type') ?? '';
          if (ct.includes('text/html')) continue;
          const data = (await res.json()) as LiveStore;
          if (!data || !('in' in data) || !('us' in data)) continue;
          if (live) {
            setStore(data);
            setErr(null);
          }
          return;
        } catch {
          // try next mirror
        }
      }
      if (live) setErr('Live paper trading not published yet — it updates during market hours.');
    };
    void load();
    const t = setInterval(load, 60_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);

  if (err) return <div className="empty">{err}</div>;
  if (!store) return <div className="empty">Loading live paper trading…</div>;
  const refreshedAt = `updated ${new Date(store.ts).toLocaleTimeString('en-IN')}`;

  return (
    <div>
      <div className="panel reveal" style={{ marginBottom: 12, padding: '12px 16px' }}>
        <div className="panel-title" style={{ marginBottom: 8 }}>
          <h3>Live paper trading — today&apos;s session</h3>
          <span className="hint">fresh ₹10,000 NSE + $1,000 US · long-only · 1% stop · no take-profit</span>
        </div>
        <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.55 }}>
          The automation replays today&apos;s 5-minute bars every run during market hours. Positions stay open and are
          marked to the latest bar; everything squares off at the closing bell and the account resets fresh tomorrow.
          For multi-day history, see the Week Backtest tab.
        </div>
      </div>
      <div style={{ display: 'grid', gap: 12 }}>
        <LegPanel title="India · NSE" pill="NSE" pillFg="#ffb020" pillBg="rgba(255,176,32,0.12)" leg={store.in} money={moneyIn} refreshedAt={refreshedAt} />
        <LegPanel title="USA · NYSE/NASDAQ" pill="US" pillFg="#4cc9f0" pillBg="rgba(76,201,240,0.12)" leg={store.us} money={moneyUs} refreshedAt={refreshedAt} />
      </div>
    </div>
  );
}
