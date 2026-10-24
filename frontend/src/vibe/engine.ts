// Research engine for the Vibe-Trading desk.
//
// Metric definitions follow HKUDS/Vibe-Trading (MIT), agent/backtest/metrics.py:
// equity is seeded with cash before the first bar, Sharpe uses sample std
// (ddof=1), Sortino uses a zero-target downside RMS over every return, max
// drawdown's high-water mark cannot sit below starting cash, and annualisation
// is bars observed per calendar year. Fills happen on the next bar's open.
// A 10 bps fee is charged on each side and shown on the run card.
//
// Parameter search scores the training window only. The last 30% of bars is a
// holdout. A candidate is adopted only when that holdout clears a fixed gate.
// The holdout is never the objective.

import { DESK, type DeskInstrument } from './markets';

export interface Bar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export type StrategyId = 'ma_cross' | 'rsi_reversal' | 'macd_cross' | 'donchian' | 'buy_hold';

export interface Params {
  fast: number;
  slow: number;
  signal: number;
  period: number;
  oversold: number;
  overbought: number;
}

export interface RoundTrip {
  entryBar: number;
  exitBar: number;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  holdingBars: number;
}

export interface Metrics {
  finalValue: number;
  totalReturn: number;
  annualReturn: number;
  sharpe: number;
  sortino: number;
  maxDrawdown: number;
  calmar: number;
  winRate: number;
  profitFactor: number | null;
  trades: number;
  barsPerYear: number;
}

export interface Run {
  metrics: Metrics;
  equity: number[];
  trades: RoundTrip[];
}

export interface Generation {
  gen: number;
  params: Params;
  trainSharpe: number;
  trainReturn: number;
  trades: number;
  accepted: boolean;
}

export interface Improvement {
  status: 'ok' | 'too_short';
  strategy: StrategyId;
  seed: Params;
  candidate: Params;
  adopted: Params;
  accepted: boolean;
  reason: string;
  overfit: boolean;
  trainSeed: Run;
  trainCandidate: Run;
  testSeed: Run;
  testCandidate: Run;
  testBenchmark: Run;
  generations: Generation[];
}

export const FEE = 0.001;
export const INITIAL_CASH = 100_000;
const MIN_BARS = 80;

export const STRATEGY_LABEL: Record<StrategyId, string> = {
  ma_cross: 'Moving-average cross',
  rsi_reversal: 'RSI mean reversion',
  macd_cross: 'MACD cross',
  donchian: 'Donchian breakout',
  buy_hold: 'Buy and hold',
};

export function defaultParams(strategy: StrategyId): Params {
  if (strategy === 'rsi_reversal') {
    return { fast: 20, slow: 50, signal: 9, period: 14, oversold: 30, overbought: 70 };
  }
  if (strategy === 'macd_cross') {
    return { fast: 12, slow: 26, signal: 9, period: 20, oversold: 30, overbought: 70 };
  }
  if (strategy === 'donchian') {
    return { fast: 20, slow: 50, signal: 9, period: 20, oversold: 30, overbought: 70 };
  }
  return { fast: 20, slow: 50, signal: 9, period: 20, oversold: 30, overbought: 70 };
}

export function paramsLabel(strategy: StrategyId, p: Params): string {
  if (strategy === 'ma_cross') return `${p.fast}/${p.slow}`;
  if (strategy === 'rsi_reversal') return `${p.period} · ${p.oversold}/${p.overbought}`;
  if (strategy === 'macd_cross') return `${p.fast}/${p.slow}/${p.signal}`;
  if (strategy === 'donchian') return `${p.period}`;
  return 'hold';
}

function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period < 1) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period < 1 || values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  let prev = sum / period;
  out[period - 1] = prev;
  const k = 2 / (period + 1);
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

function rsi(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period < 1 || values.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

function macdSignal(values: number[], fast: number, slow: number, signal: number): { line: (number | null)[]; signal: (number | null)[] } {
  const f = ema(values, fast);
  const s = ema(values, slow);
  const line: (number | null)[] = new Array(values.length).fill(null);
  const dense: number[] = [];
  const denseAt: number[] = [];
  for (let i = 0; i < values.length; i++) {
    if (f[i] != null && s[i] != null) {
      line[i] = f[i]! - s[i]!;
      dense.push(line[i]!);
      denseAt.push(i);
    }
  }
  const sigDense = ema(dense, signal);
  const signalLine: (number | null)[] = new Array(values.length).fill(null);
  for (let i = 0; i < denseAt.length; i++) signalLine[denseAt[i]] = sigDense[i];
  return { line, signal: signalLine };
}

export function buildSignals(bars: Bar[], strategy: StrategyId, params: Params): number[] {
  const n = bars.length;
  const sig = new Array<number>(n).fill(0);
  if (strategy === 'buy_hold') return sig.fill(1);
  const closes = bars.map((b) => b.c);

  if (strategy === 'ma_cross') {
    const fast = Math.max(2, params.fast);
    const slow = Math.max(fast + 1, params.slow);
    const f = sma(closes, fast);
    const s = sma(closes, slow);
    for (let i = 0; i < n; i++) {
      if (f[i] != null && s[i] != null) sig[i] = f[i]! > s[i]! ? 1 : 0;
    }
    return sig;
  }

  if (strategy === 'rsi_reversal') {
    const period = Math.max(2, params.period);
    const r = rsi(closes, period);
    let long = 0;
    for (let i = 1; i < n; i++) {
      const prev = r[i - 1];
      const cur = r[i];
      if (prev == null || cur == null) {
        sig[i] = long;
        continue;
      }
      if (!long && prev <= params.oversold && cur > params.oversold) long = 1;
      if (long && prev >= params.overbought && cur < params.overbought) long = 0;
      sig[i] = long;
    }
    return sig;
  }

  if (strategy === 'macd_cross') {
    const fast = Math.max(2, params.fast);
    const slow = Math.max(fast + 1, params.slow);
    const { line, signal } = macdSignal(closes, fast, slow, Math.max(2, params.signal));
    for (let i = 0; i < n; i++) {
      if (line[i] != null && signal[i] != null) sig[i] = line[i]! > signal[i]! ? 1 : 0;
    }
    return sig;
  }

  const period = Math.max(2, params.period);
  let long = 0;
  for (let i = 0; i < n; i++) {
    if (i < period) {
      sig[i] = 0;
      continue;
    }
    let hh = -Infinity;
    let ll = Infinity;
    for (let j = i - period; j < i; j++) {
      if (bars[j].h > hh) hh = bars[j].h;
      if (bars[j].l < ll) ll = bars[j].l;
    }
    if (bars[i].c > hh) long = 1;
    else if (bars[i].c < ll) long = 0;
    sig[i] = long;
  }
  return sig;
}

function sampleStd(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const v = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(v);
}

export function barsPerYear(timestamps: number[], n: number): number {
  if (n <= 0) return 252;
  if (timestamps.length < 2) return 252;
  const calendarDays = (timestamps[timestamps.length - 1] - timestamps[0]) / 86400;
  const years = calendarDays >= 1 ? calendarDays / 365.25 : 1;
  const factor = Math.trunc(n / years);
  return factor > 0 ? factor : 252;
}

export function calcMetrics(equity: number[], initial: number, trades: RoundTrip[], timestamps: number[]): Metrics {
  const empty: Metrics = {
    finalValue: initial,
    totalReturn: 0,
    annualReturn: 0,
    sharpe: 0,
    sortino: 0,
    maxDrawdown: 0,
    calmar: 0,
    winRate: 0,
    profitFactor: trades.length ? null : 0,
    trades: trades.length,
    barsPerYear: 252,
  };
  if (!equity.length || !(initial > 0)) return empty;

  const n = equity.length;
  const bpy = barsPerYear(timestamps, n);
  const rets: number[] = new Array(n);
  rets[0] = equity[0] / initial - 1;
  let finite = Number.isFinite(rets[0]);
  for (let i = 1; i < n; i++) {
    const prev = equity[i - 1];
    rets[i] = prev > 0 ? equity[i] / prev - 1 : 0;
    if (!Number.isFinite(rets[i])) finite = false;
  }

  const finalValue = equity[n - 1];
  const totalReturn = finalValue / initial - 1;
  const growth = 1 + totalReturn;
  let annualReturn = -1;
  if (growth > 0) {
    const raw = growth ** (bpy / Math.max(n, 1)) - 1;
    annualReturn = Number.isFinite(raw) ? raw : Number.POSITIVE_INFINITY;
  }

  const vol = finite && n > 1 ? sampleStd(rets) : 0;
  let sharpe = finite ? (mean(rets) / (vol + 1e-10)) * Math.sqrt(bpy) : 0;
  if (!Number.isFinite(sharpe)) sharpe = 0;

  let peak = initial;
  let maxDrawdown = 0;
  for (const eq of equity) {
    peak = Math.max(peak, eq, initial);
    const dd = (eq - peak) / (peak === 0 ? 1 : peak);
    if (dd < maxDrawdown) maxDrawdown = dd;
  }

  let calmar = Math.abs(maxDrawdown) > 1e-10 ? annualReturn / Math.abs(maxDrawdown) : 0;
  if (!Number.isFinite(calmar)) calmar = 0;

  let sortino = 0;
  if (finite) {
    let downsideSq = 0;
    let neg = 0;
    for (const r of rets) {
      if (r < 0) {
        downsideSq += r * r;
        neg += 1;
      }
    }
    const downside = neg > 0 ? Math.sqrt(downsideSq / rets.length) : 1e-10;
    sortino = (mean(rets) / (downside + 1e-10)) * Math.sqrt(bpy);
    if (!Number.isFinite(sortino)) sortino = 0;
  }

  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl < 0);
  const winRate = trades.length ? wins.length / trades.length : 0;
  const grossProfit = wins.reduce((a, t) => a + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((a, t) => a + t.pnl, 0));
  const profitFactor = trades.length === 0 ? 0 : grossLoss > 1e-10 ? grossProfit / grossLoss : null;

  return {
    finalValue,
    totalReturn,
    annualReturn,
    sharpe,
    sortino,
    maxDrawdown,
    calmar,
    winRate,
    profitFactor,
    trades: trades.length,
    barsPerYear: bpy,
  };
}

function mean(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function backtest(bars: Bar[], strategy: StrategyId, params: Params, from = 0, to = bars.length): Run {
  const start = Math.max(0, from);
  const end = Math.min(bars.length, to);
  const signals = buildSignals(bars, strategy, params);
  const equity: number[] = [];
  const trades: RoundTrip[] = [];
  const stamps: number[] = [];
  let cash = INITIAL_CASH;
  let qty = 0;
  let position = 0;
  let desired = strategy === 'buy_hold' ? 1 : 0;
  let capitalAtEntry = 0;
  let entryPrice = 0;
  let entryBar = 0;

  for (let i = start; i < end; i++) {
    const open = bars[i].o;
    if (desired !== position && open > 0) {
      if (desired === 1 && position === 0 && cash > 0) {
        capitalAtEntry = cash;
        const fill = cash * (1 - FEE);
        qty = fill / open;
        cash = 0;
        position = 1;
        entryPrice = open;
        entryBar = i;
      } else if (desired === 0 && position === 1 && qty > 0) {
        cash = qty * open * (1 - FEE);
        trades.push({
          entryBar,
          exitBar: i,
          entryPrice,
          exitPrice: open,
          pnl: cash - capitalAtEntry,
          holdingBars: i - entryBar,
        });
        qty = 0;
        position = 0;
      }
    }
    const marked = cash + qty * bars[i].c;
    equity.push(marked);
    stamps.push(bars[i].t);
    desired = signals[i] ?? 0;
  }

  return { metrics: calcMetrics(equity, INITIAL_CASH, trades, stamps), equity: downsample(equity), trades };
}

function downsample(values: number[], max = 160): number[] {
  if (values.length <= max) return values.slice();
  const out: number[] = [];
  for (let i = 0; i < max; i++) {
    const idx = Math.round((i * (values.length - 1)) / (max - 1));
    out.push(values[idx]);
  }
  return out;
}

function score(run: Run): number {
  if (run.metrics.trades < 3) return -1e9;
  return run.metrics.sharpe - 0.5 * Math.abs(run.metrics.maxDrawdown);
}

function passesGate(run: Run): boolean {
  const m = run.metrics;
  return m.trades >= 3 && m.maxDrawdown > -0.45 && (m.sharpe > 0 || m.totalReturn > 0);
}

function repair(strategy: StrategyId, p: Params): Params {
  const next = { ...p };
  next.fast = clamp(Math.round(next.fast), 5, 40);
  next.slow = clamp(Math.round(next.slow), next.fast + 5, 160);
  next.signal = clamp(Math.round(next.signal), 3, 18);
  next.period = clamp(Math.round(next.period), strategy === 'rsi_reversal' ? 6 : 8, strategy === 'rsi_reversal' ? 28 : 80);
  next.oversold = clamp(Math.round(next.oversold), 15, 40);
  next.overbought = clamp(Math.round(next.overbought), 60, 85);
  if (next.oversold + 15 > next.overbought) next.overbought = clamp(next.oversold + 15, 60, 85);
  return next;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function sameParams(a: Params, b: Params, strategy: StrategyId): boolean {
  return paramsLabel(strategy, a) === paramsLabel(strategy, b);
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mutate(strategy: StrategyId, p: Params, rnd: () => number): Params {
  const next = { ...p };
  const step = () => (rnd() < 0.5 ? -1 : 1) * (1 + Math.floor(rnd() * 3));
  if (strategy === 'ma_cross') {
    if (rnd() < 0.5) next.fast += step();
    else next.slow += step() * 2;
  } else if (strategy === 'rsi_reversal') {
    const pick = rnd();
    if (pick < 0.34) next.period += Math.sign(step());
    else if (pick < 0.67) next.oversold += step();
    else next.overbought += step();
  } else if (strategy === 'macd_cross') {
    const pick = rnd();
    if (pick < 0.34) next.fast += Math.sign(step());
    else if (pick < 0.67) next.slow += step();
    else next.signal += Math.sign(step());
  } else {
    next.period += step();
  }
  return repair(strategy, next);
}

export function improve(bars: Bar[], strategy: StrategyId, seedInput?: Params, generations = 8): Improvement {
  const tradable: StrategyId = strategy === 'buy_hold' ? 'ma_cross' : strategy;
  const seed = repair(tradable, seedInput ?? defaultParams(tradable));
  const split = Math.floor(bars.length * 0.7);
  const bench = () => backtest(bars, 'buy_hold', seed, split, bars.length);

  if (bars.length < MIN_BARS || split < 40) {
    const full = backtest(bars, tradable, seed, 0, bars.length);
    const hold = backtest(bars, 'buy_hold', seed, 0, bars.length);
    return {
      status: 'too_short',
      strategy: tradable,
      seed,
      candidate: seed,
      adopted: seed,
      accepted: false,
      reason: `Need at least ${MIN_BARS} daily bars before a holdout can judge an improvement. This run is a full-sample backtest only.`,
      overfit: false,
      trainSeed: full,
      trainCandidate: full,
      testSeed: full,
      testCandidate: full,
      testBenchmark: hold,
      generations: [],
    };
  }

  let elite = seed;
  let eliteTrain = backtest(bars, tradable, elite, 0, split);
  let eliteScore = score(eliteTrain);
  const rnd = mulberry32(hashSeed(`${tradable}:${bars.length}:${bars[0]?.t ?? 0}:${paramsLabel(tradable, seed)}`));
  const gens: Generation[] = [
    {
      gen: 0,
      params: seed,
      trainSharpe: eliteTrain.metrics.sharpe,
      trainReturn: eliteTrain.metrics.totalReturn,
      trades: eliteTrain.metrics.trades,
      accepted: true,
    },
  ];

  for (let g = 1; g <= generations; g++) {
    let child = mutate(tradable, elite, rnd);
    if (sameParams(child, elite, tradable)) child = mutate(tradable, child, rnd);
    const train = backtest(bars, tradable, child, 0, split);
    const childScore = score(train);
    const accepted = childScore > eliteScore + 1e-6;
    gens.push({
      gen: g,
      params: child,
      trainSharpe: train.metrics.sharpe,
      trainReturn: train.metrics.totalReturn,
      trades: train.metrics.trades,
      accepted,
    });
    if (accepted) {
      elite = child;
      eliteTrain = train;
      eliteScore = childScore;
    }
  }

  const trainSeed = backtest(bars, tradable, seed, 0, split);
  const testSeed = backtest(bars, tradable, seed, split, bars.length);
  const testCandidate = backtest(bars, tradable, elite, split, bars.length);
  const testBenchmark = bench();
  const overfit = trainSeed.metrics.sharpe - testCandidate.metrics.sharpe > 1 || eliteTrain.metrics.sharpe - testCandidate.metrics.sharpe > 1;
  const unchanged = sameParams(elite, seed, tradable);
  const accepted = !unchanged && passesGate(testCandidate);
  let reason: string;
  if (unchanged) {
    reason = 'No neighbour beat the seed on the training window. The seed is unchanged.';
  } else if (!passesGate(testCandidate)) {
    reason = 'Training liked a new parameter set, and the holdout gate rejected it. The desk keeps the seed.';
  } else {
    reason = 'Training found a better parameter set, and the holdout still cleared the risk gate. That set is adopted.';
  }

  return {
    status: 'ok',
    strategy: tradable,
    seed,
    candidate: elite,
    adopted: accepted ? elite : seed,
    accepted,
    reason,
    overfit,
    trainSeed,
    trainCandidate: eliteTrain,
    testSeed,
    testCandidate,
    testBenchmark,
    generations: gens,
  };
}

export interface ParsedPrompt {
  ticker: string | null;
  strategy: StrategyId | null;
  instrument: DeskInstrument | null;
}

export function parsePrompt(text: string): ParsedPrompt {
  const raw = text.trim().toLowerCase();
  let instrument: DeskInstrument | null = null;
  if (raw) {
    let bestAt = Number.POSITIVE_INFINITY;
    let bestLen = -1;
    for (const item of DESK) {
      const keys = [item.ticker.toLowerCase(), item.label.toLowerCase(), ...item.aliases];
      for (const key of keys) {
        const at = raw.indexOf(key);
        if (at < 0) continue;
        if (at < bestAt || (at === bestAt && key.length > bestLen)) {
          bestAt = at;
          bestLen = key.length;
          instrument = item;
        }
      }
    }
  }
  let strategy: StrategyId | null = null;
  if (/\brsi\b|mean[- ]reversion|oversold/.test(raw)) strategy = 'rsi_reversal';
  else if (/macd/.test(raw)) strategy = 'macd_cross';
  else if (/donchian|breakout|channel/.test(raw)) strategy = 'donchian';
  else if (/moving average|\bma\b|golden cross|crossover|cross/.test(raw)) strategy = 'ma_cross';
  return { ticker: instrument?.ticker ?? null, strategy, instrument };
}

export interface ReturnSeries {
  dates: string[];
  rets: number[];
}

export function dailyReturns(bars: Bar[], dates: string[]): ReturnSeries {
  const byDate = new Map<string, number>();
  for (let i = 0; i < bars.length && i < dates.length; i++) byDate.set(dates[i], bars[i].c);
  const ordered = [...byDate.keys()].sort();
  const outDates: string[] = [];
  const rets: number[] = [];
  for (let i = 1; i < ordered.length; i++) {
    const prev = byDate.get(ordered[i - 1]);
    const cur = byDate.get(ordered[i]);
    if (prev == null || cur == null || !(prev > 0) || !Number.isFinite(cur)) continue;
    outDates.push(ordered[i]);
    rets.push(cur / prev - 1);
  }
  return { dates: outDates, rets };
}

/** Fraction of defined pairs whose correlation is at least `threshold`.
 *  Constant series stay undefined and are left out of the denominator.
 *  Returns null when no pair can be measured. */
export function edgeDensity(series: ReturnSeries[], threshold = 0.5): { density: number | null; defined: number; unknown: number } {
  let defined = 0;
  let edges = 0;
  let unknown = 0;
  for (let i = 0; i < series.length; i++) {
    for (let j = i + 1; j < series.length; j++) {
      const corr = pearsonAligned(series[i], series[j]);
      if (corr == null) unknown += 1;
      else {
        defined += 1;
        if (corr >= threshold) edges += 1;
      }
    }
  }
  return { density: defined === 0 ? null : edges / defined, defined, unknown };
}

function pearsonAligned(a: ReturnSeries, b: ReturnSeries): number | null {
  const bAt = new Map<string, number>();
  for (let i = 0; i < b.dates.length; i++) bAt.set(b.dates[i], b.rets[i]);
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < a.dates.length; i++) {
    const y = bAt.get(a.dates[i]);
    if (y == null) continue;
    xs.push(a.rets[i]);
    ys.push(y);
  }
  if (xs.length < 30) return null;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < xs.length; i++) {
    const vx = xs[i] - mx;
    const vy = ys[i] - my;
    num += vx * vy;
    dx += vx * vx;
    dy += vy * vy;
  }
  if (dx < 1e-12 || dy < 1e-12) return null;
  const corr = num / Math.sqrt(dx * dy);
  return Number.isFinite(corr) ? corr : null;
}
