import { useEffect, useMemo, useState } from 'react';

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

type Leg = 'in' | 'us';

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

const EXIT_CHIP: Record<WeekTrade['exitClass'], { label: string; color: string; bg: string }> = {
  entry: { label: 'Entry', color: '#4cc9f0', bg: 'rgba(76,201,240,0.1)' },
  eod: { label: 'Square-off', color: '#94a3b8', bg: 'rgba(148,163,184,0.1)' },
  'signal-exit': { label: 'Signal exit', color: '#ffb020', bg: 'rgba(255,176,32,0.1)' },
  'stop-loss': { label: 'Stop-loss', color: '#ff5c5c', bg: 'rgba(255,92,92,0.12)' },
};

const LEG_META: Record<Leg, { name: string; pill: string; pillFg: string; pillBg: string; capital: string }> = {
  in: { name: 'India · NSE', pill: 'NSE', pillFg: '#ffb020', pillBg: 'rgba(255,176,32,0.12)', capital: '₹10,000 fresh' },
  us: { name: 'USA · NYSE/NASDAQ', pill: 'US', pillFg: '#4cc9f0', pillBg: 'rgba(76,201,240,0.12)', capital: '$1,000 fresh' },
};

const fmtINR = (n: number | null | undefined, digits = 0): string =>
  n == null || !isFinite(n) ? '—' : `₹${n.toLocaleString('en-IN', { maximumFractionDigits: digits })}`;

const fmtUSD = (n: number | null | undefined, digits = 0): string =>
  n == null || !isFinite(n) ? '—' : `$${n.toLocaleString('en-US', { maximumFractionDigits: digits })}`;

const money: Record<Leg, (n: number | null | undefined, d?: number) => string> = { in: fmtINR, us: fmtUSD };

const cls = (n: number | null | undefined): string => (n == null ? '' : n > 0.004 ? 'up' : n < -0.004 ? 'down' : '');

const prettyDate = (date: string): string => {
  const d = new Date(`${date}T12:00:00`);
  return isNaN(d.getTime()) ? date : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

/** Cumulative week P&L sparkline (one normalized line per market). */
function WeekSpark({ inCards, usCards }: { inCards: DayCard[]; usCards: DayCard[] }) {
  const n = Math.max(inCards.length, usCards.length);
  if (n < 2) return null;
  const cum = (cards: DayCard[]): number[] => {
    let s = 0;
    return cards.map((c) => (s += c.dayPnl));
  };
  const a = cum(inCards);
  const b = cum(usCards);
  const w = 260;
  const h = 64;
  const line = (vals: number[], color: string) => {
    const min = Math.min(...vals, 0);
    const max = Math.max(...vals, 0);
    const span = Math.max(max - min, 1e-9);
    const pts = vals.map((v, i) => `${((i / (vals.length - 1)) * w).toFixed(1)},${(h - 6 - ((v - min) / span) * (h - 12)).toFixed(1)}`).join(' ');
    const zeroY = (h - 6 - ((0 - min) / span) * (h - 12)).toFixed(1);
    return (
      <g key={color}>
        <line x1="0" x2={w} y1={zeroY} y2={zeroY} stroke="rgba(148,163,184,0.25)" strokeWidth="1" strokeDasharray="3 3" />
        <polyline points={pts} fill="none" stroke={color} strokeWidth="2" />
      </g>
    );
  };
  return (
    <div style={{ minWidth: 220 }}>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: '100%', height: 64, display: 'block' }}>
        {line(a, '#ffb020')}
        {line(b, '#4cc9f0')}
      </svg>
      <div style={{ display: 'flex', gap: 12, fontSize: 11 }} className="muted">
        <span><span style={{ color: '#ffb020' }}>━</span> India cum.</span>
        <span><span style={{ color: '#4cc9f0' }}>━</span> USA cum.</span>
      </div>
    </div>
  );
}

function LegPnl({ card, leg }: { card: DayCard | undefined; leg: Leg }) {
  const meta = LEG_META[leg];
  if (!card) return <div className="empty">No session.</div>;
  const trips = card.trades.filter((t) => t.side === 'SELL').length;
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.08em', color: meta.pillFg, background: meta.pillBg, borderRadius: 4, padding: '2px 6px' }}>
          {meta.pill}
        </span>
        <span className="muted" style={{ fontSize: 11 }}>{meta.capital}</span>
      </div>
      <div className={cls(card.dayPnl)} style={{ fontSize: 22, fontWeight: 800, lineHeight: 1.1 }}>
        {money[leg](card.dayPnl)}{' '}
        <small style={{ fontSize: 12, fontWeight: 600 }}>
          ({card.dayPnlPct >= 0 ? '+' : ''}{card.dayPnlPct}%)
        </small>
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
        {card.wins}W / {card.losses}L · {trips} round trip{trips === 1 ? '' : 's'}
        {card.status === 'open' ? ' · live' : ''}
      </div>
    </div>
  );
}

export default function WeekDuel() {
  const [store, setStore] = useState<WeekStore | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [selDay, setSelDay] = useState<number>(-1);
  const [selLeg, setSelLeg] = useState<Leg>('in');

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
            setSelDay((prev) => (prev < 0 ? Math.max(data.in.length, data.us.length) - 1 : prev));
          }
          return;
        } catch {
          // try next mirror
        }
      }
      if (live) setErr('Weekly duel not published yet — it is generated by the automation run.');
    };
    void load();
    const t = setInterval(load, 300_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);

  const stats = useMemo(() => {
    if (!store || selDay < 0) return null;
    const card = selLeg === 'in' ? store.in[selDay] : store.us[selDay];
    if (!card) return null;
    const sells = card.trades.filter((t) => t.side === 'SELL');
    const best = sells.reduce<WeekTrade | null>((a, t) => (!a || t.pnl > a.pnl ? t : a), null);
    const worst = sells.reduce<WeekTrade | null>((a, t) => (!a || t.pnl < a.pnl ? t : a), null);
    return { card, sells, best, worst };
  }, [store, selDay, selLeg]);

  if (err) return <div className="empty">{err}</div>;
  if (!store) return <div className="empty">Loading weekly duel…</div>;

  const n = Math.min(Math.max(store.in.length, store.us.length, 1), 5);
  const idx = Array.from({ length: n }, (_, i) => i);
  const inTot = store.in.reduce((a, c) => a + c.dayPnl, 0);
  const usTot = store.us.reduce((a, c) => a + c.dayPnl, 0);
  const selCard = selLeg === 'in' ? store.in[selDay] : store.us[selDay];

  const pick = (day: number, leg: Leg) => {
    setSelDay(day);
    setSelLeg(leg);
    requestAnimationFrame(() => {
      document.getElementById('week-detail')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  };

  return (
    <div>
      {/* Week summary */}
      <div className="panel reveal" style={{ marginBottom: 12, padding: '14px 18px' }}>
        <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 320px', minWidth: 260 }}>
            <div className="panel-title" style={{ marginBottom: 6 }}>
              <h3>Week backtest — last 5 sessions, replayed</h3>
            </div>
            <div style={{ display: 'flex', gap: 28, marginBottom: 8 }}>
              <div>
                <div className="muted" style={{ fontSize: 11, letterSpacing: '0.08em' }}>INDIA WEEK</div>
                <div className={cls(inTot)} style={{ fontSize: 22, fontWeight: 800 }}>{fmtINR(inTot)}</div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: 11, letterSpacing: '0.08em' }}>USA WEEK</div>
                <div className={cls(usTot)} style={{ fontSize: 22, fontWeight: 800 }}>{fmtUSD(usTot)}</div>
              </div>
            </div>
            <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.55 }}>
              <b>Historical replay</b>, not live trading: each of the last 5 sessions is replayed with a fresh{' '}
              <b>₹10,000</b> (NSE) and <b>$1,000</b> (NYSE/NASDAQ) account split across 5 methods.{' '}
              <b>1% hard stop-loss, no take-profit.</b> For today&apos;s live positions, see the Live tab.
            </div>
          </div>
          <WeekSpark inCards={store.in} usCards={store.us} />
        </div>
      </div>

      {/* 5 day cards — P&L only */}
      <div style={{ overflowX: 'auto', paddingBottom: 4 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(220px, 1fr))', gap: 12, minWidth: 1180 }}>
          {idx.map((i) => {
            const inCard = store.in[i];
            const usCard = store.us[i];
            const date = inCard?.date ?? usCard?.date ?? '';
            const weekday = inCard?.weekday || usCard?.weekday || '';
            const active = i === selDay;
            const dayPnl = (inCard?.dayPnl ?? 0) >= 0 || (usCard?.dayPnl ?? 0) >= 0;
            return (
              <div
                key={i}
                className="panel reveal"
                onClick={() => pick(i, selLeg)}
                style={{
                  padding: '14px 16px',
                  minWidth: 0,
                  cursor: 'pointer',
                  borderTop: `3px solid ${dayPnl ? 'var(--up)' : 'var(--down)'}`,
                  outline: active ? '2px solid var(--cyan)' : 'none',
                  outlineOffset: -1,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
                  <div style={{ fontWeight: 800, fontSize: 16 }}>{weekday}</div>
                  <div className="muted" style={{ fontSize: 12 }}>{prettyDate(date)}</div>
                </div>
                <LegPnl card={inCard} leg="in" />
                <div style={{ borderTop: '1px solid rgba(148,163,184,0.1)', marginTop: 10, paddingTop: 10 }}>
                  <LegPnl card={usCard} leg="us" />
                </div>
                <button
                  className="btn"
                  style={{ marginTop: 10, width: '100%', fontSize: 12 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    pick(i, selLeg);
                  }}
                >
                  {active ? 'Viewing trades below' : 'View trades'}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Full-width trade detail for the selected day */}
      {stats && selCard && (
        <div id="week-detail" className="panel reveal" style={{ marginTop: 12 }}>
          <div className="panel-title" style={{ flexWrap: 'wrap', gap: 10 }}>
            <h3>
              {selCard.weekday} {prettyDate(selCard.date)} — {LEG_META[selLeg].name} trades
            </h3>
            <span style={{ display: 'flex', gap: 6 }}>
              {(['in', 'us'] as Leg[]).map((leg) => (
                <button
                  key={leg}
                  className="btn"
                  style={{
                    padding: '4px 12px',
                    fontSize: 12,
                    borderColor: selLeg === leg ? LEG_META[leg].pillFg : undefined,
                    color: selLeg === leg ? LEG_META[leg].pillFg : undefined,
                  }}
                  onClick={() => setSelLeg(leg)}
                >
                  {leg === 'in' ? 'India · ₹10,000' : 'USA · $1,000'}
                </button>
              ))}
            </span>
          </div>

          <div className="stat-grid" style={{ marginBottom: 12 }}>
            <div className="stat-card">
              <div className="stat-label">Day P&L</div>
              <div className={cls(selCard.dayPnl)}>{money[selLeg](selCard.dayPnl)}</div>
              <div className="stat-sub">{selCard.dayPnlPct >= 0 ? '+' : ''}{selCard.dayPnlPct}% of fresh capital</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Round trips</div>
              <div className="mono">{stats.sells.length}</div>
              <div className="stat-sub">{selCard.wins} won · {selCard.losses} lost</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Best trade</div>
              <div className={cls(stats.best?.pnl ?? null)}>
                {stats.best ? `${money[selLeg](stats.best.pnl)} · ${stats.best.symbol}` : '—'}
              </div>
              <div className="stat-sub">{stats.best ? STRAT_LABELS.get(stats.best.strategy) ?? stats.best.strategy : 'no exits'}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Worst trade</div>
              <div className={cls(stats.worst?.pnl ?? null)}>
                {stats.worst ? `${money[selLeg](stats.worst.pnl)} · ${stats.worst.symbol}` : '—'}
              </div>
              <div className="stat-sub">{stats.worst ? EXIT_CHIP[stats.worst.exitClass].label : 'no exits'}</div>
            </div>
          </div>

          {selCard.trades.length ? (
            <div style={{ overflowX: 'auto' }}>
              <div className="table paper-ledger" style={{ minWidth: 980 }}>
                <div className="tr head">
                  <span>Time</span><span>Method</span><span>Symbol</span><span>Side</span>
                  <span>Qty</span><span>Price</span><span>P&L</span><span>Exit</span><span>Technical reason</span>
                </div>
                {selCard.trades.map((t, i) => {
                  const chip = EXIT_CHIP[t.exitClass];
                  return (
                    <div key={i} className="tr">
                      <span className="mono muted">{t.time}</span>
                      <span className="muted">{STRAT_LABELS.get(t.strategy) ?? t.strategy}</span>
                      <span className="mono" style={{ fontWeight: 700 }}>{t.symbol}</span>
                      <span className={t.side === 'BUY' ? 'up' : 'down'} style={{ fontWeight: 700 }}>{t.side}</span>
                      <span className="mono">{t.qty}</span>
                      <span className="mono">{money[selLeg](t.price, 2)}</span>
                      <span className={cls(t.side === 'SELL' ? t.pnl : null)} style={{ fontWeight: 600 }}>
                        {t.side === 'SELL'
                          ? `${money[selLeg](t.pnl)}${t.retPct != null ? ` (${t.retPct >= 0 ? '+' : ''}${t.retPct}%)` : ''}`
                          : '—'}
                      </span>
                      <span>
                        <span style={{ fontSize: 10.5, fontWeight: 700, color: chip.color, background: chip.bg, borderRadius: 4, padding: '2px 7px', whiteSpace: 'nowrap' }}>
                          {chip.label}
                        </span>
                      </span>
                      <span style={{ fontSize: 12, lineHeight: 1.5, whiteSpace: 'normal', textAlign: 'left' }}>
                        <div>{t.reason}</div>
                        <div className="mono muted" style={{ fontSize: 11, marginTop: 3 }}>{t.tech}</div>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="empty">No trades this session — no method fired a signal.</div>
          )}
        </div>
      )}

      <div className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
        Generated {new Date(store.ts).toLocaleString('en-IN')} · 5-min bars via Yahoo Finance · intraday only, squared off daily
      </div>
    </div>
  );
}
