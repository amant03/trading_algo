// Paper trading — deterministic daily simulator across 5 classic strategies.
//
// This is the account for the "test it every day for 10-15 days" experiment:
//   * starts with ₹1,00,000 (INR) of virtual money, split into 5 equal buckets,
//   * trades ONLY the five long-method algorithms (ma_cross, rsi_reversal,
//     macd_cross, bb_breakout, supertrend) on the REAL daily NSE candles held
//     in the DB (seeded live by market-data from Yahoo on every run),
//   * backfills the whole daily history on its first run to establish the
//     equity curve, then each nightly run advances it by exactly one more
//     trading day,
//   * persists its state to the automation-data branch (frontend/public/paper/)
//     so the account, positions and P&L SURVIVE the ephemeral CI database —
//     the deployed UI reads those files, no redeploy needed.
//
// Daily loop per strategy (1 decision bar = 1 trading day, executed at close):
//   * ENTRY   on the strategy's BUY signal for a symbol — deploy all the
//             bucket cash into that symbol (capital is meant to be used).
//   * EXIT    on the strategy's SELL signal for the same symbol, OR a trailing
//             stop 12% below the best close since entry, OR after 20 days.
//   * MTM     every day's equity = cash + positions marked at that day's close.
//
// Writes:
//   frontend/public/paper/state.json   — canonical running state (carry-forward)
//   frontend/public/paper/latest.json  — the dashboard view for the frontend

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { pool } from '@trading/shared';
import { sma, rsi, macd, bollinger, supertrend } from '@trading/shared';

const ACCOUNT_ID = 2;
const INITIAL_CAPITAL = 100_000; // ₹1,00,000 virtual INR
const ALLOC = INITIAL_CAPITAL / 5; // ₹20,000 per strategy
const SLIPPAGE = 0.0005;
const TRAIL_STOP_PCT = 0.12;
const MAX_HOLD_DAYS = 20;
const SEED_WINDOW_DAYS = 90; // backfill window when the account starts

const STRATEGIES = [
  { id: 'ma_cross', label: 'MA Cross', fast: 20, slow: 50 },
  { id: 'rsi_reversal', label: 'RSI Reversal', period: 14, oversold: 30, overbought: 70 },
  { id: 'macd_cross', label: 'MACD Cross', fast: 12, slow: 26, signal: 9 },
  { id: 'bb_breakout', label: 'Bollinger Breakout', period: 20, mult: 2 },
  { id: 'supertrend', label: 'Supertrend', period: 10, mult: 3 },
];
const STRAT_META = new Map(STRATEGIES.map((s) => [s.id, s]));

const STATE_FILE = join(process.cwd(), 'frontend', 'public', 'paper', 'state.json');
const LATEST_FILE = join(process.cwd(), 'frontend', 'public', 'paper', 'latest.json');

interface Bar {
  ts: number;
  date: string; // YYYY-MM-DD (IST)
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
  entryDate: string;
  highSince: number;
  heldDays: number;
}

interface Trade {
  day: string;
  strategy: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  qty: number;
  price: number;
  pnl: number; // 0 on buys
  reason: string;
}

interface Bucket {
  cash: number;
  realized: number;
  wins: number;
  losses: number;
  trades: number;
}

interface State {
  version: number;
  name: string;
  startedAt: string;
  initialCapital: number;
  allocation: number;
  cash: number;
  realizedPnl: number;
  buckets: Record<string, Bucket>;
  positions: Record<string, Pos>;
  trades: Trade[];
  history: { date: string; equity: number; cash: number; invested: number }[];
  lastDate: string;
}

const dayOf = (ts: number): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(ts))
    .replace(/\//g, '-');

function loadState(): State {
  const fresh: State = {
    version: 1,
    name: 'Paper Lab · ₹1,00,000',
    startedAt: new Date().toISOString(),
    initialCapital: INITIAL_CAPITAL,
    allocation: ALLOC,
    cash: INITIAL_CAPITAL,
    realizedPnl: 0,
    buckets: Object.fromEntries(STRATEGIES.map((s) => [s.id, { cash: ALLOC, realized: 0, wins: 0, losses: 0, trades: 0 }])),
    positions: {},
    trades: [],
    history: [],
    lastDate: '',
  };
  if (!existsSync(STATE_FILE)) return fresh;
  try {
    const raw = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as State;
    if (raw.version !== 1 || typeof raw.cash !== 'number') return fresh;
    return raw;
  } catch {
    return fresh;
  }
}

// ---- strategy signals (daily bars) ----------------------------------------

type Slice = { c: number[]; h: number[]; l: number[] };

function sliceBars(bars: Bar[]): Slice {
  return { c: bars.map((b) => b.c), h: bars.map((b) => b.h), l: bars.map((b) => b.l) };
}

const lastNum = (a: number[]): number | null => {
  const v = a[a.length - 1];
  return Number.isNaN(v) ? null : v;
};

function signalFor(strategy: string, bars: Bar[]): { dir: 'BUY' | 'SELL'; strength: number; why: string } | null {
  if (bars.length < 40) return null;
  const { c, h, l } = sliceBars(bars);
  const last = c[c.length - 1];
  const prev = c[c.length - 2];
  const movePct = ((last - prev) / prev) * 100;
  if (Number.isNaN(prev)) return null;
  const strength = Math.max(5, Math.min(99, Math.round(55 + Math.abs(movePct) * 12)));

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
      if (pF <= pS && cF > cS) return { dir: 'BUY', strength: strength + 4, why: `SMA${fast} golden cross SMA${slow}` };
      if (pF >= pS && cF < cS) return { dir: 'SELL', strength: strength + 4, why: `SMA${fast} death cross SMA${slow}` };
      return null;
    }
    case 'rsi_reversal': {
      const { period, oversold, overbought } = STRAT_META.get('rsi_reversal')!;
      const r = rsi(c, period);
      const p = r[r.length - 2];
      const x = r[r.length - 1];
      if (Number.isNaN(p) || Number.isNaN(x)) return null;
      if (p <= oversold && x > oversold) return { dir: 'BUY', strength: Math.min(99, strength + 12), why: `RSI ${x.toFixed(1)} out of oversold` };
      if (p >= overbought && x < overbought) return { dir: 'SELL', strength: Math.min(99, strength + 12), why: `RSI ${x.toFixed(1)} out of overbought` };
      return null;
    }
    case 'macd_cross': {
      const { fast, slow, signal } = STRAT_META.get('macd_cross')!;
      const line = macd(c, fast, slow, signal).map((m) => m.histogram);
      const p = line[line.length - 2];
      const x = line[line.length - 1];
      if (Number.isNaN(p) || Number.isNaN(x)) return null;
      if (p <= 0 && x > 0) return { dir: 'BUY', strength, why: 'MACD histogram bull cross' };
      if (p >= 0 && x < 0) return { dir: 'SELL', strength, why: 'MACD histogram bear cross' };
      return null;
    }
    case 'bb_breakout': {
      const { period, mult } = STRAT_META.get('bb_breakout')!;
      const bb = bollinger(c, period, mult);
      const pB = bb[bb.length - 2];
      const cB = bb[bb.length - 1];
      if (Number.isNaN(pB.upper) || Number.isNaN(cB.upper)) return null;
      if (prev <= pB.upper && last > cB.upper) return { dir: 'BUY', strength: strength + 6, why: `Broke above upper Bollinger (${mult}σ)` };
      if (prev >= pB.lower && last < cB.lower) return { dir: 'SELL', strength: strength + 6, why: `Broke below lower Bollinger (${mult}σ)` };
      return null;
    }
    case 'supertrend': {
      const { period, mult } = STRAT_META.get('supertrend')!;
      const ohlc = bars.map((b) => ({ high: b.h, low: b.l, close: b.c }));
      const st = supertrend(ohlc, period, mult);
      const p = st[st.length - 2];
      const x = st[st.length - 1];
      if (Number.isNaN(p.line) || Number.isNaN(x.line)) return null;
      if (p.direction === 'down' && x.direction === 'up') return { dir: 'BUY', strength: strength + 10, why: 'SuperTrend flip UP' };
      if (p.direction === 'up' && x.direction === 'down') return { dir: 'SELL', strength: strength + 10, why: 'SuperTrend flip DOWN' };
      return null;
    }
    default:
      return null;
  }
}

// ---- daily replay -----------------------------------------------------------

async function main(): Promise<void> {
  const state = loadState();

  const instRes = await pool.query<{ id: number; symbol: string }>(
    "SELECT id, symbol FROM instruments WHERE status = 'ACTIVE' ORDER BY symbol",
  );
  const instruments = instRes.rows;

  const candleRes = await pool.query<{ instrument_id: number; ts: Date; open: number; high: number; low: number; close: number; volume: number }>(
    `SELECT c.instrument_id, c.ts, c.open, c.high, c.low, c.close, c.volume
     FROM candles c WHERE c.timeframe = '1d' ORDER BY c.instrument_id, c.ts`,
  );
  const bySymbol = new Map<string, Bar[]>();
  for (const inst of instruments) bySymbol.set(inst.symbol, []);
  for (const r of candleRes.rows) {
    const bars = bySymbol.get(instruments.find((i) => i.id === r.instrument_id)?.symbol ?? '');
    if (!bars) continue;
    bars.push({
      ts: new Date(r.ts).getTime(),
      date: dayOf(new Date(r.ts).getTime()),
      o: Number(r.open),
      h: Number(r.high),
      l: Number(r.low),
      c: Number(r.close),
      v: Number(r.volume),
    });
  }
  for (const bars of bySymbol.values()) bars.sort((a, b) => a.ts - b.ts);

  // all trading dates across the universe, ascending
  const dates: string[] = [];
  for (const bars of bySymbol.values()) for (const b of bars) if (!dates.includes(b.date)) dates.push(b.date);
  dates.sort();

  const startIdx = state.lastDate ? dates.indexOf(state.lastDate) + 1 : Math.max(0, dates.length - SEED_WINDOW_DAYS);
  const scope = dates.slice(state.lastDate ? startIdx : 0);
  const seed = !state.lastDate;
  let dayPnlStart: number | null = null;

  const closeAt = (bars: Bar[] | undefined, date: string): number | null => {
    const bar = bars?.find((b) => b.date === date);
    return bar ? bar.c : null;
  };

  for (let i = 0; i < scope.length; i++) {
    const date = scope[i];
    if (dayPnlStart == null) dayPnlStart = state.cash + positionsEquity(state, bySymbol, date);

    for (const strat of STRATEGIES) {
      const bucket = state.buckets[strat.id];
      const pos = state.positions[strat.id];

      if (pos) {
        // bar for the held symbol up to today (inclusive) — trailing stop + exits use full context
        const bars = bySymbol.get(pos.symbol);
        const idx = bars?.findIndex((b) => b.date === date) ?? -1;
        const close = idx >= 0 ? bars![idx].c : null;
        const highToday = idx >= 0 ? bars![idx].h : null;
        if (highToday != null) pos.highSince = Math.max(pos.highSince, highToday);
        const stop = pos.highSince * (1 - TRAIL_STOP_PCT);

        const sig = bars ? signalFor(strat.id, bars.slice(0, idx + 1)) : null;
        pos.heldDays += 1;

        let exitPrice: number | null = null;
        let reason = '';

        if (sig?.dir === 'SELL' && close != null) {
          exitPrice = close;
          reason = `sell signal — ${sig.why}`;
        } else if (close != null && close <= stop) {
          exitPrice = stop;
          reason = `trailing stop (≤${TRAIL_STOP_PCT * 100}% below ${pos.highSince.toFixed(0)})`;
        } else if (pos.heldDays >= MAX_HOLD_DAYS && close != null) {
          exitPrice = close;
          reason = `max hold ${MAX_HOLD_DAYS} days`;
        }

        if (exitPrice != null && exitPrice > 0 && close != null && close > 0) {
          const price = exitPrice * 0.9995; // exit slippage
          const realized = (price - pos.entryPrice) * pos.qty;
          state.cash += pos.qty * price;
          bucket.cash += pos.qty * price;
          bucket.realized += realized;
          bucket.trades += 1;
          if (realized >= 0) bucket.wins += 1;
          else bucket.losses += 1;
          state.realizedPnl += realized;
          state.trades.push({ day: date, strategy: strat.id, symbol: pos.symbol, side: 'SELL', qty: pos.qty, price, pnl: realized, reason });
          delete state.positions[strat.id];
        }
      } else if (bucket.cash >= 100) {
        // ENTRY — own BUY signal, or idle deployment after 5 quiet days
        const today: { symbol: string; strength: number; why: string; price: number }[] = [];
        for (const [symbol, bars] of bySymbol) {
          if (!bars?.length) continue;
          const idx = bars.findIndex((b) => b.date === date);
          if (idx < 0) continue;
          const sig = signalFor(strat.id, bars.slice(0, idx + 1));
          if (sig?.dir === 'BUY') today.push({ symbol, strength: sig.strength, why: sig.why, price: bars[idx].c });
        }
        const idle = state.trades.filter((t) => t.strategy === strat.id && t.side === 'BUY').sort((a, b) => a.day.localeCompare(b.day));
        const lastBuy = idle.length ? idle[idle.length - 1].day : '';
        const daysSinceBuy = lastBuy ? Math.floor((new Date(date).getTime() - new Date(lastBuy).getTime()) / 86_400_000) : 99;

        let pick: { symbol: string; price: number; why: string } | null = null;
        if (today.length) {
          const best = today.sort((a, b) => b.strength - a.strength)[0];
          pick = { symbol: best.symbol, price: best.price, why: `buy signal — ${best.why}` };
        } else if (daysSinceBuy >= 5) {
          // force the bucket to work: strongest BUY anywhere today
          const any: { symbol: string; price: number; strength: number }[] = [];
          for (const [symbol, bars] of bySymbol) {
            const idx = bars.findIndex((b) => b.date === date);
            if (idx < 0) continue;
            for (const st of STRATEGIES) {
              const sig = signalFor(st.id, bars.slice(0, idx + 1));
              if (sig?.dir === 'BUY') {
                any.push({ symbol, price: bars[idx].c, strength: sig.strength });
                break;
              }
            }
          }
          if (any.length) {
            const best = any.sort((a, b) => b.strength - a.strength)[0];
            pick = { symbol: best.symbol, price: best.price, why: `idle ${daysSinceBuy}d — deployment on strongest ${best.symbol} signal` };
          }
        }

        if (pick && pick.price > 10 && bucket.cash >= pick.price) {
          const price = pick.price * 1.0005; // entry slippage
          const qty = Math.floor(bucket.cash / price);
          if (qty >= 1) {
            const cost = qty * price;
            state.cash -= cost;
            bucket.cash -= cost;
            bucket.trades += 1;
            state.positions[strat.id] = {
              symbol: pick.symbol,
              qty,
              entryPrice: price,
              entryDate: date,
              highSince: price,
              heldDays: 0,
            };
            state.trades.push({ day: date, strategy: strat.id, symbol: pick.symbol, side: 'BUY', qty, price, pnl: 0, reason: pick.why });
          }
        }
      }
    }

    // end-of-day mark to market
    const equity = state.cash + positionsEquity(state, bySymbol, date);
    const invested = equity - state.cash;
    const last = state.history[state.history.length - 1];
    if (last && last.date === date) last.equity = equity;
    else state.history.push({ date, equity: Math.round(equity * 100) / 100, cash: Math.round(state.cash * 100) / 100, invested: Math.round(invested * 100) / 100 });
    state.lastDate = date;
    if (state.history.length > 100) state.history = state.history.slice(-100);
    if (state.trades.length > 400) state.trades = state.trades.slice(-400);
  }

  // ---- write dashboard view + state ---------------------------------------
  const equity = state.cash + positionsEquity(state, bySymbol, state.lastDate);
  const dayPnl = dayPnlStart != null ? equity - dayPnlStart : 0;
  const strategies = STRATEGIES.map((s) => {
    const b = state.buckets[s.id];
    const pos = state.positions[s.id];
    const posEquity = pos ? positionEquity(state, bySymbol, pos, state.lastDate) : 0;
    const wins = b.wins;
    const losses = b.losses;
    return {
      id: s.id,
      label: s.label,
      allocPct: Math.round((state.allocation / INITIAL_CAPITAL) * 100),
      cash: Math.round(b.cash * 100) / 100,
      positionEquity: Math.round(posEquity * 100) / 100,
      equity: Math.round((b.cash + posEquity) * 100) / 100,
      pnl: Math.round((b.realized + (pos ? posEquity - pos.qty * pos.entryPrice : 0)) * 100) / 100,
      trades: b.trades,
      wins,
      losses,
      winRate: b.trades ? Math.round((wins / b.trades) * 100) : null,
      open: pos ? { symbol: pos.symbol, qty: pos.qty, entryPrice: pos.entryPrice, heldDays: pos.heldDays } : null,
    };
  });
  const openPositions = Object.entries(state.positions).map(([strat, pos]) => {
    const price = positionEquity(state, bySymbol, pos, state.lastDate) / pos.qty;
    return {
      strategy: strat,
      label: STRAT_META.get(strat)?.label ?? strat,
      symbol: pos.symbol,
      qty: pos.qty,
      entryPrice: pos.entryPrice,
      lastPrice: Math.round(price * 100) / 100,
      unrealized: Math.round((price - pos.entryPrice) * pos.qty * 100) / 100,
      unrealizedPct: Math.round(((price - pos.entryPrice) / pos.entryPrice) * 1000) / 10,
      heldDays: pos.heldDays,
    };
  });

  const latest = {
    ts: new Date().toISOString(),
    account: 'Paper Lab · ₹1,00,000',
    initialCapital: INITIAL_CAPITAL,
    asOf: state.lastDate,
    seeded: seed,
    cash: Math.round(state.cash * 100) / 100,
    equity: Math.round(equity * 100) / 100,
    invested: Math.round((equity - state.cash) * 100) / 100,
    realizedPnl: Math.round(state.realizedPnl * 100) / 100,
    unrealizedPnl: Math.round((equity - state.cash - state.realizedPnl) * 100) / 100,
    dayPnl: Math.round(dayPnl * 100) / 100,
    totalReturnPct: Math.round(((equity - INITIAL_CAPITAL) / INITIAL_CAPITAL) * 1000) / 10,
    tradingDays: state.history.length,
    strategies,
    openPositions,
    recentTrades: state.trades.slice(-40).reverse(),
    history: state.history,
  };

  mkdirSync(join(process.cwd(), 'frontend', 'public', 'paper'), { recursive: true });
  writeFileSync(LATEST_FILE, JSON.stringify(latest));
  writeFileSync(STATE_FILE, JSON.stringify(state));

  const opened = state.trades.filter((t) => t.side === 'BUY').length;
  const closed = state.trades.filter((t) => t.side === 'SELL').length;
  console.log(
    `paper: ${seed ? `seeded from ${SEED_WINDOW_DAYS}d window (${state.history.length} days)` : `advanced to ${state.lastDate}`} · ` +
    `equity ₹${latest.equity.toLocaleString('en-IN')} (${latest.totalReturnPct >= 0 ? '+' : ''}${latest.totalReturnPct}%) · ` +
    `${opened} opens / ${closed} closes, ${Object.keys(state.positions).length} open, dayPnl ₹${latest.dayPnl.toLocaleString('en-IN')}`,
  );
  await pool.end();
}

function positionEquity(state: State, bySymbol: Map<string, Bar[]>, pos: Pos, date: string): number {
  const bars = bySymbol.get(pos.symbol);
  const idx = bars?.findIndex((b) => b.date === date) ?? -1;
  const price = idx >= 0 ? bars![idx].c : pos.entryPrice;
  return pos.qty * price;
}

function positionsEquity(state: State, bySymbol: Map<string, Bar[]>, date: string): number {
  let total = 0;
  for (const pos of Object.values(state.positions)) total += positionEquity(state, bySymbol, pos, date);
  return total;
}

main().catch(async (e) => {
  console.error('paper failed:', e instanceof Error ? e.message : e);
  await pool.end().catch(() => {});
  process.exitCode = 1;
});