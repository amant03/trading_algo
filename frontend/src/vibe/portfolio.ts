import type { Bar } from './engine';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sampleStd(values: number[]): number | null {
  if (values.length < 5) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((acc, value) => acc + (value - mean) ** 2, 0) / (values.length - 1);
  const std = Math.sqrt(variance);
  return std > 1e-8 ? std : null;
}

export function barReturns(bars: Bar[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1].c;
    if (prev > 0 && Number.isFinite(bars[i].c)) out.push(bars[i].c / prev - 1);
  }
  return out;
}

function normalize(weights: number[]): number[] {
  const sum = weights.reduce((acc, value) => acc + value, 0);
  if (!(sum > 0)) return weights.map(() => 1 / weights.length);
  return weights.map((value) => value / sum);
}

function covariance(series: number[][]): number[][] | null {
  const length = Math.min(...series.map((row) => row.length));
  if (length < 8) return null;
  const aligned = series.map((row) => row.slice(row.length - length));
  const means = aligned.map((row) => row.reduce((a, b) => a + b, 0) / length);
  const n = aligned.length;
  const matrix = aligned.map(() => aligned.map(() => 0));
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      let acc = 0;
      for (let t = 0; t < length; t++) acc += (aligned[i][t] - means[i]) * (aligned[j][t] - means[j]);
      const value = acc / (length - 1);
      matrix[i][j] = value;
      matrix[j][i] = value;
    }
  }
  return matrix;
}

function solveOnes(matrix: number[][]): number[] | null {
  const n = matrix.length;
  const a = matrix.map((row, i) => [...row, 1]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    if (Math.abs(a[pivot][col]) < 1e-12) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    const scale = a[col][col];
    for (let j = col; j <= n; j++) a[col][j] /= scale;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = a[row][col];
      for (let j = col; j <= n; j++) a[row][j] -= factor * a[col][j];
    }
  }
  return a.map((row) => row[n]);
}

export interface Books {
  equal: number[];
  invVol: number[];
  minVar: number[];
}

/** Equal weight, volatility parity, and minimum variance. Weights sum to 1. */
export function portfolioBooks(series: number[][]): Books {
  const n = series.length;
  const equal = Array.from({ length: n }, () => 1 / n);
  const vols = series.map((row) => sampleStd(row));
  const invVol = vols.every((vol) => vol != null) ? normalize(vols.map((vol) => 1 / (vol as number))) : equal;
  const cov = covariance(series);
  const solved = cov ? solveOnes(cov) : null;
  const minVar = solved && solved.every((weight) => Number.isFinite(weight)) ? normalize(solved.map((weight) => Math.max(weight, 0) || 0)) : equal;
  const usable = minVar.some((weight) => weight > 0) ? normalize(minVar) : equal;
  return { equal, invVol, minVar: usable };
}

export interface Band {
  low: number;
  median: number;
  high: number;
}

/** Bootstrap the equity path's daily returns. The band is terminal return, not a promise. */
export function monteCarlo(equity: number[], draws = 400): Band | null {
  if (equity.length < 8) return null;
  const rets: number[] = [];
  for (let i = 1; i < equity.length; i++) {
    if (equity[i - 1] > 0 && Number.isFinite(equity[i])) rets.push(equity[i] / equity[i - 1] - 1);
  }
  if (rets.length < 8) return null;
  const rnd = mulberry32(rets.length * 1000 + Math.round(rets[0] * 1e6));
  const terminals: number[] = [];
  for (let draw = 0; draw < draws; draw++) {
    let value = 1;
    for (let i = 0; i < rets.length; i++) value *= 1 + rets[Math.floor(rnd() * rets.length)];
    terminals.push(value - 1);
  }
  terminals.sort((a, b) => a - b);
  return {
    low: terminals[Math.floor(draws * 0.05)],
    median: terminals[Math.floor(draws * 0.5)],
    high: terminals[Math.floor(draws * 0.95)],
  };
}
