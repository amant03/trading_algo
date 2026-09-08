// Client-side technical indicators over OHLCV rows (from /api/chart).
// Everything is pure and array-based so it can run freely in the browser
// without shipping a heavy charting/numerics dependency.

export interface RowLike {
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export type Series = (number | null)[];

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Simple moving average. Returns nulls for the first `period - 1` slots. */
export function sma(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = round2(sum / period);
  }
  return out;
}

/** Exponential moving average (seeded with the SMA of the first `period`). */
export function ema(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  if (values.length < period) return out;
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i];
  let prev = seed / period;
  out[period - 1] = round2(prev);
  const k = 2 / (period + 1);
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = round2(prev);
  }
  return out;
}

/** Wilder's RSI (14). */
export function rsi(values: number[], period = 14): Series {
  const out: Series = new Array(values.length).fill(null);
  if (values.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = round2(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = round2(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }
  return out;
}

/** MACD (12, 26, 9). Returns { line, signal, hist }. */
export function macd(values: number[], fast = 12, slow = 26, signal = 9): { line: Series; signal: Series; hist: Series } {
  const f = ema(values, fast);
  const s = ema(values, slow);
  const line: Series = new Array(values.length).fill(null);
  const usable: number[] = [];
  for (let i = 0; i < values.length; i++) {
    if (f[i] != null && s[i] != null) {
      line[i] = round2(f[i]! - s[i]!);
      usable.push(round2(f[i]! - s[i]!));
    }
  }
  const sigValues = ema(usable, signal);
  const outSig: Series = new Array(values.length).fill(null);
  const hist: Series = new Array(values.length).fill(null);
  let j = 0;
  for (let i = 0; i < values.length; i++) {
    if (line[i] != null) {
      outSig[i] = sigValues[j];
      hist[i] = round2(line[i]! - (sigValues[j] ?? 0));
      j += 1;
    }
  }
  return { line, signal: outSig, hist };
}

/** Bollinger Bands (20, 2). Returns { upper, middle, lower }. */
export function bollinger(values: number[], period = 20, mult = 2): { upper: Series; middle: Series; lower: Series } {
  const middle = sma(values, period);
  const upper: Series = new Array(values.length).fill(null);
  const lower: Series = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    const slice = values.slice(i - period + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
    const sd = Math.sqrt(variance);
    upper[i] = round2(mean + mult * sd);
    lower[i] = round2(mean - mult * sd);
  }
  return { upper, middle, lower };
}

/** Average True Range (Wilder, 14). */
export function atr(rows: RowLike[], period = 14): Series {
  const out: Series = new Array(rows.length).fill(null);
  if (rows.length < period + 1) return out;
  const trs: number[] = [];
  for (let i = 1; i < rows.length; i++) {
    const high = rows[i].h;
    const low = rows[i].l;
    const prevClose = rows[i - 1].c;
    trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  let prev = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period] = round2(prev);
  for (let i = period; i < trs.length; i++) {
    prev = (prev * (period - 1) + trs[i]) / period;
    out[i + 1] = round2(prev);
  }
  return out;
}

/** Stochastic (14, 3, 3). Returns { k, d }. */
export function stochastic(rows: RowLike[], period = 14, kSmooth = 3, dSmooth = 3): { k: Series; d: Series } {
  const rawK: number[] = new Array(rows.length).fill(0);
  for (let i = 0; i < rows.length; i++) {
    if (i < period - 1) {
      rawK[i] = 50;
      continue;
    }
    const slice = rows.slice(i - period + 1, i + 1);
    const hh = Math.max(...slice.map((r) => r.h));
    const ll = Math.min(...slice.map((r) => r.l));
    rawK[i] = hh === ll ? 50 : ((rows[i].c - ll) / (hh - ll)) * 100;
  }
  const k = sma(rawK, kSmooth);
  const kVals = k.map((v) => v ?? 50);
  const d = sma(kVals, dSmooth);
  return { k, d };
}

/** Supertrend (ATR 14, factor 3). Returns { line, dir } with dir in {-1, +1}. */
export function supertrend(rows: RowLike[], period = 14, factor = 3): { line: Series; dir: Series } {
  const a = atr(rows, period);
  const line: Series = new Array(rows.length).fill(null);
  const dir: Series = new Array(rows.length).fill(null);
  if (rows.length < period + 1) return { line, dir };
  let trend: 1 | -1 = 1;
  let fPrevUpper: number | null = null;
  let fPrevLower: number | null = null;
  for (let i = period; i < rows.length; i++) {
    const snr = a[i] ?? a[i - 1] ?? 0;
    const mid = (rows[i].h + rows[i].l) / 2;
    const upper = mid + factor * snr;
    const lower = mid - factor * snr;
    const fUpper: number = fPrevUpper == null || upper < fPrevUpper ? upper : fPrevUpper;
    const fLower: number = fPrevLower == null || lower > fPrevLower ? lower : fPrevLower;
    if (fPrevUpper != null && rows[i].c > fPrevUpper) trend = 1;
    else if (fPrevLower != null && rows[i].c < fPrevLower) trend = -1;
    line[i] = trend === 1 ? fLower : fUpper;
    dir[i] = trend;
    fPrevUpper = fUpper;
    fPrevLower = fLower;
  }
  return { line, dir };
}

/** Volume-weighted average price over all rows. */
export function vwap(rows: RowLike[]): number {
  const tv = rows.reduce((a, r) => a + r.c * r.v, 0);
  const v = rows.reduce((a, r) => a + r.v, 0);
  return v > 0 ? round2(tv / v) : 0;
}

export function prevIs(values: Series, i: number, cmp: (v: number) => boolean): boolean {
  if (i <= 0) return false;
  const v = values[i - 1];
  return v != null && cmp(v);
}

export type Bias = 'bullish' | 'bearish' | 'neutral';

export function rsiBias(v: number | null | undefined): Bias {
  if (v == null) return 'neutral';
  if (v >= 65) return 'bullish';
  if (v <= 35) return 'bearish';
  return 'neutral';
}

export function macdBias(line: number | null | undefined, sig: number | null | undefined): Bias {
  if (line == null || sig == null) return 'neutral';
  if (line > sig) return 'bullish';
  if (line < sig) return 'bearish';
  return 'neutral';
}

export function trendBias(c: number, sma50: number | null | undefined, sma200: number | null | undefined): Bias {
  if (sma50 == null && sma200 == null) return 'neutral';
  if (sma50 != null && sma200 != null) return c > sma50 && sma50 > sma200 ? 'bullish' : c < sma50 && sma50 < sma200 ? 'bearish' : 'neutral';
  if (sma50 != null) return c > sma50 ? 'bullish' : 'bearish';
  return c > (sma200 ?? c) ? 'bullish' : 'bearish';
}