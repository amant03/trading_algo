export interface OHLC {
  high: number;
  low: number;
  close: number;
}

/** Simple moving average. Returns array aligned with input, NaN-padded at the front. */
export function sma(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** Exponential moving average (seeded with SMA). */
export function ema(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i];
  out[period - 1] = seed / period;
  for (let i = period; i < values.length; i++) {
    out[i] = values[i] * k + out[i - 1] * (1 - k);
  }
  return out;
}

/** Relative Strength Index (Wilder smoothing). */
export function rsi(values: number[], period = 14): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  if (values.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const ch = values[i] - values[i - 1];
    if (ch >= 0) gain += ch;
    else loss -= ch;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < values.length; i++) {
    const ch = values[i] - values[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(ch, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-ch, 0)) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

export interface MacdPoint {
  macd: number;
  signal: number;
  histogram: number;
}

export function macd(values: number[], fast = 12, slow = 26, signalPeriod = 9): MacdPoint[] {
  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);
  const line = values.map((_, i) => (Number.isNaN(emaFast[i]) || Number.isNaN(emaSlow[i]) ? NaN : emaFast[i] - emaSlow[i]));
  const signal = ema(line, signalPeriod);
  const out: MacdPoint[] = line.map((l, i) => {
    const s = signal[i];
    return { macd: l, signal: s, histogram: Number.isNaN(l) || Number.isNaN(s) ? NaN : l - s };
  });
  return out;
}

export interface BollingerBand {
  upper: number;
  middle: number;
  lower: number;
}

export function bollinger(values: number[], period = 20, mult = 2): BollingerBand[] {
  const middle = sma(values, period);
  const out: BollingerBand[] = new Array(values.length);
  for (let i = 0; i < values.length; i++) {
    if (Number.isNaN(middle[i])) {
      out[i] = { upper: NaN, middle: NaN, lower: NaN };
      continue;
    }
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) variance += (values[j] - middle[i]) ** 2;
    const sd = Math.sqrt(variance / period);
    out[i] = { upper: middle[i] + mult * sd, middle: middle[i], lower: middle[i] - mult * sd };
  }
  return out;
}

/** Average True Range (Wilder). */
export function atr(candles: OHLC[], period = 14): number[] {
  const out = new Array<number>(candles.length).fill(NaN);
  if (candles.length <= period) return out;
  const tr: number[] = new Array(candles.length);
  for (let i = 1; i < candles.length; i++) {
    const h = candles[i].high;
    const l = candles[i].low;
    const pc = candles[i - 1].close;
    tr[i] = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  }
  tr[0] = candles[0].high - candles[0].low;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += tr[i + 1] ?? tr[0];
  out[period] = sum / period;
  for (let i = period + 1; i < candles.length; i++) {
    out[i] = (out[i - 1] * (period - 1) + tr[i]) / period;
  }
  return out;
}

export interface StochPoint {
  k: number;
  d: number;
}

export function stochastic(
  candles: OHLC[],
  period = 14,
  smoothK = 3,
  smoothD = 3,
): StochPoint[] {
  const out: StochPoint[] = new Array(candles.length);
  for (let i = 0; i < candles.length; i++) {
    if (i < period - 1) {
      out[i] = { k: NaN, d: NaN };
      continue;
    }
    let ll = Infinity;
    let hh = -Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      ll = Math.min(ll, candles[j].low);
      hh = Math.max(hh, candles[j].high);
    }
    out[i] = { k: hh === ll ? 50 : ((candles[i].close - ll) / (hh - ll)) * 100, d: NaN };
  }
  // smooth K
  const kRaw = out.map((p) => p.k);
  const kSmooth = sma(kRaw.map((v) => (Number.isNaN(v) ? 0 : v)).slice(), smoothK);
  for (let i = 0; i < candles.length; i++) {
    const offset = smoothK - 1;
    out[i].k = i >= offset && !Number.isNaN(kSmooth[i - offset]) ? kSmooth[i - offset] : NaN;
  }
  // D = SMA of K
  const kArr = out.map((p) => (Number.isNaN(p.k) ? NaN : p.k));
  const dArr = sma(kArr, smoothD);
  for (let i = 0; i < candles.length; i++) out[i].d = dArr[i];
  return out;
}

export interface SuperTrendPoint {
  line: number;
  direction: 'up' | 'down';
}

export function supertrend(candles: OHLC[], period = 10, multiplier = 3): SuperTrendPoint[] {
  const out: SuperTrendPoint[] = new Array(candles.length);
  const atrs = atr(candles, period);
  let prevFinalUpper = NaN;
  let prevFinalLower = NaN;
  let prevDirection: 'up' | 'down' = 'up';
  let prevClose = NaN;

  for (let i = 0; i < candles.length; i++) {
    const close = candles[i].close;
    if (i < period || Number.isNaN(atrs[i])) {
      out[i] = { line: NaN, direction: 'up' };
      prevFinalUpper = NaN;
      prevFinalLower = NaN;
      prevDirection = 'up';
      prevClose = close;
      continue;
    }
    const hl2 = (candles[i].high + candles[i].low) / 2;
    let finalUpper = hl2 + multiplier * atrs[i];
    let finalLower = hl2 - multiplier * atrs[i];

    if (!Number.isNaN(prevFinalUpper)) {
      if (finalUpper < prevFinalUpper || prevClose > prevFinalUpper) finalUpper = prevFinalUpper;
      if (finalLower > prevFinalLower || prevClose < prevFinalLower) finalLower = prevFinalLower;
    }

    let direction: 'up' | 'down';
    let line: number;
    if (prevDirection === 'up') {
      direction = close < finalLower ? 'down' : 'up';
      line = direction === 'up' ? finalLower : finalUpper;
    } else {
      direction = close > finalUpper ? 'up' : 'down';
      line = direction === 'down' ? finalUpper : finalLower;
    }

    out[i] = { line, direction };
    prevFinalUpper = finalUpper;
    prevFinalLower = finalLower;
    prevDirection = direction;
    prevClose = close;
  }
  return out;
}

export function last<T>(arr: T[]): T | undefined {
  return arr[arr.length - 1];
}

export function finite<T>(v: T): v is T {
  return v !== null && v !== undefined && (typeof v !== 'number' || !Number.isNaN(v));
}
