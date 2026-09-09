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
// Risk management (this is the money-protection layer, in plain words):
//   * HARD STOP-LOSS: every position carries an 8% entry-based stop — if the
//     day's low touches it, we exit AT the stop. Worst case is ~8% + slippage
//     per trade, never "wait and hope".
//   * TRAILING STOP: once the stock rises, the stop walks UP with it (12%
//     below the best close since entry) — profits get locked in, in the same
//     move that profits touch their high.
//   * MAX HOLD: after 20 days without a clean exit, the money moves on.
//   * DURING MARKET HOURS (LIVE_STOP_CHECK=1): open positions are checked
//     against live NSE quotes and stops fire intraday, not just at the close.
//
// Daily loop per strategy (1 decision bar = 1 trading day, executed at close):
//   * ENTRY   on the strategy's BUY signal for a symbol — deploy all the
//             bucket cash into that symbol (capital is meant to be used).
//   * EXIT    on stop-loss / trailing stop / signal / 20-day max hold.
//   * MTM     every day's equity = cash + positions marked at that day's close.
//
// Writes:
//   frontend/public/paper/state.json       — canonical running state
//   frontend/public/paper/latest.json      — dashboard view (incl. full ledger)

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { pool } from '@trading/shared';
import { sma, rsi, macd, bollinger, supertrend } from '@trading/shared';

const ACCOUNT_ID = 2;
const INITIAL_CAPITAL = 100_000; // ₹1,00,000 virtual INR
const ALLOC = INITIAL_CAPITAL / 5; // ₹20,000 per strategy
const SLIPPAGE = 0.0005;
const SL_PCT = 0.08; // hard stop-loss: 8% below the entry price (risk cap)
const TRAIL_STOP_PCT = 0.12; // trailing stop: 12% below the best close since entry
const MAX_HOLD_DAYS = 20;
const SEED_WINDOW_DAYS = 90; // backfill window when the account starts
const LIVE_STOP = process.env.LIVE_STOP_CHECK === '1'; // intraday stop checks during market hours

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

const fmtInr = (n: number): string => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

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

type ExitClass = 'open' | 'signal-exit' | 'stop-loss' | 'trail-stop' | 'max-hold' | 'live-stop';

interface Trade {
  day: string;
  strategy: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  qty: number;
  price: number;
  entryPrice: number;
  stopLoss: number; // 8% below entry — the hard risk cap
  trailStop: number; // trailing stop at exit time (or initial on buys)
  pnl: number; // 0 on buys
  retPct: number | null; // return % on sells
  exitClass: ExitClass;
  reason: string; // technical reason
  story: string; // plain-language explanation for a non-technical investor
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

  if (process.env.PAPER_LIVE_ONLY === '1') {
    await liveStopCheck(state, new Map()).catch((e: unknown) =>
      console.log(`paper: live-stop check failed (continuing): ${e instanceof Error ? e.message : e}`),
    );
    const equity = state.cash + Object.values(state.positions).reduce((a, p) => a + p.qty * p.entryPrice, 0);
    mkdirSync(join(process.cwd(), 'frontend', 'public', 'paper'), { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify(state));
    writeFileSync(
      LATEST_FILE,
      JSON.stringify({
        ts: new Date().toISOString(),
        account: 'Paper Lab · ₹1,00,000',
        initialCapital: INITIAL_CAPITAL,
        asOf: state.lastDate,
        seeded: false,
        slPct: SL_PCT,
        trailPct: TRAIL_STOP_PCT,
        maxHoldDays: MAX_HOLD_DAYS,
        cash: Math.round(state.cash * 100) / 100,
        equity: Math.round(equity * 100) / 100,
        invested: Math.round((equity - state.cash) * 100) / 100,
        realizedPnl: Math.round(state.realizedPnl * 100) / 100,
        unrealizedPnl: 0,
        dayPnl: 0,
        totalReturnPct: Math.round(((equity - INITIAL_CAPITAL) / INITIAL_CAPITAL) * 1000) / 10,
        tradingDays: state.history.length,
        strategies: STRATEGIES.map((s) => {
          const b = state.buckets[s.id];
          const pos = state.positions[s.id];
          return {
            id: s.id,
            label: s.label,
            allocPct: 20,
            cash: Math.round(b.cash * 100) / 100,
            positionEquity: pos ? Math.round(pos.qty * pos.entryPrice * 100) / 100 : 0,
            equity: Math.round((b.cash + (pos ? pos.qty * pos.entryPrice : 0)) * 100) / 100,
            pnl: Math.round(b.realized * 100) / 100,
            trades: b.trades,
            wins: b.wins,
            losses: b.losses,
            winRate: b.trades ? Math.round((b.wins / b.trades) * 100) : null,
            open: pos ? { symbol: pos.symbol, qty: pos.qty, entryPrice: pos.entryPrice, heldDays: pos.heldDays } : null,
          };
        }),
        openPositions: Object.entries(state.positions).map(([strat, pos]) => ({
          strategy: strat,
          label: STRAT_META.get(strat)?.label ?? strat,
          symbol: pos.symbol,
          qty: pos.qty,
          entryPrice: pos.entryPrice,
          lastPrice: pos.entryPrice,
          unrealized: 0,
          unrealizedPct: 0,
          heldDays: pos.heldDays,
        })),
        transactions: state.trades.slice().reverse(),
        recentTrades: state.trades.slice(-40).reverse(),
        history: state.history,
      }),
    );
    console.log(`paper: live-only stop check · ${Object.keys(state.positions).length} still open · cash ${fmtInr(state.cash)}`);
    await pool.end().catch(() => {});
    return;
  }

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

  for (let i = 0; i < scope.length; i++) {
    const date = scope[i];

    for (const strat of STRATEGIES) {
      const bucket = state.buckets[strat.id];
      const pos = state.positions[strat.id];

      if (pos) {
        // bar for the held symbol up to today (inclusive) — trailing stop + exits use full context
        const bars = bySymbol.get(pos.symbol);
        const idx = bars?.findIndex((b) => b.date === date) ?? -1;
        const bar = idx >= 0 ? bars![idx] : null;
        const close = bar?.c ?? null;
        const highToday = bar?.h ?? null;
        const lowToday = bar?.l ?? null;
        if (highToday != null) pos.highSince = Math.max(pos.highSince, highToday);
        pos.heldDays += 1;

        const entryStop = pos.entryPrice * (1 - SL_PCT); // hard risk cap
        const trailStop = pos.highSince * (1 - TRAIL_STOP_PCT); // profit protector

        const sig = bars ? signalFor(strat.id, bars.slice(0, idx + 1)) : null;

        let exitPrice: number | null = null;
        let exitClass: ExitClass = 'open';
        let reason = '';

        // Risk exits first — a bar that blasts through a stop is out, full stop.
        if (lowToday != null && lowToday <= entryStop) {
          exitPrice = Math.min(entryStop, close ?? entryStop);
          exitClass = 'stop-loss';
          reason = `hard stop-loss (≤${SL_PCT * 100}% below entry ${fmtInr(pos.entryPrice)})`;
        } else if (lowToday != null && lowToday <= trailStop) {
          exitPrice = Math.max(entryStop, Math.min(trailStop, close ?? trailStop));
          exitClass = 'trail-stop';
          reason = `trailing stop (≤${TRAIL_STOP_PCT * 100}% below high ${fmtInr(pos.highSince)})`;
        } else if (pos.heldDays >= MAX_HOLD_DAYS) {
          exitPrice = close;
          exitClass = 'max-hold';
          reason = `max hold ${MAX_HOLD_DAYS} days`;
        } else if (sig?.dir === 'SELL' && close != null) {
          exitPrice = close;
          exitClass = 'signal-exit';
          reason = `sell signal — ${sig.why}`;
        }

        if (exitPrice != null && exitPrice > 0 && close != null && close > 0) {
          const price = exitPrice * (1 - SLIPPAGE); // exit slippage
          const realized = (price - pos.entryPrice) * pos.qty;
          state.cash += pos.qty * price;
          bucket.cash += pos.qty * price;
          bucket.realized += realized;
          bucket.trades += 1;
          if (realized >= 0) bucket.wins += 1;
          else bucket.losses += 1;
          state.realizedPnl += realized;
          state.trades.push({
            day: date,
            strategy: strat.id,
            symbol: pos.symbol,
            side: 'SELL' as const,
            qty: pos.qty,
            price,
            entryPrice: pos.entryPrice,
            stopLoss: entryStop,
            trailStop,
            pnl: realized,
            retPct: Math.round((price / pos.entryPrice - 1) * 1000) / 10,
            exitClass,
            reason,
            story: storyForExit(exitClass, price, pos.entryPrice, pos.highSince),
          });
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
            state.trades.push({
              day: date,
              strategy: strat.id,
              symbol: pick.symbol,
              side: 'BUY' as const,
              qty,
              price,
              entryPrice: price,
              stopLoss: Math.round(price * (1 - SL_PCT) * 100) / 100,
              trailStop: Math.round(price * (1 - TRAIL_STOP_PCT) * 100) / 100,
              pnl: 0,
              retPct: null,
              exitClass: 'open' as const,
              reason: pick.why,
              story: storyForEntry(strat.id, pick.why),
            });
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
  }

  // Live stop checks run AFTER the whole replay (they close positions on the
  // last processed day), and only when the account is already seeded. This is
  // how the paper trades "work during market hours": open positions are checked
  // against live NSE quotes and their stops fire intraday.
  if (LIVE_STOP && !seed && Object.keys(state.positions).length) {
    await liveStopCheck(state, bySymbol).catch((e: unknown) =>
      console.log(`paper: live-stop check failed (continuing): ${e instanceof Error ? e.message : e}`),
    );
  }

  // ---- write dashboard view + state ---------------------------------------
  const equity = state.cash + positionsEquity(state, bySymbol, state.lastDate);
  // day P&L = move vs the previous processed day (works for both seed backfill
  // and the daily one-day advance: the prior session's equity is history[-2]).
  const prevEq = state.history[state.history.length - 2]?.equity;
  const dayPnl = prevEq != null ? equity - prevEq : 0;
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
    slPct: SL_PCT,
    trailPct: TRAIL_STOP_PCT,
    maxHoldDays: MAX_HOLD_DAYS,
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
    transactions: state.trades.slice().reverse(),
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

function storyForEntry(strategy: string, why: string): string {
  const names: Record<string, string> = {
    ma_cross: 'the moving-average trend method (buy when the short average crosses above the long one)',
    rsi_reversal: 'the RSI bounce method (buy when a washed-out stock starts turning up)',
    macd_cross: 'the MACD momentum method (buy when short-term momentum flips positive)',
    bb_breakout: 'the Bollinger breakout method (buy when price pushes through the upper band)',
    supertrend: 'the Supertrend method (buy when the trend filter flips from down to up)',
  };
  return (
    `We put this bucket's cash to work using ${names[strategy] ?? strategy}. ` +
    `Trigger: ${why}. An 8% stop-loss sits under the buy price so a sharp drop is cut automatically instead of hoping it comes back.`
  );
}

function storyForExit(exitClass: ExitClass, price: number, entry: number, high: number): string {
  const pct = ((price / entry - 1) * 100).toFixed(1);
  const signed = `${Number(pct) >= 0 ? '+' : ''}${pct}%`;
  switch (exitClass) {
    case 'stop-loss':
      return `The stock fell about 8% from our buy price, so the safety net sold it. This is how we cap a losing trade. Result: ${signed}.`;
    case 'trail-stop':
      return `The stock had run up (high ${fmtInr(high)}), then slipped 12% off that peak, so we locked what remained of the gain instead of giving it all back. Result: ${signed}.`;
    case 'max-hold':
      return `We held this for the full 20-day window without a clean exit signal, so the money was recycled. Result: ${signed}.`;
    case 'live-stop':
      return `During market hours the live price hit the stop, so we exited immediately rather than waiting for the closing bell. Result: ${signed}.`;
    case 'signal-exit':
    default:
      return `The method's sell rule fired, so we stepped aside. Result: ${signed}.`;
  }
}

async function liveQuote(symbol: string): Promise<number | null> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}.NS?interval=1m&range=1d`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) return null;
    const j = (await res.json()) as {
      chart?: { result?: Array<{ meta?: { regularMarketPrice?: number }; indicators?: { quote?: Array<{ close?: (number | null)[] }> } }> };
    };
    const r = j.chart?.result?.[0];
    const live = r?.meta?.regularMarketPrice;
    if (typeof live === 'number' && live > 0) return live;
    const closes = r?.indicators?.quote?.[0]?.close ?? [];
    for (let i = closes.length - 1; i >= 0; i -= 1) {
      const c = closes[i];
      if (typeof c === 'number' && c > 0) return c;
    }
    return null;
  } catch {
    return null;
  }
}

async function liveStopCheck(state: State, _bySymbol: Map<string, Bar[]>): Promise<void> {
  const today = dayOf(Date.now());
  for (const [strat, pos] of Object.entries(state.positions)) {
    const live = await liveQuote(pos.symbol);
    if (live == null) continue;
    pos.highSince = Math.max(pos.highSince, live);
    const entryStop = pos.entryPrice * (1 - SL_PCT);
    const trailStop = pos.highSince * (1 - TRAIL_STOP_PCT);
    let exitPrice: number | null = null;
    let exitClass: ExitClass = 'live-stop';
    let reason = '';
    if (live <= entryStop) {
      exitPrice = entryStop;
      exitClass = 'live-stop';
      reason = `intraday hard stop-loss (live ${fmtInr(live)} ≤ ${fmtInr(entryStop)})`;
    } else if (live <= trailStop) {
      exitPrice = Math.max(entryStop, trailStop);
      exitClass = 'live-stop';
      reason = `intraday trailing stop (live ${fmtInr(live)} ≤ ${fmtInr(trailStop)})`;
    }
    if (exitPrice == null || exitPrice <= 0) continue;
    const price = exitPrice * (1 - SLIPPAGE);
    const realized = (price - pos.entryPrice) * pos.qty;
    const bucket = state.buckets[strat];
    state.cash += pos.qty * price;
    bucket.cash += pos.qty * price;
    bucket.realized += realized;
    bucket.trades += 1;
    if (realized >= 0) bucket.wins += 1;
    else bucket.losses += 1;
    state.realizedPnl += realized;
    state.trades.push({
      day: today,
      strategy: strat,
      symbol: pos.symbol,
      side: 'SELL',
      qty: pos.qty,
      price,
      entryPrice: pos.entryPrice,
      stopLoss: entryStop,
      trailStop,
      pnl: realized,
      retPct: Math.round((price / pos.entryPrice - 1) * 1000) / 10,
      exitClass,
      reason,
      story: storyForExit(exitClass, price, pos.entryPrice, pos.highSince),
    });
    delete state.positions[strat];
    console.log(`paper: LIVE STOP ${strat} ${pos.symbol} @ ${fmtInr(price)} (${reason})`);
  }
}

main().catch(async (e) => {
  console.error('paper failed:', e instanceof Error ? e.message : e);
  await pool.end().catch(() => {});
  process.exitCode = 1;
});