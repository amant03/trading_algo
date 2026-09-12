import { useEffect, useState } from 'react';

interface WeekTrade {
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

interface DayCard {
  date: string;
  weekday: string;
  startCapital: number;
  capital: number;
  equity: number;
  realizedPnl: number;
  dayPnl: number;
  dayPnlPct: number;
  wins: number;
  losses: number;
  trades: WeekTrade[];
  status: 'open' | 'closed' | 'holiday';
  bars: number;
}

interface WeekStore {
  ts: string;
  config: {
    inCapital: number;
    usCapital: number;
    stopLossPct: number;
    takeProfit: null;
    strategies: string[];
    note: string;
  };
  in: DayCard[];
  us: DayCard[];
}

const WEEK_URLS = [
  'https://cdn.jsdelivr.net/gh/amant03/trading_algo@automation-data/frontend/public/paper/week.json',
  'https://raw.githubusercontent.com/amant03/trading_algo/automation-data/frontend/public/paper/week.json',
  '/paper/week.json',
];

const STRAT_LABELS = new Map([
  ['ma_cross', 'MA Cross'],
  ['rsi_reversal', 'RSI Reversal'],
  ['macd_cross', 'MACD Cross'],
  ['bb_breakout', 'Bollinger'],
  ['supertrend', 'Supertrend'],
]);

const EXIT_LABEL: Record<WeekTrade['exitClass'], string> = {
  entry: 'Entry',
  eod: 'EOD square-off',
  'signal-exit': 'Signal exit',
  'stop-loss': 'Stop-loss 1%',
};

const inr = (n: number | null | undefined, digits = 0): string =>
  n == null || !isFinite(n) ? '—' : `₹${n.toLocaleString('en-IN', { maximumFractionDigits: digits })}`;

const usd = (n: number | null | undefined, digits = 0): string =>
  n == null || !isFinite(n) ? '—' : `$${n.toLocaleString('en-US', { maximumFractionDigits: digits })}`;

const cls = (n: number | null | undefined): string => (n == null ? '' : n > 0.004 ? 'up' : n < -0.004 ? 'down' : '');

function LegTrades({ trades, money }: { trades: WeekTrade[]; money: (n: number | null | undefined, d?: number) => string }) {
  const sells = trades.filter((t) => t.side === 'SELL');
  const buys = trades.filter((t) => t.side === 'BUY').length;
  if (!trades.length) return <div className="empty">No trades this session.</div>;
  return (
    <div>
      <div className="muted" style={{ fontSize: 11.5, marginBottom: 6 }}>
        {buys} entries · {sells.length} exits
      </div>
      <div className="table paper-ledger">
        <div className="tr head">
          <span>Time</span><span>Method</span><span>Symbol</span><span>Side</span>
          <span>Qty</span><span>Price</span><span>P&L</span><span>Why — technical reason</span>
        </div>
        {trades.map((t, i) => (
          <div key={i} className="tr">
            <span className="mono muted">{t.time}</span>
            <span className="muted">{STRAT_LABELS.get(t.strategy) ?? t.strategy}</span>
            <span className="mono">{t.symbol}</span>
            <span className={t.side === 'BUY' ? 'up' : 'down'}>{t.side}</span>
            <span className="mono">{t.qty}</span>
            <span className="mono">{money(t.price, 2)}</span>
            <span className={cls(t.side === 'SELL' ? t.pnl : null)}>
              {t.side === 'SELL' ? `${money(t.pnl)}${t.retPct != null ? ` (${t.retPct >= 0 ? '+' : ''}${t.retPct}%)` : ''}` : '—'}
            </span>
            <span style={{ fontSize: 11.5, lineHeight: 1.5 }}>
              <div>{t.reason}</div>
              <div className="mono muted" style={{ fontSize: 10.5, marginTop: 2 }}>{t.tech}</div>
              <div className="muted" style={{ fontSize: 10.5 }}>{EXIT_LABEL[t.exitClass]}</div>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DayCardView({ inCard, usCard }: { inCard: DayCard | undefined; usCard: DayCard | undefined }) {
  const [showIn, setShowIn] = useState(false);
  const [showUs, setShowUs] = useState(false);
  const date = inCard?.date ?? usCard?.date ?? '';
  const weekday = inCard?.weekday || usCard?.weekday || '';
  const d = new Date(`${date}T12:00:00`);
  const pretty = isNaN(d.getTime())
    ? date
    : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

  return (
    <div className="panel reveal" style={{ padding: '12px 14px', minWidth: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <div style={{ fontWeight: 800, fontSize: 15 }}>{weekday} <span className="muted" style={{ fontWeight: 500, fontSize: 12 }}>{pretty}</span></div>
        <span className="hint mono" style={{ fontSize: 10.5 }}>{date.slice(5)}</span>
      </div>

      {/* P&L FIRST — India */}
      <div style={{ borderTop: '1px solid rgba(148,163,184,0.1)', paddingTop: 8, marginBottom: 4 }}>
        <div className="muted" style={{ fontSize: 10.5, letterSpacing: '0.08em' }}>🇮🇳 INDIA · ₹10,000 fresh</div>
        {inCard ? (
          <>
            <div className={cls(inCard.dayPnl)} style={{ fontSize: 20, fontWeight: 800 }}>
              {inr(inCard.dayPnl)} <small style={{ fontSize: 12, fontWeight: 600 }}>({inCard.dayPnlPct >= 0 ? '+' : ''}{inCard.dayPnlPct}%)</small>
            </div>
            <div className="muted" style={{ fontSize: 11.5 }}>
              {inCard.wins}W / {inCard.losses}L · {inCard.trades.filter((t) => t.side === 'SELL').length} round trips
              {inCard.status === 'open' ? ' · live' : ''}
            </div>
            <button className="btn" style={{ marginTop: 6, padding: '4px 10px', fontSize: 11.5 }} onClick={() => setShowIn(!showIn)}>
              {showIn ? 'Hide India trades' : `Show India trades (${inCard.trades.length})`}
            </button>
            {showIn && <div style={{ marginTop: 8 }}><LegTrades trades={inCard.trades} money={inr} /></div>}
          </>
        ) : (
          <div className="empty">No India session.</div>
        )}
      </div>

      {/* P&L FIRST — USA */}
      <div style={{ borderTop: '1px solid rgba(148,163,184,0.1)', paddingTop: 8, marginTop: 8 }}>
        <div className="muted" style={{ fontSize: 10.5, letterSpacing: '0.08em' }}>🇺🇸 USA · $1,000 fresh</div>
        {usCard ? (
          <>
            <div className={cls(usCard.dayPnl)} style={{ fontSize: 20, fontWeight: 800 }}>
              {usd(usCard.dayPnl)} <small style={{ fontSize: 12, fontWeight: 600 }}>({usCard.dayPnlPct >= 0 ? '+' : ''}{usCard.dayPnlPct}%)</small>
            </div>
            <div className="muted" style={{ fontSize: 11.5 }}>
              {usCard.wins}W / {usCard.losses}L · {usCard.trades.filter((t) => t.side === 'SELL').length} round trips
              {usCard.status === 'open' ? ' · live' : ''}
            </div>
            <button className="btn" style={{ marginTop: 6, padding: '4px 10px', fontSize: 11.5 }} onClick={() => setShowUs(!showUs)}>
              {showUs ? 'Hide US trades' : `Show US trades (${usCard.trades.length})`}
            </button>
            {showUs && <div style={{ marginTop: 8 }}><LegTrades trades={usCard.trades} money={usd} /></div>}
          </>
        ) : (
          <div className="empty">No US session.</div>
        )}
      </div>
    </div>
  );
}

export default function WeekDuel() {
  const [store, setStore] = useState<WeekStore | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const load = async () => {
      for (const url of WEEK_URLS) {
        try {
          const res = await fetch(url, { cache: 'no-store' });
          if (!res.ok) continue;
          const ct = res.headers.get('content-type') ?? '';
          if (ct.includes('text/html')) continue;
          const data = (await res.json()) as WeekStore;
          if (!data || !Array.isArray(data.in) || !Array.isArray(data.us)) continue;
          if (live) {
            setStore(data);
            setErr(null);
          }
          return;
        } catch {
          // try next mirror
        }
      }
      if (live && !store) setErr('Weekly duel not published yet — it is generated by the automation run.');
    };
    void load();
    const t = setInterval(load, 300_000);
    return () => {
      live = false;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (err) return <div className="empty">{err}</div>;
  if (!store) return <div className="empty">Loading weekly duel…</div>;

  const n = Math.max(store.in.length, store.us.length, 1);
  const idx = Array.from({ length: Math.min(n, 5) }, (_, i) => i);
  const inTot = store.in.reduce((a, c) => a + c.dayPnl, 0);
  const usTot = store.us.reduce((a, c) => a + c.dayPnl, 0);

  return (
    <div>
      <div className="panel reveal" style={{ marginBottom: 12, padding: '12px 16px' }}>
        <div className="panel-title" style={{ marginBottom: 8 }}>
          <h3>Weekly duel — fresh account every day</h3>
          <span className="hint">
            week <span className={cls(inTot)}>{inr(inTot)}</span> · <span className={cls(usTot)}>{usd(usTot)}</span>
          </span>
        </div>
        <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.55 }}>
          Each card = one trading day. Every day starts fresh with <b>₹10,000</b> on NSE and <b>$1,000</b> on NYSE/NASDAQ,
          split across the 5 methods. <b>1% hard stop-loss, no take-profit</b> — winners run until a bearish signal or the
          closing bell. P&L first; expand a leg to see every trade with its technical reason.
        </div>
      </div>

      <div style={{ overflowX: 'auto', paddingBottom: 4 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(230px, 1fr))', gap: 12, minWidth: 1220 }}>
          {idx.map((i) => (
            <DayCardView key={i} inCard={store.in[i]} usCard={store.us[i]} />
          ))}
        </div>
      </div>
      <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>
        Generated {new Date(store.ts).toLocaleString('en-IN')} · 5-min bars via Yahoo Finance · intraday only, squared off daily
      </div>
    </div>
  );
}
