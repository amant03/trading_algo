// Daily Paper trade — deterministic intraday paper trading, fresh every day.
//
// This is a LONG-ONLY intraday paper trader:
//   * every IST trading day starts with a FRESH ₹1,00,000 of virtual money,
//   * trades ONLY the five long-method algorithms (ma_cross, rsi_reversal,
//     macd_cross, bb_breakout, supertrend) on TODAY's real 5-minute NSE bars,
//     replayed as they close during market hours,
//   * ALL positions are squared off at the last bar of the session — pure
//     intraday, nothing ever held overnight,
//   * has NO database dependency: bars come straight from Yahoo intraday
//     (interval=5m, range=1d).
//
// Trade lifecycle:
//   1. BUY on a bullish signal (golden cross, RSI rebound, MACD bull cross, etc.)
//   2. HOLD while the trade works — track trailing stop
//   3. SELL on: bearish signal exit / hard stop loss / trailing stop / EOD square-off
//
// Every trade (entry + exit) is logged separately with full reason and timing.
//
// Risk management (per intraday position):
//   * HARD STOP: 1.2% below the fill price
//   * TRAILING STOP: 2% below the best bar high since entry
//   * EOD SQUARE-OFF: everything still open at the session's last bar is sold
//
// Reruns are idempotent: each run replays today's closed bars from the day's open.
//
// Writes: frontend/public/paper/daily.json  (today + recent-day archive)

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { sma, rsi, macd, bollinger, supertrend } from '@trading/shared';
import { INSTRUMENTS as SEED } from '../../services/shared/src/instruments-data.js';

const INITIAL_CAPITAL = 100_000; // ₹1,00,000 fresh every IST trading day
const ALLOC = INITIAL_CAPITAL / 5; // ₹20,000 per strategy bucket
const SLIPPAGE = 0.0005;
const SL_PCT = 0.012; // intraday hard stop: 1.2% below the fill
const TRAIL_STOP_PCT = 0.02; // intraday trailing stop: 2% below best high
const POOL_SIZE = 8;
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

const FILE = join(process.cwd(), 'frontend', 'public', 'paper', 'daily.json');

const fmtInr = (n: number): string => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

// ---- types ------------------------------------------------------------------

interface Bar {
  ts: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

interface Pos {
  symbol: string;
  qty: number;
  entryPrice: number;
  entryTime: string; // IST HH:MM
  entryReason: string;
  highSince: number;
}

type ExitClass = 'eod' | 'signal-exit' | 'stop-loss' | 'trail-stop';

interface Trade {
  time: string; // HH:MM (IST)
  strategy: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  qty: number;
  price: number;
  pnl: number; // realised P&L (0 for BUY, calculated for SELL)
  retPct: number | null; // return % (null for BUY, calculated for SELL)
  exitClass: ExitClass | 'entry';
  reason: string;
}

interface Bucket {
  cash: number;
  realized: number;
  wins: number;
  losses: number;
  entries: number;
  exits: number;
}

interface DayState {
  date: string; // YYYY-MM-DD (IST)
  startCapital: number;
  capital: number;
  equity: number;
  realizedPnl: number;
  dayPnl: number;
  wins: number;
  losses: number;
  trades: Trade[];
  open: { strategy: string; symbol: string; qty: number; entryPrice: number; lastPrice: number; entryTime: string; entryReason: string }[];
  status: 'pre-open' | 'open' | 'closed' | 'holiday';
  bars: number;
  updatedAt: string;
}

interface Store {
  ts: string;
  today: DayState | null;
  days: { date: string; capital: number; equity: number; realizedPnl: number; dayPnl: number; wins: number; trades: number }[];
}

const dayOf = (ts: number): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(ts))
    .replace(/\//g, '-');

const timeOf = (ts: number): string =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false })
    .format(new Date(ts));

function loadStore(): Store {
  const fresh: Store = { ts: new Date().toISOString(), today: null, days: [] };
  if (!existsSync(FILE)) return fresh;
  try {
    const raw = JSON.parse(readFileSync(FILE, 'utf8')) as Store;
    if (!raw || typeof raw !== 'object' || !('days' in raw)) return fresh;
    return raw;
  } catch {
    return fresh;
  }
}

async function intradayBars(symbol: string): Promise<{ bars: Bar[]; live: number | null } | null> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}.NS?interval=5m&range=1d`,
      { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12_000) },
    );
    if (!res.ok) return null;
    const j = (await res.json()) as {
      chart?: {
        result?: Array<{
          meta?: { regularMarketPrice?: number };
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
    const live = r?.meta?.regularMarketPrice;
    return { bars, live: typeof live === 'number' && live > 0 && isFinite(live) ? live : null };
  } catch {
    return null;
  }
}

// ---- strategy signals (intraday bars) --------------------------------------

function signalFor(strategy: string, bars: Bar[]): { dir: 'BUY' | 'SELL'; why: string } | null {
  if (bars.length < 30) return null;
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
      if (pF <= pS && cF > cS) return { dir: 'BUY', why: `Golden cross: SMA${fast} crossed above SMA${slow}` };
      if (pF >= pS && cF < cS) return { dir: 'SELL', why: `Death cross: SMA${fast} crossed below SMA${slow}` };
      return null;
    }
    case 'rsi_reversal': {
      const { period, oversold, overbought } = STRAT_META.get('rsi_reversal')!;
      const r = rsi(c, period);
      const p = r[r.length - 2];
      const x = r[r.length - 1];
      if (Number.isNaN(p) || Number.isNaN(x)) return null;
      if (p <= oversold && x > oversold) return { dir: 'BUY', why: `RSI(${period}) ${x.toFixed(1)} rebounded out of oversold` };
      if (p >= overbought && x < overbought) return { dir: 'SELL', why: `RSI(${period}) ${x.toFixed(1)} fell out of overbought` };
      return null;
    }
    case 'macd_cross': {
      const { fast, slow, signal } = STRAT_META.get('macd_cross')!;
      const line = macd(c, fast, slow, signal).map((m) => m.histogram);
      const p = line[line.length - 2];
      const x = line[line.length - 1];
      if (Number.isNaN(p) || Number.isNaN(x)) return null;
      if (p <= 0 && x > 0) return { dir: 'BUY', why: 'MACD histogram turned positive (bullish cross)' };
      if (p >= 0 && x < 0) return { dir: 'SELL', why: 'MACD histogram turned negative (bearish cross)' };
      return null;
    }
    case 'bb_breakout': {
      const { period, mult } = STRAT_META.get('bb_breakout')!;
      const bb = bollinger(c, period, mult);
      const pB = bb[bb.length - 2];
      const cB = bb[bb.length - 1];
      if (Number.isNaN(pB.upper) || Number.isNaN(cB.upper)) return null;
      if (prev <= pB.upper && last > cB.upper) return { dir: 'BUY', why: `Broke above upper Bollinger band (${mult}x std dev)` };
      if (prev >= pB.lower && last < cB.lower) return { dir: 'SELL', why: `Broke below lower Bollinger band (${mult}x std dev)` };
      return null;
    }
    case 'supertrend': {
      const { period, mult } = STRAT_META.get('supertrend')!;
      const ohlc = bars.map((b) => ({ high: b.h, low: b.l, close: b.c }));
      const st = supertrend(ohlc, period, mult);
      const p = st[st.length - 2];
      const x = st[st.length - 1];
      if (Number.isNaN(p.line) || Number.isNaN(x.line)) return null;
      if (p.direction === 'down' && x.direction === 'up') return { dir: 'BUY', why: 'SuperTrend flipped UP (trend reversal bullish)' };
      if (p.direction === 'up' && x.direction === 'down') return { dir: 'SELL', why: 'SuperTrend flipped DOWN (trend reversal bearish)' };
      return null;
    }
    default:
      return null;
  }
}

// ---- single-day intraday replay --------------------------------------------

function replayDay(date: string, universe: Map<string, Bar[]>, liveBy: Map<string, number | null>, dayComplete: boolean): DayState {
  const buckets: Record<string, Bucket> = Object.fromEntries(
    STRATEGIES.map((s) => [s.id, { cash: ALLOC, realized: 0, wins: 0, losses: 0, entries: 0, exits: 0 }]),
  );
  const positions = new Map<string, Pos>(); // strategy -> position
  const trades: Trade[] = [];
  let cash = INITIAL_CAPITAL;

  const logTrade = (
    strat: string,
    symbol: string,
    side: 'BUY' | 'SELL',
    qty: number,
    price: number,
    pnl: number,
    retPct: number | null,
    exitClass: ExitClass | 'entry',
    reason: string,
    time: string,
  ) => {
    trades.push({
      time,
      strategy: strat,
      symbol,
      side,
      qty,
      price: Math.round(price * 100) / 100,
      pnl: Math.round(pnl * 100) / 100,
      retPct: retPct != null ? Math.round(retPct * 10) / 10 : null,
      exitClass,
      reason,
    });
  };

  const closePosition = (
    strat: string,
    pos: Pos,
    exitPrice: number,
    exitClass: ExitClass,
    reason: string,
    time: string,
  ) => {
    const b = buckets[strat];
    const proceeds = pos.qty * exitPrice * (1 - SLIPPAGE);
    const costBasis = pos.qty * pos.entryPrice;
    const pnl = proceeds - costBasis;
    const retPct = ((exitPrice / pos.entryPrice - 1) * 100);

    cash += proceeds;
    b.cash += proceeds;
    b.realized += pnl;
    b.exits += 1;
    if (pnl >= 0) b.wins += 1;
    else b.losses += 1;

    logTrade(strat, pos.symbol, 'SELL', pos.qty, exitPrice, pnl, retPct, exitClass, reason, time);
    positions.delete(strat);
  };

  // Build per-symbol day bars
  const dayBars = new Map<string, Bar[]>();
  for (const [sym, bars] of universe) {
    const todays = bars.filter((b) => dayOf(b.ts) === date);
    if (todays.length) dayBars.set(sym, todays);
  }

  const maxBars = Math.max(...[...dayBars.values()].map((b) => b.length), 0);

  // Replay each bar
  for (let i = 0; i < maxBars; i++) {
    for (const strat of STRATEGIES) {
      const pos = positions.get(strat.id);

      if (pos) {
        // ---- POSITION OPEN: check exits ----
        const symBars = dayBars.get(pos.symbol);
        const bar = symBars?.[i];
        if (!bar) continue;

        pos.highSince = Math.max(pos.highSince, bar.h);
        const entryStop = pos.entryPrice * (1 - SL_PCT);
        const trailStop = pos.highSince * (1 - TRAIL_STOP_PCT);
        const sig = symBars ? signalFor(strat.id, symBars.slice(0, i + 1)) : null;

        let exitPrice: number | null = null;
        let exitClass: ExitClass = 'eod';
        let reason = '';

        if (bar.l <= entryStop) {
          exitPrice = entryStop;
          exitClass = 'stop-loss';
          reason = `Hard stop: price hit ${fmtInr(entryStop)} (≤${SL_PCT * 100}% below entry ${fmtInr(pos.entryPrice)})`;
        } else if (bar.l <= trailStop) {
          exitPrice = Math.max(entryStop, trailStop);
          exitClass = 'trail-stop';
          reason = `Trailing stop: price hit ${fmtInr(trailStop)} (≤${TRAIL_STOP_PCT * 100}% off high ${fmtInr(pos.highSince)})`;
        } else if (sig?.dir === 'SELL') {
          exitPrice = bar.c;
          exitClass = 'signal-exit';
          reason = `Bearish exit signal — ${sig.why}`;
        } else if (dayComplete && i === symBars!.length - 1) {
          exitPrice = bar.c;
          exitClass = 'eod';
          reason = 'EOD square-off: intraday only, no overnight holding';
        }

        if (exitPrice != null && exitPrice > 0) {
          closePosition(strat.id, pos, exitPrice, exitClass, reason, timeOf(bar.ts));
        }
      } else {
        // ---- NO POSITION: look for entry ----
        if (buckets[strat.id].cash < 100) continue;

        let best: { symbol: string; price: number; why: string; barTs: number } | null = null;
        for (const [sym, bars] of dayBars) {
          if (i >= bars.length) continue;
          const bar = bars[i];
          const sig = signalFor(strat.id, bars.slice(0, i + 1));
          if (sig?.dir === 'BUY') {
            // Prefer the highest-priced stock (more liquid / stronger momentum)
            if (!best || bar.c > best.price) best = { symbol: sym, price: bar.c, why: sig.why, barTs: bar.ts };
          }
        }

        if (best && best.price > 10 && buckets[strat.id].cash >= best.price) {
          const price = best.price * (1 + SLIPPAGE); // buy with slippage
          const qty = Math.floor(buckets[strat.id].cash / price);
          if (qty >= 1) {
            const cost = qty * price;
            cash -= cost;
            const b = buckets[strat.id];
            b.cash -= cost;
            b.entries += 1;

            positions.set(strat.id, {
              symbol: best.symbol,
              qty,
              entryPrice: price,
              entryTime: timeOf(best.barTs),
              entryReason: best.why,
              highSince: price,
            });

            logTrade(strat.id, best.symbol, 'BUY', qty, price, 0, null, 'entry', `Entry: ${best.why}`, timeOf(best.barTs));
          }
        }
      }
    }
  }

  // ---- Post-replay: force-close any remaining positions (EOD discipline) ----
  for (const strat of STRATEGIES) {
    const pos = positions.get(strat.id);
    if (!pos) continue;
    const symBars = dayBars.get(pos.symbol);
    const lastBar = symBars?.[symBars.length - 1];
    const exitPrice = lastBar ? lastBar.c : pos.entryPrice;
    const reason = lastBar
      ? 'EOD square-off (post-replay finalise)'
      : 'EOD square-off (no further bar data)';
    const time = lastBar ? timeOf(lastBar.ts) : '15:30';
    closePosition(strat.id, pos, exitPrice, 'eod', reason, time);
  }

  // ---- Aggregate results ----
  const realized = Object.values(buckets).reduce((a, b) => a + b.realized, 0);
  const wins = Object.values(buckets).reduce((a, b) => a + b.wins, 0);
  const losses = Object.values(buckets).reduce((a, b) => a + b.losses, 0);
  const open: DayState['open'] = []; // should be empty after force-close

  const equity = cash + open.reduce((a, p) => a + p.qty * (liveBy.get(p.symbol) ?? p.entryPrice), 0);

  let status: DayState['status'];
  const nowIST = new Date(Date.now() - (330 - new Date().getTimezoneOffset() / 60 * 60) * 60_000);
  const nowHourMin = nowIST.getHours() * 60 + nowIST.getMinutes();
  if (dayComplete) status = 'closed';
  else if (dayBars.size === 0) status = nowHourMin >= 9 * 60 + 20 ? 'holiday' : 'pre-open';
  else status = 'open';

  return {
    date,
    startCapital: INITIAL_CAPITAL,
    capital: Math.round(cash * 100) / 100,
    equity: Math.round(equity * 100) / 100,
    realizedPnl: Math.round(realized * 100) / 100,
    dayPnl: Math.round((equity - INITIAL_CAPITAL) * 100) / 100,
    wins,
    losses,
    trades,
    open,
    status,
    bars: [...dayBars.values()].reduce((a, b) => a + b.length, 0),
    updatedAt: new Date().toISOString(),
  };
}

// ---- main -------------------------------------------------------------------

async function main(): Promise<void> {
  const todayIST = dayOf(Date.now());
  const store = loadStore();

  // Archive yesterday / any previous trading day once a NEW IST date shows up.
  const prev = store.today;
  if (prev && prev.date !== todayIST && (prev.trades.length > 0 || prev.status === 'closed')) {
    const winPct = prev.wins + prev.losses > 0 ? Math.round((prev.wins / (prev.wins + prev.losses)) * 100) : null;
    store.days.unshift({
      date: prev.date,
      capital: prev.capital,
      equity: prev.equity,
      realizedPnl: prev.realizedPnl,
      dayPnl: prev.dayPnl,
      wins: prev.wins,
      trades: prev.trades.length,
      ...(winPct != null ? ({ winPct } as Record<string, number | null>) : {}),
    });
    store.days = store.days.slice(0, 45);
  }

  // Universe: env override or the standard seed universe (all large caps).
  const symbols = (process.env.PAPER_DAILY_UNIVERSE ?? SEED.map((s) => s.symbol).join(','))
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  let cursor = 0;
  const fetched: { symbol: string; bars: Bar[]; live: number | null }[] = [];
  const worker = async () => {
    while (true) {
      const idx = cursor;
      cursor += 1;
      if (idx >= symbols.length) return;
      const symbol = symbols[idx];
      const data = await intradayBars(symbol);
      if (data) fetched.push({ symbol, bars: data.bars, live: data.live });
    }
  };
  await Promise.all(Array.from({ length: Math.min(POOL_SIZE, symbols.length) }, worker));

  const universe = new Map<string, Bar[]>();
  const liveBy = new Map<string, number | null>();
  for (const f of fetched) {
    universe.set(f.symbol, f.bars);
    liveBy.set(f.symbol, f.live);
  }

  const todayUTC = Date.UTC(
    Number(todayIST.slice(0, 4)),
    Number(todayIST.slice(5, 7)) - 1,
    Number(todayIST.slice(8, 10)),
  );
  const sessionEnd = todayUTC + (5 * 60 + 30) * 60_000; // 15:30 IST -> UTC
  const nowMs = Date.now();
  const lastBarEnd = Math.max(0, ...[...universe.values()].flatMap((b) => b[b.length - 1]?.ts ?? 0));
  const dayComplete = lastBarEnd >= sessionEnd || nowMs > sessionEnd + 10 * 60_000 || (lastBarEnd > 0 && dayOf(lastBarEnd) === todayIST && new Date(lastBarEnd).getUTCHours() >= 10);
  const hasTodayBars = [...universe.values()].some((b) => b.some((x) => dayOf(x.ts) === todayIST));

  if (!hasTodayBars && !dayComplete) {
    store.today = {
      date: todayIST,
      startCapital: INITIAL_CAPITAL,
      capital: INITIAL_CAPITAL,
      equity: INITIAL_CAPITAL,
      realizedPnl: 0,
      dayPnl: 0,
      wins: 0,
      losses: 0,
      trades: [],
      open: [],
      status: Date.now() < sessionEnd ? 'pre-open' : 'holiday',
      bars: 0,
      updatedAt: new Date().toISOString(),
    };
  } else {
    store.today = replayDay(todayIST, universe, liveBy, dayComplete);
  }

  store.ts = new Date().toISOString();
  mkdirSync(join(process.cwd(), 'frontend', 'public', 'paper'), { recursive: true });
  writeFileSync(FILE, JSON.stringify(store));

  const t = store.today;
  const pct = t.dayPnl >= 0 ? '+' : '';
  const buyCount = t.trades.filter((x) => x.side === 'BUY').length;
  const sellCount = t.trades.filter((x) => x.side === 'SELL').length;
  console.log(
    `paper-daily: ${t.date} ${t.status} · bars=${t.bars} · ` +
      `dayPnl ${pct}${fmtInr(t.dayPnl)} (${pct}${((t.dayPnl / t.startCapital) * 100).toFixed(2)}%) · ` +
      `${buyCount} buys, ${sellCount} sells · ${t.wins}W/${t.losses}L · archive=${store.days.length} days`,
  );
}

main().catch((e) => {
  console.error('paper-daily failed:', e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
