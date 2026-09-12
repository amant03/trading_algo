// Weekly Duel — paper trading for BOTH markets, one fresh account per day.
//
// Two modes in one script (Yahoo Finance 5-min bars, free, no DB):
//   * BACKTEST (default): replays the last 5 sessions per market and writes
//     frontend/public/paper/week.json — historical replay, NOT live trading.
//   * LIVE (PAPER_WEEK_LIVE=1): replays only the most recent session keeping
//     positions open past the last fetched bar, and writes
//     frontend/public/paper/live.json — today's live paper account.
//
// Every trading day starts with FRESH virtual money:
//   * India (NSE): ₹10,000  (₹2,000 per strategy bucket)
//   * USA (NYSE/NASDAQ): $1,000  ($200 per strategy bucket)
//
// LONG-ONLY intraday, same five methods as paper-daily.ts
// (ma_cross, rsi_reversal, macd_cross, bb_breakout, supertrend) replayed on
// real 5-minute bars (Yahoo Finance, free):
//   * India bars: `.NS` tickers, 09:15–15:30 Asia/Kolkata
//   * US bars: plain tickers, 09:30–16:00 America/New_York
//
// Risk management (per position) — exactly as requested:
//   * HARD STOP: 1% below the fill price
//   * TAKE PROFIT: none — winners run until a bearish signal or EOD square-off
//   * EOD SQUARE-OFF: everything closed at the session's last bar
//
// Every trade carries the ACTUAL technical reason (indicator values at the
// decision bar) plus a compact `tech` snapshot string, so the UI can show
// P&L first and reveal the full reasoning on demand.
//
// No database dependency. Idempotent: each run rebuilds the last 5 sessions
// per market from scratch.
//
// Writes: frontend/public/paper/week.json

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { sma, rsi, macd, bollinger, supertrend } from '@trading/shared';
import { INSTRUMENTS as SEED } from '../../services/shared/src/instruments-data.js';

// ---- market configs ---------------------------------------------------------

const US_SYMBOLS = (
  process.env.PAPER_WEEK_US_UNIVERSE ??
  'AAPL,MSFT,NVDA,AMZN,GOOGL,META,TSLA,AVGO,BRK-B,JPM,V,XOM,UNH,MA,NFLX,COST,ORCL,AMD,PLTR,CRM,BAC,WMT,DIS,KO,QCOM,ADBE,INTC,CAT,GE,IBM'
)
  .split(',')
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);

const IN_SYMBOLS = (process.env.PAPER_WEEK_IN_UNIVERSE ?? SEED.map((s) => s.symbol).join(','))
  .split(',')
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);

interface MarketCfg {
  key: 'in' | 'us';
  label: string;
  tz: string;
  suffix: string; // Yahoo ticker suffix
  symbols: string[];
  capital: number;
  currency: string;
  locale: string;
  session: [number, number]; // [openMin, closeMin] in market-local HH*60+MM
  minPrice: number;
}

const MARKETS: MarketCfg[] = [
  {
    key: 'in',
    label: 'India',
    tz: 'Asia/Kolkata',
    suffix: '.NS',
    symbols: IN_SYMBOLS,
    capital: Number(process.env.PAPER_WEEK_IN_CAPITAL ?? 10_000),
    currency: '₹',
    locale: 'en-IN',
    session: [9 * 60 + 15, 15 * 60 + 30],
    minPrice: 10,
  },
  {
    key: 'us',
    label: 'USA',
    tz: 'America/New_York',
    suffix: '',
    symbols: US_SYMBOLS,
    capital: Number(process.env.PAPER_WEEK_US_CAPITAL ?? 1_000),
    currency: '$',
    locale: 'en-US',
    session: [9 * 60 + 30, 16 * 60],
    minPrice: 1,
  },
];

const SL_PCT = 0.01; // 1% hard stop — the ONLY exit besides signal/EOD
const SLIPPAGE = 0.0005;
const POOL_SIZE = 8;
const WARMUP_BARS = 90;
const MIN_BARS_FOR_SIGNALS = 30;
const DAYS_PER_WEEK = 5;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

const STRATEGIES = [
  { id: 'ma_cross', label: 'MA Cross', fast: 9, slow: 21 },
  { id: 'rsi_reversal', label: 'RSI Reversal', period: 14, oversold: 30, overbought: 70 },
  { id: 'macd_cross', label: 'MACD Cross', fast: 12, slow: 26, signal: 9 },
  { id: 'bb_breakout', label: 'Bollinger Breakout', period: 20, mult: 2 },
  { id: 'supertrend', label: 'Supertrend', period: 10, mult: 3 },
];
const STRAT_META = new Map(STRATEGIES.map((s) => [s.id, s]));

const FILE = join(process.cwd(), 'frontend', 'public', 'paper', 'week.json');
const LIVE_FILE = join(process.cwd(), 'frontend', 'public', 'paper', 'live.json');
const LIVE_MODE = process.env.PAPER_WEEK_LIVE === '1';

// ---- types ------------------------------------------------------------------

interface Bar {
  ts: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

interface Trade {
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
  tech: string; // compact indicator snapshot at the decision bar
}

interface DayCard {
  date: string; // YYYY-MM-DD in market tz
  weekday: string; // Mon..Fri
  startCapital: number;
  capital: number;
  equity: number;
  realizedPnl: number;
  dayPnl: number;
  dayPnlPct: number;
  wins: number;
  losses: number;
  trades: Trade[];
  status: 'open' | 'closed' | 'holiday';
  bars: number;
  // Live-only fields (populated when keepOpen is set): positions still held,
  // marked to the latest fetched bar, plus the unrealised slice of dayPnl.
  unrealizedPnl: number;
  openPositions: OpenPos[];
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

// Live account snapshot: today's card per market with open positions exposed
// as `open` for the UI contract.
interface LiveStore {
  ts: string;
  in: (Omit<DayCard, 'openPositions'> & { open: OpenPos[] }) | null;
  us: (Omit<DayCard, 'openPositions'> & { open: OpenPos[] }) | null;
}

// ---- tz helpers --------------------------------------------------------------

const partsOf = (ts: number, tz: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .formatToParts(new Date(ts))
    .reduce<Record<string, string>>((a, p) => {
      a[p.type] = p.value;
      return a;
    }, {});

const dayOf = (ts: number, tz: string): string => {
  const p = partsOf(ts, tz);
  return `${p.year}-${p.month}-${p.day}`;
};

const timeOf = (ts: number, tz: string): string => {
  const p = partsOf(ts, tz);
  return `${p.hour}:${p.minute}`;
};

const weekdayOf = (ts: number, tz: string): string => partsOf(ts, tz).weekday;

const minutesOf = (ts: number, tz: string): number => {
  const p = partsOf(ts, tz);
  return Number(p.hour) * 60 + Number(p.minute);
};

// ---- data fetch ---------------------------------------------------------------

async function fetchBars(ticker: string): Promise<Bar[] | null> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=5m&range=5d`,
      { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15_000) },
    );
    if (!res.ok) return null;
    const j = (await res.json()) as {
      chart?: {
        result?: Array<{
          timestamp?: number[];
          indicators?: { quote?: Array<{ open?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[]; close?: (number | null)[]; volume?: (number | null)[] }> };
        }>;
      };
    };
    const r = j.chart?.result?.[0];
    const ts = r?.timestamp ?? [];
    const q = r?.indicators?.quote?.[0];
    const bars: Bar[] = [];
    for (let i = 0; i < ts.length; i += 1) {
      const o = q?.open?.[i];
      const h = q?.high?.[i];
      const l = q?.low?.[i];
      const c = q?.close?.[i];
      const v = q?.volume?.[i];
      if (typeof o !== 'number' || typeof h !== 'number' || typeof l !== 'number' || typeof c !== 'number') continue;
      if (!isFinite(o) || !isFinite(h) || !isFinite(l) || !isFinite(c)) continue;
      if (o <= 0 || h <= 0 || l <= 0 || c <= 0) continue;
      bars.push({ ts: ts[i] * 1000, o, h, l, c, v: typeof v === 'number' ? v : 0 });
    }
    return bars.length ? bars : null;
  } catch {
    return null;
  }
}

// ---- strategy signals with real numbers ---------------------------------------

function signalFor(strategy: string, bars: Bar[]): { dir: 'BUY' | 'SELL'; why: string } | null {
  if (bars.length < MIN_BARS_FOR_SIGNALS) return null;
  const c = bars.map((b) => b.c);
  const last = c[c.length - 1];
  const prev = c[c.length - 2];

  switch (strategy) {
    case 'ma_cross': {
      const { fast, slow } = STRAT_META.get('ma_cross')!;
      const f = sma(c, fast);
      const s = sma(c, slow);
      const pF = f[f.length - 2];
      const pS = s[s.length - 2];
      const cF = f[f.length - 1];
      const cS = s[s.length - 1];
      if (Number.isNaN(pF) || Number.isNaN(pS) || Number.isNaN(cF) || Number.isNaN(cS)) return null;
      if (pF <= pS && cF > cS)
        return { dir: 'BUY', why: `Golden cross: SMA${fast} ${cF.toFixed(2)} crossed above SMA${slow} ${cS.toFixed(2)} (was ${pF.toFixed(2)} vs ${pS.toFixed(2)})` };
      if (pF >= pS && cF < cS)
        return { dir: 'SELL', why: `Death cross: SMA${fast} ${cF.toFixed(2)} crossed below SMA${slow} ${cS.toFixed(2)} (was ${pF.toFixed(2)} vs ${pS.toFixed(2)})` };
      return null;
    }
    case 'rsi_reversal': {
      const { period, oversold, overbought } = STRAT_META.get('rsi_reversal')!;
      const r = rsi(c, period);
      const p = r[r.length - 2];
      const x = r[r.length - 1];
      if (Number.isNaN(p) || Number.isNaN(x)) return null;
      if (p <= oversold && x > oversold)
        return { dir: 'BUY', why: `RSI(${period}) rebounded to ${x.toFixed(1)} out of oversold (prev ${p.toFixed(1)} ≤ ${oversold})` };
      if (p >= overbought && x < overbought)
        return { dir: 'SELL', why: `RSI(${period}) fell to ${x.toFixed(1)} out of overbought (prev ${p.toFixed(1)} ≥ ${overbought})` };
      return null;
    }
    case 'macd_cross': {
      const { fast, slow, signal } = STRAT_META.get('macd_cross')!;
      const line = macd(c, fast, slow, signal).map((m) => m.histogram);
      const p = line[line.length - 2];
      const x = line[line.length - 1];
      if (Number.isNaN(p) || Number.isNaN(x)) return null;
      if (p <= 0 && x > 0) return { dir: 'BUY', why: `MACD histogram turned positive ${x.toFixed(3)} (prev ${p.toFixed(3)}) — bullish momentum cross` };
      if (p >= 0 && x < 0) return { dir: 'SELL', why: `MACD histogram turned negative ${x.toFixed(3)} (prev ${p.toFixed(3)}) — bearish momentum cross` };
      return null;
    }
    case 'bb_breakout': {
      const { period, mult } = STRAT_META.get('bb_breakout')!;
      const bb = bollinger(c, period, mult);
      const pB = bb[bb.length - 2];
      const cB = bb[bb.length - 1];
      if (Number.isNaN(pB.upper) || Number.isNaN(cB.upper)) return null;
      if (prev <= pB.upper && last > cB.upper)
        return { dir: 'BUY', why: `Close ${last.toFixed(2)} broke above upper Bollinger band ${cB.upper.toFixed(2)} (${mult}σ, basis ${cB.middle.toFixed(2)})` };
      if (prev >= pB.lower && last < cB.lower)
        return { dir: 'SELL', why: `Close ${last.toFixed(2)} broke below lower Bollinger band ${cB.lower.toFixed(2)} (${mult}σ, basis ${cB.middle.toFixed(2)})` };
      return null;
    }
    case 'supertrend': {
      const { period, mult } = STRAT_META.get('supertrend')!;
      const ohlc = bars.map((b) => ({ high: b.h, low: b.l, close: b.c }));
      const st = supertrend(ohlc, period, mult);
      const p = st[st.length - 2];
      const x = st[st.length - 1];
      if (Number.isNaN(p.line) || Number.isNaN(x.line)) return null;
      if (p.direction === 'down' && x.direction === 'up')
        return { dir: 'BUY', why: `SuperTrend(${period},${mult}) flipped UP — line ${x.line.toFixed(2)} now below price ${last.toFixed(2)}` };
      if (p.direction === 'up' && x.direction === 'down')
        return { dir: 'SELL', why: `SuperTrend(${period},${mult}) flipped DOWN — line ${x.line.toFixed(2)} now above price ${last.toFixed(2)}` };
      return null;
    }
    default:
      return null;
  }
}

/** Compact indicator snapshot at a decision bar — the "actual technicals". */
function techSnapshot(bars: Bar[]): string {
  if (bars.length < MIN_BARS_FOR_SIGNALS) return 'warmup — not enough bars';
  const c = bars.map((b) => b.c);
  const last = c[c.length - 1];
  const r = rsi(c, 14);
  const f9 = sma(c, 9);
  const s21 = sma(c, 21);
  const h = macd(c, 12, 26, 9).map((m) => m.histogram);
  const bb = bollinger(c, 20, 2);
  const st = supertrend(
    bars.map((b) => ({ high: b.h, low: b.l, close: b.c })),
    10,
    3,
  );
  const f = (v: number, d = 2): string => (Number.isNaN(v) ? 'n/a' : v.toFixed(d));
  const b = bb[bb.length - 1];
  const s = st[st.length - 1];
  return (
    `px ${f(last)} · RSI14 ${f(r[r.length - 1], 1)} · SMA9 ${f(f9[f9.length - 1])} · ` +
    `SMA21 ${f(s21[s21.length - 1])} · MACDhist ${f(h[h.length - 1], 3)} · ` +
    `BB20 [${f(b.lower)} / ${f(b.middle)} / ${f(b.upper)}] · ST ${s.direction.toUpperCase()} ${f(s.line)}`
  );
}

// ---- single-day replay ----------------------------------------------------------

interface Pos {
  symbol: string;
  qty: number;
  entryPrice: number;
  entryTime: string;
  entryReason: string;
}

interface OpenPos {
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

function replayDay(
  m: MarketCfg,
  date: string,
  series: Map<string, Bar[]>, // symbol -> full 5d series (for warmup)
  keepOpen = false, // live mode: hold positions past the last fetched bar
): DayCard {
  const alloc = m.capital / STRATEGIES.length;
  const buckets: Record<string, { cash: number; realized: number; wins: number; losses: number }> = Object.fromEntries(
    STRATEGIES.map((s) => [s.id, { cash: alloc, realized: 0, wins: 0, losses: 0 }]),
  );
  const positions = new Map<string, Pos>();
  const trades: Trade[] = [];
  let cash = m.capital;

  // Per-symbol: warmup bars (older sessions) + today's session bars.
  const warm = new Map<string, Bar[]>();
  const today = new Map<string, Bar[]>();
  for (const [sym, bars] of series) {
    const idx = bars.findIndex((b) => dayOf(b.ts, m.tz) === date);
    const todays = bars.filter((b) => dayOf(b.ts, m.tz) === date);
    if (!todays.length) continue;
    const before = idx > 0 ? bars.slice(Math.max(0, idx - WARMUP_BARS), idx) : [];
    warm.set(sym, before);
    today.set(sym, todays);
  }

  const maxBars = Math.max(...[...today.values()].map((b) => b.length), 0);
  const withWarm = (sym: string, i: number): Bar[] => [...(warm.get(sym) ?? []), ...today.get(sym)!.slice(0, i + 1)];

  // Live session? Only then may positions survive past the last fetched bar.
  // A finished session (or any backtest day) always squares off at the close.
  const sessionLive =
    keepOpen && dayOf(Date.now(), m.tz) === date && minutesOf(Date.now(), m.tz) < m.session[1];

  const r2 = (n: number): number => Math.round(n * 100) / 100;

  const logTrade = (t: Omit<Trade, 'price' | 'pnl'> & { price: number; pnl: number }) => {
    trades.push({ ...t, price: r2(t.price), pnl: r2(t.pnl), retPct: t.retPct != null ? Math.round(t.retPct * 10) / 10 : null });
  };

  const closePosition = (strat: string, pos: Pos, exitPrice: number, exitClass: Trade['exitClass'], reason: string, tech: string, time: string) => {
    const b = buckets[strat];
    const proceeds = pos.qty * exitPrice * (1 - SLIPPAGE);
    const pnl = proceeds - pos.qty * pos.entryPrice;
    cash += proceeds;
    b.cash += proceeds;
    b.realized += pnl;
    if (pnl >= 0) b.wins += 1;
    else b.losses += 1;
    logTrade({
      time, strategy: strat, symbol: pos.symbol, side: 'SELL', qty: pos.qty,
      price: exitPrice, pnl, retPct: (exitPrice / pos.entryPrice - 1) * 100,
      exitClass, reason, tech,
    });
    positions.delete(strat);
  };

  for (let i = 0; i < maxBars; i++) {
    for (const strat of STRATEGIES) {
      const pos = positions.get(strat.id);
      if (pos) {
        const symBars = today.get(pos.symbol);
        const bar = symBars?.[i];
        if (!bar) continue;
        const full = withWarm(pos.symbol, i);
        const entryStop = pos.entryPrice * (1 - SL_PCT);
        const sig = signalFor(strat.id, full);

        let exitPrice: number | null = null;
        let exitClass: Trade['exitClass'] = 'eod';
        let reason = '';
        if (bar.l <= entryStop) {
          exitPrice = entryStop;
          exitClass = 'stop-loss';
          reason = `STOP-LOSS 1%: bar low ${bar.l.toFixed(2)} pierced stop ${entryStop.toFixed(2)} (entry ${pos.entryPrice.toFixed(2)})`;
        } else if (sig?.dir === 'SELL') {
          exitPrice = bar.c;
          exitClass = 'signal-exit';
          reason = `Bearish exit — ${sig.why}`;
        } else if (!sessionLive && i === symBars!.length - 1) {
          exitPrice = bar.c;
          exitClass = 'eod';
          reason = 'EOD square-off: intraday only, no overnight holding';
        }
        if (exitPrice != null && exitPrice > 0) {
          closePosition(strat.id, pos, exitPrice, exitClass, reason, techSnapshot(full), timeOf(bar.ts, m.tz));
        }
      } else {
        if (buckets[strat.id].cash < m.minPrice) continue;
        let best: { symbol: string; price: number; why: string; tech: string; barTs: number } | null = null;
        for (const [sym, bars] of today) {
          if (i >= bars.length) continue;
          const bar = bars[i];
          const full = withWarm(sym, i);
          const sig = signalFor(strat.id, full);
          if (sig?.dir === 'BUY' && (!best || bar.c > best.price)) {
            best = { symbol: sym, price: bar.c, why: sig.why, tech: techSnapshot(full), barTs: bar.ts };
          }
        }
        if (best && best.price >= m.minPrice && buckets[strat.id].cash >= best.price) {
          const price = best.price * (1 + SLIPPAGE);
          const qty = Math.floor(buckets[strat.id].cash / price);
          if (qty >= 1) {
            const cost = qty * price;
            cash -= cost;
            buckets[strat.id].cash -= cost;
            positions.set(strat.id, { symbol: best.symbol, qty, entryPrice: price, entryTime: timeOf(best.barTs, m.tz), entryReason: best.why });
            logTrade({
              time: timeOf(best.barTs, m.tz), strategy: strat.id, symbol: best.symbol, side: 'BUY',
              qty, price, pnl: 0, retPct: null, exitClass: 'entry', reason: `Entry: ${best.why}`, tech: best.tech,
            });
          }
        }
      }
    }
  }

  // Force-close leftovers at the last bar (EOD discipline) — skipped while a
  // live session is still trading so positions stay open.
  for (const strat of STRATEGIES) {
    const pos = positions.get(strat.id);
    if (!pos) continue;
    const symBars = today.get(pos.symbol);
    const lastBar = symBars?.[symBars.length - 1];
    const full = symBars ? [...(warm.get(pos.symbol) ?? []), ...symBars] : [];
    const exitPrice = lastBar ? lastBar.c : pos.entryPrice;
    // In live mode a still-trading session keeps the position; a finished
    // session (or backtest) always squares off.
    if (sessionLive) {
      continue;
    }
    closePosition(
      strat.id, pos, exitPrice, 'eod',
      lastBar ? 'EOD square-off (post-replay finalise)' : 'EOD square-off (no further bar data)',
      techSnapshot(full), lastBar ? timeOf(lastBar.ts, m.tz) : '--:--',
    );
  }

  const realized = Object.values(buckets).reduce((a, b) => a + b.realized, 0);
  const wins = Object.values(buckets).reduce((a, b) => a + b.wins, 0);
  const losses = Object.values(buckets).reduce((a, b) => a + b.losses, 0);

  // Live mark-to-market on whatever is still held.
  const openPositions: OpenPos[] = [];
  for (const [strat, pos] of positions) {
    const symBars = today.get(pos.symbol);
    const lastBar = symBars?.[symBars.length - 1];
    const lastPrice = lastBar ? lastBar.c : pos.entryPrice;
    const unrealized = pos.qty * lastPrice * (1 - SLIPPAGE) - pos.qty * pos.entryPrice;
    openPositions.push({
      strategy: strat,
      symbol: pos.symbol,
      qty: pos.qty,
      entryPrice: r2(pos.entryPrice),
      lastPrice: r2(lastPrice),
      unrealized: r2(unrealized),
      unrealizedPct: r2((lastPrice / pos.entryPrice - 1) * 100),
      entryTime: pos.entryTime,
      entryReason: pos.entryReason,
    });
  }
  const mtm = openPositions.reduce((a, p) => a + p.qty * p.lastPrice * (1 - SLIPPAGE), 0);
  const equity = cash + mtm;
  const dayPnl = equity - m.capital;
  const unrealizedPnl = equity - m.capital - realized;

  // Newest-first ledger: descending by bar time, exits before entries on ties.
  trades.sort((a, b) => (b.time < a.time ? -1 : b.time > a.time ? 1 : a.side === b.side ? 0 : a.side === 'SELL' ? -1 : 1));
  const firstTs = [...today.values()].flatMap((b) => (b[0] ? [b[0].ts] : []))[0];

  // Is this session still live? Compare "now" in market tz against session close.
  const nowMin = minutesOf(Date.now(), m.tz);
  const todayLocal = dayOf(Date.now(), m.tz);
  const status: DayCard['status'] =
    today.size === 0 ? 'holiday' : date === todayLocal && nowMin < m.session[1] ? 'open' : 'closed';

  return {
    date,
    weekday: firstTs != null ? weekdayOf(firstTs, m.tz) : '',
    startCapital: m.capital,
    capital: r2(cash),
    equity: r2(equity),
    realizedPnl: r2(realized),
    dayPnl: r2(dayPnl),
    dayPnlPct: r2((dayPnl / m.capital) * 100),
    wins,
    losses,
    trades,
    status,
    bars: [...today.values()].reduce((a, b) => a + b.length, 0),
    unrealizedPnl: r2(unrealizedPnl),
    openPositions,
  };
}

// ---- main -----------------------------------------------------------------------

async function main(): Promise<void> {
  const store: WeekStore = {
    ts: new Date().toISOString(),
    config: {
      inCapital: MARKETS[0].capital,
      usCapital: MARKETS[1].capital,
      stopLossPct: SL_PCT,
      takeProfit: null,
      strategies: STRATEGIES.map((s) => s.id),
      note: 'Fresh account every day. 1% hard stop-loss, no take-profit (unlimited upside). EOD square-off.',
    },
    in: [],
    us: [],
  };
  const liveStore: LiveStore = { ts: '', in: null, us: null };

  for (const m of MARKETS) {
    let cursor = 0;
    const fetched: { symbol: string; bars: Bar[] }[] = [];
    const worker = async () => {
      while (true) {
        const idx = cursor;
        cursor += 1;
        if (idx >= m.symbols.length) return;
        const symbol = m.symbols[idx];
        const bars = await fetchBars(symbol + m.suffix);
        if (bars) {
          // Keep only regular-session bars for this market.
          const session = bars.filter((b) => {
            const hm = minutesOf(b.ts, m.tz);
            return hm >= m.session[0] && hm <= m.session[1];
          });
          if (session.length) fetched.push({ symbol, bars: session });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(POOL_SIZE, m.symbols.length) }, worker));

    const series = new Map(fetched.map((f) => [f.symbol, f.bars]));
    const dates = [...new Set([...series.values()].flatMap((b) => b.map((x) => dayOf(x.ts, m.tz))))]
      .sort()
      .filter((d) => {
        // A "session" needs a meaningful number of bars across the universe.
        let n = 0;
        for (const bars of series.values()) n += bars.filter((b) => dayOf(b.ts, m.tz) === d).length;
        return n >= 20;
      })
      .slice(-DAYS_PER_WEEK);

    const cards = dates.map((d) => replayDay(m, d, series));
    store[m.key] = cards;

    const tot = cards.reduce((a, c) => a + c.dayPnl, 0);
    const sym = m.currency;
    console.log(
      `paper-week [${m.key}]: ${fetched.length}/${m.symbols.length} symbols · ` +
        `sessions ${dates.join(', ') || 'none'} · week P&L ${tot >= 0 ? '+' : ''}${sym}${tot.toFixed(0)} · ` +
        `${cards.reduce((a, c) => a + c.trades.filter((t) => t.side === 'SELL').length, 0)} round trips`,
    );

    // Live mode: also replay the most recent session keeping positions open,
    // so the UI can show the current/live paper account for this market.
    if (LIVE_MODE && dates.length) {
      const liveDate = dates[dates.length - 1];
      const live = replayDay(m, liveDate, series, true);
      const { openPositions, ...rest } = live;
      liveStore[m.key] = { ...rest, open: openPositions };
      console.log(
        `paper-live [${m.key}]: ${liveDate} ${live.status} · dayPnl ${live.dayPnl >= 0 ? '+' : ''}${sym}${live.dayPnl.toFixed(2)} ` +
          `(${live.realizedPnl >= 0 ? '+' : ''}${sym}${live.realizedPnl.toFixed(2)} realised, ` +
          `${live.unrealizedPnl >= 0 ? '+' : ''}${sym}${live.unrealizedPnl.toFixed(2)} open) · ` +
          `${live.openPositions.length} open · ${live.trades.length} trades`,
      );
    }
  }

  mkdirSync(join(process.cwd(), 'frontend', 'public', 'paper'), { recursive: true });
  writeFileSync(FILE, JSON.stringify(store));
  console.log(`paper-week: wrote ${FILE}`);
  if (LIVE_MODE) {
    liveStore.ts = new Date().toISOString();
    writeFileSync(LIVE_FILE, JSON.stringify(liveStore));
    console.log(`paper-live: wrote ${LIVE_FILE}`);
  }
}

main().catch((e) => {
  console.error('paper-week failed:', e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
