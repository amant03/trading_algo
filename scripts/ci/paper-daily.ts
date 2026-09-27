// Daily Paper trade — self-improving, loss-first intraday paper trader.
//
// Philosophy (set by the owner): SMALL CERTAIN PROFITS over risky big ones.
// Losses are cut fast and never repeated; winners are banked early and
// strategies that bleed get benched automatically.
//
// This is a LONG-ONLY intraday paper trader:
//   * every IST trading day starts with a FRESH ₹1,00,000 of virtual money,
//   * trades SEVEN methods on TODAY's real 5-minute NSE bars
//     (ma_cross, rsi_reversal, macd_cross, bb_breakout, supertrend,
//      donchian_breakout, stoch_cross),
//   * entries need CONFLUENCE: strategy signal + trend filter (close above
//     SMA20, else above session open) + no fresh bearish news,
//   * fresh NEWS fuses with technicals: bullish headlines boost entries,
//     bearish headlines block entries and force exits,
//   * ALL positions are squared off at the last bar — pure intraday,
//   * has NO database dependency: bars from Yahoo intraday, news from the
//     workspace/automation-data news.json, memory in paper/learning.json.
//
// Trade lifecycle:
//   1. BUY on a bullish signal WITH trend confluence (never into a downtrend)
//   2. HOLD while it works — ratchet locks gains once +1% up
//   3. SELL on: 1% hard stop / +2% take-profit / 1% ratchet-trail / fresh
//      bearish NEWS / bearish signal exit / EOD square-off
//
// Self-improvement (paper/learning.json, 10-session rolling window):
//   * each strategy gets a WEIGHT from loss-averse scoring of its recent
//     round trips; capital splits by weight, losers get starved then PAUSED
//   * 6-bar COOLDOWN after any stop-loss (no revenge trading)
//   * per-symbol AVOID list: two stop-outs in a day = done with it today
//   * every pause/resume/weight-shift is logged as a human-readable LESSON
//
// Reruns are idempotent: each run replays today's closed bars from the day's open.
//
// Writes: frontend/public/paper/daily.json, frontend/public/paper/learning.json

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { sma, rsi, macd, bollinger, supertrend, stochastic } from '@trading/shared';
import { INSTRUMENTS as SEED } from '../../services/shared/src/instruments-data.js';

const INITIAL_CAPITAL = 100_000; // ₹1,00,000 fresh every IST trading day
const SLIPPAGE = 0.0005;
const SL_PCT = 0.01; // hard stop: 1% below the fill — losses stay tiny
const TP_PCT = 0.015; // take profit: bank +1.5% quickly (1.5:1 reward:risk)
const TRAIL_ARM_PCT = 0.01; // ratchet arms once +1% up...
const TRAIL_GIVEBACK_PCT = 0.01; // ...then gives back at most 1% from the high
const COOLDOWN_BARS = 6; // sit out 6 bars after a stop-loss
const AVOID_STOPS = 2; // two stop-outs on a symbol = avoid it rest of day
const DRIFT_GATE_PCT = 0.0; // longs only in names UP on the day — no catching falling knives, ever
const RSI_CEIL = 68; // never chase overbought: RSI above this blocks entries (FOMO filter)
const VOL_MULT = 1.0; // entry bar volume must beat its 10-bar average (real participation, not noise)
const CONFIRM_BARS = 2; // a signal must persist 2 consecutive bars — one-bar flickers are ignored
const MIN_HOLD_BARS = 3; // no signal-exit within 3 bars of entry — stops churn, lets TP work (SL/TP/news always live)
const DAILY_STOP_PCT = 0.012; // daily circuit breaker: halt new entries at -1.2% realised
const NEWS_FRESH_MS = 18 * 60 * 60_000; // headlines count for 18h (covers overnight news)
const LEARN_WINDOW = 10; // rolling sessions of memory
const POOL_SIZE = 8;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

const STRATEGIES = [
  { id: 'ma_cross', label: 'MA Cross', fast: 9, slow: 21 },
  { id: 'rsi_reversal', label: 'RSI Reversal', period: 14, oversold: 30, overbought: 70 },
  { id: 'macd_cross', label: 'MACD Cross', fast: 12, slow: 26, signal: 9 },
  { id: 'bb_breakout', label: 'Bollinger Breakout', period: 20, mult: 2 },
  { id: 'supertrend', label: 'Supertrend', period: 10, mult: 3 },
  { id: 'donchian_breakout', label: 'Donchian Breakout', period: 20 },
  { id: 'stoch_cross', label: 'Stochastic Cross', kPeriod: 14, dPeriod: 3, oversold: 20, overbought: 80 },
];
const STRAT_META = new Map(STRATEGIES.map((s) => [s.id, s]));

const FILE = join(process.cwd(), 'frontend', 'public', 'paper', 'daily.json');
const LEARN_FILE = join(process.cwd(), 'frontend', 'public', 'paper', 'learning.json');
const NEWS_FILE = join(process.cwd(), 'frontend', 'public', 'news.json');
const NEWS_RAW_URL = 'https://raw.githubusercontent.com/amant03/trading_algo/automation-data/frontend/public/news.json';

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
  ratchetArmed: boolean; // true once +1%: lock gains, never give it all back
  entryIdx: number; // bar index of entry (minimum-hold enforcement)
}

type ExitClass = 'eod' | 'signal-exit' | 'stop-loss' | 'trail-stop' | 'take-profit' | 'news-exit' | 'breaker';

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
  newsDriven?: boolean; // a fresh headline shaped this trade
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

interface ArchiveDay {
  date: string;
  capital: number;
  equity: number;
  realizedPnl: number;
  dayPnl: number;
  wins: number;
  trades: number; // count (kept for compatibility)
  winPct?: number | null;
  ledger: Trade[]; // full trade list, newest-first
}

interface Store {
  ts: string;
  today: DayState | null;
  days: ArchiveDay[];
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

const byTimeDesc = (a: Trade, b: Trade): number =>
  b.time < a.time ? -1 : b.time > a.time ? 1 : a.side === b.side ? 0 : a.side === 'SELL' ? -1 : 1;

function archiveDay(store: Store, day: DayState): void {
  const winPct = day.wins + day.losses > 0 ? Math.round((day.wins / (day.wins + day.losses)) * 100) : null;
  const entry: ArchiveDay = {
    date: day.date,
    capital: day.capital,
    equity: day.equity,
    realizedPnl: day.realizedPnl,
    dayPnl: day.dayPnl,
    wins: day.wins,
    trades: day.trades.length,
    ...(winPct != null ? ({ winPct } as Record<string, number | null>) : {}),
    ledger: [...day.trades].sort(byTimeDesc),
  };
  store.days = [entry, ...store.days.filter((d) => d.date !== day.date)].slice(0, 15);
}

// ---- news fuse ------------------------------------------------------------------
// Deterministic, explainable headline sentiment (no LLM, no key): whole-word
// keyword scoring over the title. Bullish headlines boost entries, bearish
// headlines block entries and force exits. Timestamps come from news.json
// (Google News RSS automation), matched to the session being replayed.

interface NewsItem {
  symbol: string;
  title: string;
  ts: number; // publishedAt ms
  sentiment: 'bullish' | 'bearish' | 'neutral';
}

const BULL_WORDS = [
  'surge', 'surged', 'surges', 'surging', 'rally', 'rallies', 'rallied', 'jump', 'jumps', 'jumped',
  'soar', 'soars', 'soared', 'record', 'profits', 'profit', 'beats', 'beat', 'upgrade', 'upgrades',
  'upgraded', 'outperform', 'buyback', 'dividend', 'bonus', 'split', 'approval', 'approves', 'approved',
  'wins', 'bags', 'breakout', 'growth', 'grows', 'doubles', 'triples', 'multibagger', 'hits high',
  'all-time high', '52-week high', 'order win', 'deal win', 'turnaround', 'bullish',
];
const BEAR_WORDS = [
  'fall', 'falls', 'fell', 'falling', 'drop', 'drops', 'dropped', 'dropping', 'plunge', 'plunged',
  'crash', 'crashed', 'loss', 'losses', 'misses', 'missed', 'downgrade', 'downgraded', 'downgrades',
  'selloff', 'sell-off', 'fraud', 'scam', 'probe', 'raid', 'raided', 'default', 'bankrupt',
  'penalty', 'fined', 'fine', 'fire', 'strike', 'recall', 'weak', 'slump', 'slumps', 'slumped',
  'sinks', 'sink', 'tumble', 'tumbles', 'tumbled', 'concern', 'warning', 'warns', 'cuts', 'cut',
  'fires', 'layoff', 'layoffs', 'scandal', 'bearish', 'all-time low', '52-week low', 'crisis',
];

function newsSentiment(title: string): 'bullish' | 'bearish' | 'neutral' {
  const t = ` ${title.toLowerCase()} `;
  let score = 0;
  for (const w of BULL_WORDS) {
    if (t.includes(w.length > 4 ? ` ${w} ` : w)) score += 1;
  }
  for (const w of BEAR_WORDS) {
    if (t.includes(w.length > 4 ? ` ${w} ` : w)) score -= 1;
  }
  if (score > 0) return 'bullish';
  if (score < 0) return 'bearish';
  return 'neutral';
}

async function loadNews(): Promise<Map<string, NewsItem[]>> {
  const out = new Map<string, NewsItem[]>();
  let raw: unknown = null;
  try {
    if (existsSync(NEWS_FILE)) raw = JSON.parse(readFileSync(NEWS_FILE, 'utf8'));
  } catch {
    raw = null;
  }
  if (!raw) {
    try {
      const res = await fetch(NEWS_RAW_URL, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15_000) });
      if (res.ok) raw = await res.json();
    } catch {
      raw = null;
    }
  }
  try {
    const items = (raw as { items?: Record<string, Array<{ title?: string; publishedAt?: string; symbol?: string }>> })?.items ?? {};
    for (const [sym, list] of Object.entries(items)) {
      const upper = sym.toUpperCase();
      for (const a of list ?? []) {
        if (!a?.title) continue;
        const ts = Date.parse(a.publishedAt ?? '');
        if (!isFinite(ts)) continue;
        const arr = out.get(upper) ?? [];
        arr.push({ symbol: upper, title: a.title, ts, sentiment: newsSentiment(a.title) });
        out.set(upper, arr);
      }
    }
  } catch {
    // no news = pure technicals; the bot degrades gracefully
  }
  return out;
}

/** Fresh headlines for a symbol at a bar: published within the fuse window. */
function freshNews(all: NewsItem[] | undefined, barTs: number): { bullish: NewsItem[]; bearish: NewsItem[] } {
  const bullish: NewsItem[] = [];
  const bearish: NewsItem[] = [];
  if (!all) return { bullish, bearish };
  for (const n of all) {
    const age = barTs - n.ts;
    if (age < 0 || age > NEWS_FRESH_MS) continue;
    if (n.sentiment === 'bullish') bullish.push(n);
    else if (n.sentiment === 'bearish') bearish.push(n);
  }
  return { bullish, bearish };
}

// ---- self-improvement (loss-first learning) ---------------------------------------
// Rolling 10-session memory per strategy. Scoring is deliberately loss-averse:
// a strategy that bleeds gets starved of capital fast and benched, while a
// steady winner earns a bigger bucket. Every change is logged as plain text.

interface StratDay {
  n: number; // round trips
  win: number;
  net: number; // ₹ realised
  sumRet: number; // Σ ret% (for expectancy)
  sumSq: number; // Σ ret%² (for spread)
}

interface StratLearn {
  weight: number; // capital multiplier, 0 = benched
  status: 'active' | 'paused';
  reason: string;
  streak: number; // +wins / -losses, current run
  pausedUntil: string | null; // bench expiry (YYYY-MM-DD) — a benched method always gets parole
}

interface LearnState {
  updatedAt: string;
  windowDays: number;
  strategies: Record<string, StratLearn>;
  allocation: Record<string, number>; // share of capital per strategy (0..1)
  lessons: { date: string; text: string }[];
  history: { date: string; per: Record<string, StratDay>; news: { actions: number; net: number; blocked: number } }[];
  newsTotals: { actions: number; net: number; blocked: number };
}

interface LearnRuntime {
  weights: Record<string, number>;
  paused: Set<string>;
  news: Map<string, NewsItem[]>;
  cooldown: Map<string, number>; // strategy -> bars left to sit out
  avoid: Map<string, number>; // "strat|sym" -> stop-outs today
  avoidEvents: string[];
  skips: { trend: number; news: number; cooldown: number; avoid: number; paused: number; drift: number; breaker: number; chase: number; thin: number; unconfirmed: number };
  newsDay: { actions: number; net: number; blocked: number };
  halted: boolean; // daily circuit breaker tripped — no new entries
  exitMix: Record<string, number>;
}

function freshLearn(): LearnState {
  return {
    updatedAt: new Date().toISOString(),
    windowDays: LEARN_WINDOW,
    strategies: Object.fromEntries(
      STRATEGIES.map((s) => [s.id, { weight: 1, status: 'active' as const, reason: 'no history yet — full bucket', streak: 0, pausedUntil: null }]),
    ),
    allocation: Object.fromEntries(STRATEGIES.map((s) => [s.id, 1 / STRATEGIES.length])),
    lessons: [],
    history: [],
    newsTotals: { actions: 0, net: 0, blocked: 0 },
  };
}

function loadLearn(): LearnState {
  const fresh = freshLearn();
  try {
    if (!existsSync(LEARN_FILE)) return fresh;
    const raw = JSON.parse(readFileSync(LEARN_FILE, 'utf8')) as Partial<LearnState>;
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.history)) return fresh;
    const strategies: Record<string, StratLearn> = {};
    for (const s of STRATEGIES) {
      const prev = raw.strategies?.[s.id] as Partial<StratLearn> | undefined;
      strategies[s.id] = {
        weight: typeof prev?.weight === 'number' ? prev.weight : 1,
        status: prev?.status === 'paused' ? 'paused' : 'active',
        reason: typeof prev?.reason === 'string' ? prev.reason : 'no history yet — full bucket',
        streak: typeof prev?.streak === 'number' ? prev.streak : 0,
        pausedUntil: typeof prev?.pausedUntil === 'string' ? prev.pausedUntil : null,
      };
    }
    return { ...fresh, ...raw, strategies, windowDays: LEARN_WINDOW } as LearnState;
  } catch {
    return fresh;
  }
}

interface WindowStats { n: number; win: number; net: number; mean: number; sd: number }

function windowStats(learn: LearnState, strat: string): WindowStats {
  const days = learn.history.slice(-learn.windowDays);
  let n = 0;
  let win = 0;
  let net = 0;
  let sumRet = 0;
  let sumSq = 0;
  for (const d of days) {
    const p = d.per[strat];
    if (!p) continue;
    n += p.n;
    win += p.win;
    net += p.net;
    sumRet += p.sumRet;
    sumSq += p.sumSq;
  }
  const mean = n > 0 ? sumRet / n : 0;
  const variance = n > 1 ? Math.max(0, sumSq / n - mean * mean) : 0;
  return { n, win, net, mean, sd: Math.sqrt(variance) };
}

/**
 * Loss-averse scoring. Small certain gains beat risky big ones:
 * weight grows with positive expectancy but any sustained bleeding —
 * negative expectancy with real sample size, or 3 straight losses —
 * benches the strategy immediately.
 */
function scoreStrategy(st: WindowStats): { weight: number; paused: boolean; reason: string } {
  if (st.n < 3) return { weight: 1, paused: false, reason: `warming up (${st.n} trips)` };
  const wr = (st.win / st.n) * 100;
  if ((st.mean < -0.1 && st.n >= 6) || st.mean < -0.35) {
    return {
      weight: 0,
      paused: true,
      reason: `benched: expectancy ${st.mean >= 0 ? '+' : ''}${st.mean.toFixed(2)}%/trade over ${st.n} trips — refusing repeat losses`,
    };
  }
  const weight = Math.max(0.2, Math.min(2, 1 + st.mean * 2));
  const tone = st.mean >= 0.15 ? 'earning a bigger bucket' : st.mean >= 0 ? 'holding its bucket' : 'on thin ice';
  return {
    weight: Math.round(weight * 100) / 100,
    paused: false,
    reason: `${st.win}W/${st.n - st.win}L (${wr.toFixed(0)}% win, ${st.mean >= 0 ? '+' : ''}${st.mean.toFixed(2)}%/trade) — ${tone}`,
  };
}

/** Recompute weights/pauses from the rolling window; returns human lessons. */
function refreshBrain(learn: LearnState, date: string): string[] {
  const lessons: string[] = [];
  const plusDays = (d: string, n: number): string => {
    const t = Date.parse(`${d}T12:00:00Z`) + n * 86400_000;
    return new Date(t).toISOString().slice(0, 10);
  };
  const totalW = { v: 0 };
  const next: Record<string, { weight: number; paused: boolean; reason: string }> = {};
  for (const s of STRATEGIES) {
    const streak = learn.strategies[s.id]?.streak ?? 0;
    const w = windowStats(learn, s.id);
    // Bench on 3 straight losses ONLY with a real sample (no punishing a
    // method for its first-ever trades), else score by expectancy.
    if (streak <= -3 && w.n >= 6) {
      next[s.id] = {
        weight: 0,
        paused: true,
        reason: `benched: ${-streak} straight losses over ${w.n} trips — refusing repeat losses`,
      };
    } else {
      next[s.id] = scoreStrategy(w);
    }
    totalW.v += next[s.id].weight;
  }
  for (const s of STRATEGIES) {
    const prev = learn.strategies[s.id];
    let cur = next[s.id];
    const wasPaused = prev.status === 'paused';
    if (cur.paused && !wasPaused) {
      // Fresh bench carries a fixed expiry — parole is guaranteed.
      learn.strategies[s.id].pausedUntil = plusDays(date, 5);
      lessons.push(`BENCHED ${s.label} — ${cur.reason}. Parole on ${learn.strategies[s.id].pausedUntil}; capital goes to winners meanwhile.`);
    } else if (wasPaused && cur.paused) {
      // Window-heal parole…
      const w = windowStats(learn, s.id);
      if (w.n >= 3 && w.mean >= 0.05) {
        cur = { ...cur, weight: 0.5, paused: false, reason: `paroled: window healed to ${w.mean >= 0 ? '+' : ''}${w.mean.toFixed(2)}%/trade — half bucket until it proves itself` };
        learn.strategies[s.id].streak = 0;
        learn.strategies[s.id].pausedUntil = null;
      } else if (prev.pausedUntil != null && date >= prev.pausedUntil) {
        // …or time parole: bench time served, back at half bucket.
        cur = { ...cur, weight: 0.5, paused: false, reason: 'paroled: bench time served — half bucket until it proves itself' };
        learn.strategies[s.id].streak = 0;
        learn.strategies[s.id].pausedUntil = null;
      }
    }
    if (!cur.paused && wasPaused && learn.strategies[s.id].pausedUntil == null && !lessons.some((l) => l.includes(s.label))) {
      lessons.push(`REINSTATED ${s.label} — rolling window recovered (${cur.reason}). Bucket restored gradually.`);
    } else if (!cur.paused && !wasPaused && Math.abs(cur.weight - prev.weight) >= 0.4) {
      const dir = cur.weight > prev.weight ? 'raised' : 'cut';
      lessons.push(`${s.label} bucket ${dir} ${prev.weight.toFixed(2)}× → ${cur.weight.toFixed(2)}× — ${cur.reason}.`);
    }
    learn.strategies[s.id] = { weight: cur.weight, status: cur.paused ? 'paused' : 'active', reason: cur.reason, streak: prev.streak, pausedUntil: learn.strategies[s.id].pausedUntil ?? null };
  }
  learn.allocation = Object.fromEntries(
    STRATEGIES.map((s) => [s.id, totalW.v > 0 ? Math.round((next[s.id].weight / totalW.v) * 1000) / 1000 : 0]),
  );
  return lessons;
}

// Per-replay mutable learning context (fresh maps each trading day).
// (Interface declared near LearnState above.)
function makeRuntime(learn: LearnState, news: Map<string, NewsItem[]>): LearnRuntime {
  return {
    weights: Object.fromEntries(STRATEGIES.map((s) => [s.id, learn.strategies[s.id]?.weight ?? 1])),
    paused: new Set(STRATEGIES.filter((s) => learn.strategies[s.id]?.status === 'paused').map((s) => s.id)),
    news,
    cooldown: new Map(),
    avoid: new Map(),
    avoidEvents: [],
    skips: { trend: 0, news: 0, cooldown: 0, avoid: 0, paused: 0, drift: 0, breaker: 0, chase: 0, thin: 0, unconfirmed: 0 },
    newsDay: { actions: 0, net: 0, blocked: 0 },
    halted: false,
    exitMix: {},
  };
}

/**
 * Fold one replayed day into the rolling memory: per-strategy aggregates,
 * streaks, history, fresh weights/pauses, and human-readable lessons.
 */
function updateLearning(learn: LearnState, date: string, dayTrades: Trade[], rt: LearnRuntime): string[] {
  const per: Record<string, { n: number; win: number; net: number; sumRet: number; sumSq: number }> = {};
  const chrono = [...dayTrades]
    .filter((t) => t.side === 'SELL')
    .sort((a, b) => (a.time < b.time ? -1 : 1));
  for (const t of chrono) {
    const p = per[t.strategy] ?? { n: 0, win: 0, net: 0, sumRet: 0, sumSq: 0 };
    p.n += 1;
    if (t.pnl >= 0) p.win += 1;
    p.net = Math.round((p.net + t.pnl) * 100) / 100;
    if (t.retPct != null && isFinite(t.retPct)) {
      p.sumRet = Math.round((p.sumRet + t.retPct) * 100) / 100;
      p.sumSq = Math.round((p.sumSq + t.retPct * t.retPct) * 100) / 100;
    }
    per[t.strategy] = p;
    // Streaks: wins build confidence, losses destroy it fast (loss-first).
    const st = learn.strategies[t.strategy];
    if (st) st.streak = t.pnl >= 0 ? Math.max(1, st.streak + 1) : Math.min(-1, st.streak - 1);
  }
  learn.history = [...learn.history.filter((h) => h.date !== date), { date, per, news: { ...rt.newsDay }, exits: { ...rt.exitMix } }]
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .slice(-30);
  learn.newsTotals.actions += rt.newsDay.actions;
  learn.newsTotals.net = Math.round((learn.newsTotals.net + rt.newsDay.net) * 100) / 100;
  learn.newsTotals.blocked += rt.newsDay.blocked;

  const lessons = refreshBrain(learn, date);

  const roundTrips = chrono.length;
  const wins = chrono.filter((t) => t.pnl >= 0).length;
  if (roundTrips > 0) {
    const wr = Math.round((wins / roundTrips) * 100);
    lessons.push(`Day accuracy ${wr}% (${wins}/${roundTrips}) across ${Object.keys(per).length} methods.`);
  }
  for (const ev of rt.avoidEvents) lessons.push(`${ev}.`);
  if (rt.newsDay.actions > 0 || rt.newsDay.blocked > 0) {
    lessons.push(
      `News fuse fired ${rt.newsDay.actions}× (net ${rt.newsDay.net >= 0 ? '+' : ''}₹${Math.round(rt.newsDay.net)}) and blocked ${rt.newsDay.blocked} entries on bearish headlines.`,
    );
  }
  const skipTotal = rt.skips.trend + rt.skips.cooldown + rt.skips.avoid + rt.skips.paused + rt.skips.drift + rt.skips.breaker + rt.skips.chase + rt.skips.thin + rt.skips.unconfirmed;
  if (skipTotal > 0) {
    lessons.push(
      `Selectiveness — skipped ${skipTotal} entries (trend ${rt.skips.trend}, drift ${rt.skips.drift}, chase ${rt.skips.chase}, thin-vol ${rt.skips.thin}, unconfirmed ${rt.skips.unconfirmed}, cooldown ${rt.skips.cooldown}, avoid-list ${rt.skips.avoid}, benched ${rt.skips.paused}, breaker ${rt.skips.breaker}). Fewer, better trades.`,
    );
  }
  if (rt.halted) {
    lessons.push(`Daily circuit breaker tripped — new entries halted to cap the day's realised loss. Capital preserved for tomorrow.`);
  }
  learn.lessons = [...learn.lessons, ...lessons.map((text) => ({ date, text }))].slice(-30);
  learn.updatedAt = new Date().toISOString();
  return lessons;
}

async function intradayBars(symbol: string, range = '1d'): Promise<{ bars: Bar[]; live: number | null } | null> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}.NS?interval=5m&range=${range}`,
      { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15_000) },
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
      const { fast, slow } = STRAT_META.get('ma_cross')! as { fast: number; slow: number };
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
      const { period, oversold, overbought } = STRAT_META.get('rsi_reversal')! as { period: number; oversold: number; overbought: number };
      const r = rsi(c, period);
      const p = r[r.length - 2];
      const x = r[r.length - 1];
      if (Number.isNaN(p) || Number.isNaN(x)) return null;
      if (p <= oversold && x > oversold) return { dir: 'BUY', why: `RSI(${period}) ${x.toFixed(1)} rebounded out of oversold` };
      if (p >= overbought && x < overbought) return { dir: 'SELL', why: `RSI(${period}) ${x.toFixed(1)} fell out of overbought` };
      return null;
    }
    case 'macd_cross': {
      const { fast, slow, signal } = STRAT_META.get('macd_cross')! as { fast: number; slow: number; signal: number };
      const line = macd(c, fast, slow, signal).map((m) => m.histogram);
      const p = line[line.length - 2];
      const x = line[line.length - 1];
      if (Number.isNaN(p) || Number.isNaN(x)) return null;
      if (p <= 0 && x > 0) return { dir: 'BUY', why: 'MACD histogram turned positive (bullish cross)' };
      if (p >= 0 && x < 0) return { dir: 'SELL', why: 'MACD histogram turned negative (bearish cross)' };
      return null;
    }
    case 'bb_breakout': {
      const { period, mult } = STRAT_META.get('bb_breakout')! as { period: number; mult: number };
      const bb = bollinger(c, period, mult);
      const pB = bb[bb.length - 2];
      const cB = bb[bb.length - 1];
      if (Number.isNaN(pB.upper) || Number.isNaN(cB.upper)) return null;
      if (prev <= pB.upper && last > cB.upper) return { dir: 'BUY', why: `Broke above upper Bollinger band (${mult}x std dev)` };
      if (prev >= pB.lower && last < cB.lower) return { dir: 'SELL', why: `Broke below lower Bollinger band (${mult}x std dev)` };
      return null;
    }
    case 'supertrend': {
      const { period, mult } = STRAT_META.get('supertrend')! as { period: number; mult: number };
      const ohlc = bars.map((b) => ({ high: b.h, low: b.l, close: b.c }));
      const st = supertrend(ohlc, period, mult);
      const p = st[st.length - 2];
      const x = st[st.length - 1];
      if (Number.isNaN(p.line) || Number.isNaN(x.line)) return null;
      if (p.direction === 'down' && x.direction === 'up') return { dir: 'BUY', why: 'SuperTrend flipped UP (trend reversal bullish)' };
      if (p.direction === 'up' && x.direction === 'down') return { dir: 'SELL', why: 'SuperTrend flipped DOWN (trend reversal bearish)' };
      return null;
    }
    case 'donchian_breakout': {
      const { period } = STRAT_META.get('donchian_breakout')! as { period: number };
      if (bars.length < period + 1) return null;
      const window = bars.slice(-period - 1, -1);
      const hi = Math.max(...window.map((b) => b.h));
      const lo = Math.min(...window.map((b) => b.l));
      if (last > hi) return { dir: 'BUY', why: `Donchian breakout: close ${last.toFixed(2)} above ${period}-bar high ${hi.toFixed(2)}` };
      if (last < lo) return { dir: 'SELL', why: `Donchian breakdown: close ${last.toFixed(2)} below ${period}-bar low ${lo.toFixed(2)}` };
      return null;
    }
    case 'stoch_cross': {
      const { kPeriod, dPeriod, oversold, overbought } = STRAT_META.get('stoch_cross')! as { kPeriod: number; dPeriod: number; oversold: number; overbought: number };
      const ohlc = bars.map((b) => ({ high: b.h, low: b.l, close: b.c }));
      const st = stochastic(ohlc, kPeriod, 3, dPeriod);
      const p = st[st.length - 2];
      const x = st[st.length - 1];
      if (!p || !x || Number.isNaN(p.k) || Number.isNaN(x.k) || Number.isNaN(p.d) || Number.isNaN(x.d)) return null;
      if (p.k <= p.d && x.k > x.d && x.k < oversold + 15)
        return { dir: 'BUY', why: `Stochastic %K ${x.k.toFixed(0)} crossed above %D ${x.d.toFixed(0)} near oversold` };
      if (p.k >= p.d && x.k < x.d && x.k > overbought - 15)
        return { dir: 'SELL', why: `Stochastic %K ${x.k.toFixed(0)} crossed below %D ${x.d.toFixed(0)} near overbought` };
      return null;
    }
    default:
      return null;
  }
}

// ---- single-day intraday replay --------------------------------------------

function replayDay(
  date: string,
  universe: Map<string, Bar[]>,
  liveBy: Map<string, number | null>,
  dayComplete: boolean,
  learn?: LearnRuntime,
): DayState {
  // Capital splits by learned weight (loss-first bot) or equally (baseline).
  const totalW = learn ? STRATEGIES.reduce((a, s) => a + (learn.weights[s.id] ?? 0), 0) : 0;
  const allocFor = (id: string): number =>
    learn && totalW > 0 ? (INITIAL_CAPITAL * (learn.weights[id] ?? 0)) / totalW : INITIAL_CAPITAL / STRATEGIES.length;
  const buckets: Record<string, Bucket> = Object.fromEntries(
    STRATEGIES.map((s) => [s.id, { cash: allocFor(s.id), realized: 0, wins: 0, losses: 0, entries: 0, exits: 0 }]),
  );
  const positions = new Map<string, Pos>(); // strategy -> position
  const trades: Trade[] = [];
  let cash = INITIAL_CAPITAL;
  // Per-bar cooldown countdowns (strategy -> bars left), seeded empty each day.
  if (learn) learn.cooldown.clear();

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
    newsDriven = false,
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
      ...(newsDriven ? { newsDriven: true as const } : {}),
    });
  };

  const closePosition = (
    strat: string,
    pos: Pos,
    exitPrice: number,
    exitClass: ExitClass,
    reason: string,
    time: string,
    newsDriven = false,
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

    if (learn && (newsDriven || exitClass === 'news-exit')) {
      learn.newsDay.actions += 1;
      learn.newsDay.net = Math.round((learn.newsDay.net + pnl) * 100) / 100;
    }
    if (learn) {
      learn.exitMix[exitClass] = (learn.exitMix[exitClass] ?? 0) + 1;
    }
    // Stop-loss memory: cool the strategy down + count the symbol burn.
    if (learn && exitClass === 'stop-loss') {
      learn.cooldown.set(strat, COOLDOWN_BARS);
      const key = `${strat}|${pos.symbol}`;
      const n = (learn.avoid.get(key) ?? 0) + 1;
      learn.avoid.set(key, n);
      if (n === AVOID_STOPS) {
        learn.avoidEvents.push(`${pos.symbol} blacklisted for ${STRAT_META.get(strat)?.label ?? strat} today after ${n} stop-outs — refusing a third loss`);
      }
    }

    logTrade(strat, pos.symbol, 'SELL', pos.qty, exitPrice, pnl, retPct, exitClass, reason, time, newsDriven);
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
    // Tick down learning cooldowns once per bar.
    if (learn) {
      for (const [k, v] of learn.cooldown) {
        if (v > 0) learn.cooldown.set(k, v - 1);
      }
    }
    for (const strat of STRATEGIES) {
      const pos = positions.get(strat.id);

      if (pos) {
        // ---- POSITION OPEN: check exits (capital protection first) ----
        const symBars = dayBars.get(pos.symbol);
        const bar = symBars?.[i];
        if (!bar) continue;

        // Circuit breaker flatten: halt tripped — exit everything now.
        if (learn?.halted) {
          const dayRealized = Math.round(Object.values(buckets).reduce((a, b) => a + b.realized, 0));
          closePosition(strat.id, pos, bar.c, 'breaker', `Daily circuit breaker: day realised ${fmtInr(dayRealized)} hit the −${DAILY_STOP_PCT * 100}% halt — flattening to protect capital`, timeOf(bar.ts));
          continue;
        }

        pos.highSince = Math.max(pos.highSince, bar.h);
        if (!pos.ratchetArmed && bar.h >= pos.entryPrice * (1 + TRAIL_ARM_PCT)) {
          pos.ratchetArmed = true;
        }
        const entryStop = pos.entryPrice * (1 - SL_PCT);
        const takeProfit = pos.entryPrice * (1 + TP_PCT);
        const ratchetStop = pos.ratchetArmed ? pos.highSince * (1 - TRAIL_GIVEBACK_PCT) : -Infinity;
        const sig = symBars ? signalFor(strat.id, symBars.slice(0, i + 1)) : null;
        const newsNow = learn ? freshNews(learn.news.get(pos.symbol), bar.ts) : { bullish: [], bearish: [] };

        let exitPrice: number | null = null;
        let exitClass: ExitClass = 'eod';
        let reason = '';
        let newsDriven = false;

        if (bar.l <= entryStop) {
          exitPrice = entryStop;
          exitClass = 'stop-loss';
          reason = `Hard stop 1%: bar low hit stop ${fmtInr(entryStop)} (entry ${fmtInr(pos.entryPrice)}) — loss kept tiny by design`;
        } else if (bar.h >= takeProfit && !pos.ratchetArmed) {
          exitPrice = takeProfit;
          exitClass = 'take-profit';
          reason = `Take profit +${TP_PCT * 100}% at ${fmtInr(takeProfit)} — banking the small certain gain`;
        } else if (pos.ratchetArmed && bar.l <= ratchetStop) {
          exitPrice = Math.max(entryStop, ratchetStop);
          exitClass = 'trail-stop';
          reason = `Profit ratchet: slipped ${(TRAIL_GIVEBACK_PCT * 100).toFixed(0)}% off high ${fmtInr(pos.highSince)} — keeping most of the gain`;
        } else if (newsNow.bearish.length > 0) {
          exitPrice = bar.c;
          exitClass = 'news-exit';
          newsDriven = true;
          reason = `NEWS exit on fresh bearish headline — "${newsNow.bearish[0].title.slice(0, 90)}"`;
        } else if (sig?.dir === 'SELL') {
          // Minimum hold: never let a one-bar flicker shake a fresh entry.
          // Protection exits (SL/TP/ratchet/news) stay live from bar one.
          if (i - pos.entryIdx >= MIN_HOLD_BARS) {
            exitPrice = bar.c;
            exitClass = 'signal-exit';
            reason = `Bearish exit signal — ${sig.why}`;
          }
        } else if (dayComplete && i === symBars!.length - 1) {
          exitPrice = bar.c;
          exitClass = 'eod';
          reason = 'EOD square-off: intraday only, no overnight holding';
        }

        if (exitPrice != null && exitPrice > 0) {
          closePosition(strat.id, pos, exitPrice, exitClass, reason, timeOf(bar.ts), newsDriven);
        }
      } else {
        // ---- NO POSITION: look for entry (benched / cooling / blacklisted
        // strategies sit out; trend + news filters keep it selective) ----
        if (learn && learn.paused.has(strat.id)) {
          learn.skips.paused += 1;
          continue;
        }
        if (learn && (learn.cooldown.get(strat.id) ?? 0) > 0) {
          learn.skips.cooldown += 1;
          continue;
        }
        // Daily circuit breaker: down -1.2% realised → no new risk today.
        if (learn && !learn.halted) {
          const dayRealized = Object.values(buckets).reduce((a, b) => a + b.realized, 0);
          if (dayRealized <= -INITIAL_CAPITAL * DAILY_STOP_PCT) {
            learn.halted = true;
          }
        }
        if (learn?.halted) {
          learn.skips.breaker += 1;
          continue;
        }
        if (buckets[strat.id].cash < 100) continue;

        let best: { symbol: string; price: number; why: string; barTs: number; newsDriven: boolean } | null = null;
        for (const [sym, bars] of dayBars) {
          if (i >= bars.length) continue;
          if (i === bars.length - 1) continue; // last bar: entry could never be held — skip
          if (learn && (learn.avoid.get(`${strat.id}|${sym}`) ?? 0) >= AVOID_STOPS) {
            learn.skips.avoid += 1;
            continue;
          }
          const bar = bars[i];
          // Session-drift gate: don't start new longs in a name already down
          // badly on the day — falling knives bleed win rate.
          if (learn && bars[0].o > 0) {
            const drift = ((bar.c / bars[0].o) - 1) * 100;
            if (drift < DRIFT_GATE_PCT) {
              learn.skips.drift += 1;
              continue;
            }
          }
          const sig = signalFor(strat.id, bars.slice(0, i + 1));
          if (sig?.dir !== 'BUY') continue;
          // Confirmation: the same signal must also have fired on the
          // previous bar — one-bar flickers are ignored.
          if (i >= 1) {
            const prevSig = signalFor(strat.id, bars.slice(0, i));
            if (prevSig?.dir !== 'BUY') {
              if (learn) learn.skips.unconfirmed += 1;
              continue;
            }
          }
          // Trend confluence: never buy a falling knife. Close must hold
          // above SMA20 (or the session open while SMA20 warms up).
          if (learn) {
            const closes = bars.slice(0, i + 1).map((b) => b.c);
            const s20 = sma(closes, 20);
            const ref = s20[s20.length - 1];
            const trendOk = Number.isNaN(ref) ? bar.c > bars[0].o : bar.c > ref;
            if (!trendOk) {
              learn.skips.trend += 1;
              continue;
            }
            // No chasing: RSI above the ceiling means the move is crowded.
            const r14 = rsi(closes, 14);
            const cur = r14[r14.length - 1];
            if (!Number.isNaN(cur) && cur > RSI_CEIL) {
              learn.skips.chase += 1;
              continue;
            }
            // Real participation: entry bar volume must beat its 10-bar average.
            const vols = bars.slice(Math.max(0, i - 9), i + 1).map((b) => b.v);
            const avgV = vols.reduce((a, v) => a + v, 0) / Math.max(1, vols.length);
            if (avgV > 0 && bar.v < avgV * VOL_MULT) {
              learn.skips.thin += 1;
              continue;
            }
          }
          // News fuse: fresh bearish headline blocks the entry outright.
          let newsDriven = false;
          let why = sig.why;
          if (learn) {
            const newsNow = freshNews(learn.news.get(sym), bar.ts);
            if (newsNow.bearish.length > 0) {
              learn.skips.news += 1;
              learn.newsDay.blocked += 1;
              continue;
            }
            if (newsNow.bullish.length > 0) {
              newsDriven = true;
              why = `${sig.why} + NEWS: "${newsNow.bullish[0].title.slice(0, 70)}"`;
            }
          }
          // Prefer the highest-priced stock (more liquid / stronger momentum)
          if (!best || bar.c > best.price) best = { symbol: sym, price: bar.c, why, barTs: bar.ts, newsDriven };
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
              ratchetArmed: false,
              entryIdx: i,
            });

            logTrade(strat.id, best.symbol, 'BUY', qty, price, 0, null, 'entry', `Entry: ${best.why}`, timeOf(best.barTs), best.newsDriven);
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

  // Newest-first ledger everywhere (today view + archive).
  trades.sort(byTimeDesc);

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
  const learning = loadLearn();
  const news = await loadNews();
  console.log(`paper-daily: brain has ${learning.history.length} sessions of memory · news items for ${news.size} symbols`);

  // Archive yesterday / any previous trading day once a NEW IST date shows up.
  // The full trade ledger is archived (newest-first) so every past day can
  // show all its trades, not just the P&L summary.
  const prev = store.today;
  if (prev && prev.date !== todayIST && (prev.trades.length > 0 || prev.status === 'closed')) {
    archiveDay(store, prev);
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

  // Backfill: replay past sessions so every archived day carries its full
  // trade ledger (PAPER_BACKFILL_DAYS=N, 0 = off). Replays are deterministic
  // and idempotent — re-running refreshes the same dates.
  const backfillN = Number(process.env.PAPER_BACKFILL_DAYS ?? 0);
  if (backfillN > 0) {
    await backfillPastSessions(symbols, store, universe, backfillN);
  }

  // Seed the brain: if fewer than a full window of memory, replay past
  // sessions WITH learning so weights/pauses/lessons exist from day one.
  if (learning.history.length < LEARN_WINDOW) {
    await seedLearning(symbols, learning, news, todayIST);
  }

  const todayUTC = Date.UTC(
    Number(todayIST.slice(0, 4)),
    Number(todayIST.slice(5, 7)) - 1,
    Number(todayIST.slice(8, 10)),
  );
  const sessionEnd = todayUTC + 10 * 60 * 60_000; // 15:30 IST = 10:00 UTC
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
    // The live brain trades today: weighted buckets, benched losers sit out,
    // news fuses with technicals.
    const rt = makeRuntime(learning, news);
    store.today = replayDay(todayIST, universe, liveBy, dayComplete, rt);
    const lessons = updateLearning(learning, todayIST, store.today.trades, rt);
    const actStrats = STRATEGIES.filter((s) => learning.strategies[s.id]?.status === 'active').map((s) => s.id);
    console.log(
      `paper-daily brain: active=[${actStrats.join(',')}] · ` +
        STRATEGIES.map((s) => `${s.id}:${learning.strategies[s.id]?.weight ?? 1}×`).join(' '),
    );
    for (const l of lessons.slice(-6)) console.log(`  lesson: ${l}`);
  }

  store.ts = new Date().toISOString();
  mkdirSync(join(process.cwd(), 'frontend', 'public', 'paper'), { recursive: true });
  writeFileSync(FILE, JSON.stringify(store));
  writeFileSync(LEARN_FILE, JSON.stringify(learning));

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

async function backfillPastSessions(
  symbols: string[],
  store: Store,
  todayUniverse: Map<string, Bar[]>,
  n: number,
): Promise<void> {
  // One range=1mo fetch per symbol covers ~22 sessions of 5m bars.
  const wide = new Map<string, Bar[]>();
  let cursor = 0;
  const worker = async () => {
    while (true) {
      const idx = cursor;
      cursor += 1;
      if (idx >= symbols.length) return;
      const symbol = symbols[idx];
      // Reuse today's bars when the wide fetch adds nothing (saves calls).
      const data = await intradayBars(symbol, '1mo');
      if (data && data.bars.length) wide.set(symbol, data.bars);
      else if (todayUniverse.get(symbol)?.length) wide.set(symbol, todayUniverse.get(symbol)!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(POOL_SIZE, symbols.length) }, worker));

  const todayISTbf = dayOf(Date.now());
  const dates = [...new Set([...wide.values()].flatMap((b) => b.map((x) => dayOf(x.ts))))]
    .sort()
    .filter((d) => d !== todayISTbf) // today is handled by the normal flow below
    .filter((d) => {
      let bars = 0;
      for (const barsOf of wide.values()) bars += barsOf.filter((x) => dayOf(x.ts) === d).length;
      return bars >= 20; // a real session, not a holiday stub
    })
    .slice(-n);

  const liveBy = new Map<string, number | null>();
  for (const d of dates) {
    const day = replayDay(d, wide, liveBy, true);
    if (day.trades.length > 0 || day.status === 'closed') {
      archiveDay(store, day);
      console.log(`paper-daily backfill: ${d} ${day.status} · ${day.trades.length} trades · dayPnl ${fmtInr(day.dayPnl)}`);
    }
  }
}

/**
 * Seed the brain by replaying past sessions THROUGH the learning loop, so
 * weights, pauses and lessons exist before the first live day. Day by day,
 * oldest first — exactly how live operation accumulates memory.
 */
async function seedLearning(
  symbols: string[],
  learning: LearnState,
  news: Map<string, NewsItem[]>,
  todayIST: string,
): Promise<void> {
  const need = LEARN_WINDOW - learning.history.length;
  if (need <= 0) return;
  console.log(`paper-daily brain: seeding ${need} sessions of memory…`);
  const wide = new Map<string, Bar[]>();
  let cursor = 0;
  const worker = async () => {
    while (true) {
      const idx = cursor;
      cursor += 1;
      if (idx >= symbols.length) return;
      const symbol = symbols[idx];
      const data = await intradayBars(symbol, '1mo');
      if (data && data.bars.length) wide.set(symbol, data.bars);
    }
  };
  await Promise.all(Array.from({ length: Math.min(POOL_SIZE, symbols.length) }, worker));

  const dates = [...new Set([...wide.values()].flatMap((b) => b.map((x) => dayOf(x.ts))))]
    .sort()
    .filter((d) => d !== todayIST)
    .filter((d) => {
      let bars = 0;
      for (const barsOf of wide.values()) bars += barsOf.filter((x) => dayOf(x.ts) === d).length;
      return bars >= 20;
    })
    .slice(-need);

  const liveBy = new Map<string, number | null>();
  for (const d of dates) {
    const rt = makeRuntime(learning, news);
    const day = replayDay(d, wide, liveBy, true, rt);
    const lessons = updateLearning(learning, d, day.trades, rt);
    const wr = day.wins + day.losses > 0 ? Math.round((day.wins / (day.wins + day.losses)) * 100) : 0;
    const mix = Object.entries(rt.exitMix).map(([k, v]) => `${k}:${v}`).join(' ');
    console.log(`  seed ${d}: ${day.trades.length} trades · win ${wr}% · dayPnl ${fmtInr(day.dayPnl)} · exits{${mix}}${rt.halted ? ' · HALTED' : ''} · ${lessons.length} lessons`);
  }
  console.log(`paper-daily brain: seeded, memory=${learning.history.length} sessions`);
}

main().catch((e) => {
  console.error('paper-daily failed:', e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
