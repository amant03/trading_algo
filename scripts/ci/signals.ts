// Signal history generator — produces /signals.json for every covered stock.
//
// This is a CI-only, headless script that runs once per nightly automation
// cycle and writes frontend/public/signals.json. The deployed Vercel frontend
// reads this file so every covered stock shows a full signal history — even
// stocks that aren't in the 52-stock NIFTY-50 DB universe (like DLF, LODHA,
// ZYDUSLIFE, etc.).
//
// How it works:
//   1. Reads the covered stock universe from analysis.json
//      (SEED + nightly batch + carried = 300+ symbols).
//   2. Fetches 200 daily bars (~10 months) from Yahoo Finance for each.
//   3. Runs the same 8 strategies the algorithm-engine uses (ma_cross,
//      rsi_reversal, macd_cross, bb_breakout, supertrend, stoch_cross,
//      vwap_reversion, donchian_breakout) on the daily bar window.
//   4. Writes a signals.json keyed by symbol — the frontend falls back to
//      this file when the live API doesn't have signals for a stock.
//
// No DB, no Kafka, no services — pure Yahoo Finance + indicator math.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import {
  sma,
  rsi,
  macd,
  bollinger,
  supertrend,
  stochastic,
  atr,
  clamp,
  round2,
} from '@trading/shared';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
const BARS = 200;
const COOLDOWN_DAYS = 4;
const POOL_SIZE = 8;
const OUT_FILE = join(process.cwd(), 'frontend', 'public', 'signals.json');
const ANALYSIS_FILE = join(process.cwd(), 'frontend', 'public', 'analysis.json');

interface YahooBar {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface Signal {
  id: string;
  symbol: string;
  strategy: string;
  direction: 'BUY' | 'SELL';
  price: number;
  strength: number;
  reason: string;
  indicatorSnapshot: Record<string, number | string | null>;
  ts: number;
}

const STRATEGIES = [
  { strategy: 'ma_cross', params: { fast: 20, slow: 50 } },
  { strategy: 'rsi_reversal', params: { period: 14, oversold: 30, overbought: 70 } },
  { strategy: 'macd_cross', params: { fast: 12, slow: 26, signal: 9 } },
  { strategy: 'bb_breakout', params: { period: 20, mult: 2 } },
  { strategy: 'supertrend', params: { period: 10, mult: 3 } },
  { strategy: 'stoch_cross', params: { kPeriod: 14, dPeriod: 3, oversold: 20, overbought: 80 } },
  { strategy: 'vwap_reversion', params: { lookback: 60, bufferPct: 0.05 } },
  { strategy: 'donchian_breakout', params: { period: 20 } },
];

function loadUniverse(): string[] {
  const symbols = new Set<string>();
  // SEED first (the52 NIFTY-50 names from instruments-data)
  try {
    const instruments = JSON.parse(
      readFileSync(join(process.cwd(), 'services', 'shared', 'src', 'instruments-data.ts'), 'utf8'),
    );
    // The file is TypeScript; extract symbols via regex
    const matches = instruments.matchAll(/symbol:\s*'([^']+)'/g);
    for (const m of matches) symbols.add(m[1]);
  } catch { /* skip */ }
  // Then every covered symbol in analysis.json
  if (existsSync(ANALYSIS_FILE)) {
    try {
      const analysis = JSON.parse(readFileSync(ANALYSIS_FILE, 'utf8'));
      if (analysis.stocks) {
        for (const sym of Object.keys(analysis.stocks)) {
          if (sym) symbols.add(sym);
        }
      }
    } catch { /* skip */ }
  }
  return [...symbols].sort();
}

async function fetchDaily(symbol: string): Promise<YahooBar[]> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}.NS?interval=1d&range=${BARS}d`,
      { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15_000) },
    );
    if (!res.ok) return [];
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
    const bars: YahooBar[] = [];
    for (let i = 0; i < ts.length; i++) {
      const o = q?.open?.[i];
      const h = q?.high?.[i];
      const l = q?.low?.[i];
      const c = q?.close?.[i];
      const v = q?.volume?.[i];
      if (typeof o !== 'number' || typeof h !== 'number' || typeof l !== 'number' || typeof c !== 'number') continue;
      if (!isFinite(o) || !isFinite(h) || !isFinite(l) || !isFinite(c)) continue;
      if (o <= 0 || h <= 0 || l <= 0 || c <= 0) continue;
      bars.push({ ts: ts[i] * 1000, open: o, high: h, low: l, close: c, volume: typeof v === 'number' ? v : 0 });
    }
    return bars;
  } catch {
    return [];
  }
}

// ---- indicator helpers (same as engine.ts) ----------------------------------

function computeIndicators(closes: number[], ohlc: { high: number; low: number; close: number }[]) {
  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const rsi14 = rsi(closes, 14);
  const macdLine = macd(closes, 12, 26, 9).map((m) => m.histogram);
  const boll = bollinger(closes, 20, 2);
  const atrs = atr(ohlc, 14);
  const stoch = stochastic(ohlc, 14, 3, 3);
  const st = supertrend(ohlc, 10, 3);

  const lastNum = (arr: number[]) => (Number.isNaN(arr[arr.length - 1]) ? null : round2(arr[arr.length - 1]));
  const lb = boll[boll.length - 1] as { upper: number; middle: number; lower: number } | undefined;
  const lk = stoch[stoch.length - 1] as { k: number; d: number } | undefined;
  const lSt = st[st.length - 1] as { line: number; direction: 'up' | 'down' } | undefined;

  const snapshot: Record<string, number | string | null> = {
    price: closes[closes.length - 1],
    sma20: lastNum(sma20),
    sma50: lastNum(sma50),
    rsi14: lastNum(rsi14),
    macdHist: lastNum(macdLine),
    bollUpper: lb ? round2(lb.upper) : null,
    bollLower: lb ? round2(lb.lower) : null,
    atr: lastNum(atrs),
    stochK: lk ? round2(lk.k) : null,
    stochD: lk ? round2(lk.d) : null,
    supertrend: lSt ? round2(lSt.line) : null,
    supertrendDir: lSt?.direction ?? null,
  };

  return { sma20, sma50, rsi14, macdLine, boll, atrs, stoch, st, snapshot };
}

function evaluateStrategy(
  strategy: string,
  params: Record<string, number | boolean | string>,
  bars: YahooBar[],
  closes: number[],
  ind: ReturnType<typeof computeIndicators>,
): { direction: 'BUY' | 'SELL'; strength: number; reason: string } | null {
  const last = bars[bars.length - 1];
  const prev = bars[bars.length - 2];
  const movePct = ((last.close - prev.close) / prev.close) * 100;
  const strength = (base: number): number =>
    clamp(Math.round(base + Math.abs(movePct) * 12 + ((ind.snapshot.atr as number) ?? 0) * 2), 5, 99);

  switch (strategy) {
    case 'ma_cross': {
      const fast = Number(params.fast ?? 20);
      const slow = Number(params.slow ?? 50);
      const fArr = sma(closes, fast);
      const sArr = sma(closes, slow);
      const pF = fArr[fArr.length - 2];
      const pS = sArr[sArr.length - 2];
      const cF = fArr[fArr.length - 1];
      const cS = sArr[sArr.length - 1];
      if (Number.isNaN(pF) || Number.isNaN(pS) || Number.isNaN(cF) || Number.isNaN(cS)) return null;
      if (pF <= pS && cF > cS) return { direction: 'BUY', strength: strength(55), reason: `Golden cross: SMA${fast} crossed above SMA${slow}` };
      if (pF >= pS && cF < cS) return { direction: 'SELL', strength: strength(55), reason: `Death cross: SMA${fast} crossed below SMA${slow}` };
      return null;
    }
    case 'rsi_reversal': {
      const period = Number(params.period ?? 14);
      const oversold = Number(params.oversold ?? 30);
      const overbought = Number(params.overbought ?? 70);
      const r = rsi(closes, period);
      const p = r[r.length - 2];
      const c = r[r.length - 1];
      if (Number.isNaN(p) || Number.isNaN(c)) return null;
      if (p <= oversold && c > oversold) return { direction: 'BUY', strength: strength(70), reason: `RSI(${period}) ${c.toFixed(1)} rebounded out of oversold` };
      if (p >= overbought && c < overbought) return { direction: 'SELL', strength: strength(70), reason: `RSI(${period}) ${c.toFixed(1)} fell out of overbought` };
      return null;
    }
    case 'macd_cross': {
      const fast = Number(params.fast ?? 12);
      const slow = Number(params.slow ?? 26);
      const sig = Number(params.signal ?? 9);
      const line = macd(closes, fast, slow, sig);
      const p = line[line.length - 2].histogram;
      const c = line[line.length - 1].histogram;
      if (Number.isNaN(p) || Number.isNaN(c)) return null;
      if (p <= 0 && c > 0) return { direction: 'BUY', strength: strength(55), reason: 'MACD histogram turned positive (bullish cross)' };
      if (p >= 0 && c < 0) return { direction: 'SELL', strength: strength(55), reason: 'MACD histogram turned negative (bearish cross)' };
      return null;
    }
    case 'bb_breakout': {
      const period = Number(params.period ?? 20);
      const mult = Number(params.mult ?? 2);
      const bb = bollinger(closes, period, mult);
      const pB = bb[bb.length - 2];
      const cB = bb[bb.length - 1];
      if (Number.isNaN(pB.upper) || Number.isNaN(cB.upper)) return null;
      if (prev.close <= pB.upper && last.close > cB.upper) return { direction: 'BUY', strength: strength(60), reason: `Close broke above upper Bollinger band (${mult}x std dev)` };
      if (prev.close >= pB.lower && last.close < cB.lower) return { direction: 'SELL', strength: strength(60), reason: `Close broke below lower Bollinger band (${mult}x std dev)` };
      return null;
    }
    case 'supertrend': {
      const period = Number(params.period ?? 10);
      const mult = Number(params.mult ?? 3);
      const ohlcArr = bars.map((b) => ({ high: b.high, low: b.low, close: b.close }));
      const st = supertrend(ohlcArr, period, mult);
      const p = st[st.length - 2];
      const c = st[st.length - 1];
      if (Number.isNaN(p.line) || Number.isNaN(c.line)) return null;
      if (p.direction === 'down' && c.direction === 'up') return { direction: 'BUY', strength: strength(65), reason: 'SuperTrend flipped to UP (trend reversal bullish)' };
      if (p.direction === 'up' && c.direction === 'down') return { direction: 'SELL', strength: strength(65), reason: 'SuperTrend flipped to DOWN (trend reversal bearish)' };
      return null;
    }
    case 'stoch_cross': {
      const oversold = Number(params.oversold ?? 20);
      const overbought = Number(params.overbought ?? 80);
      const s = ind.stoch;
      const p = s[s.length - 2] as { k: number; d: number };
      const c = s[s.length - 1] as { k: number; d: number };
      if (!p || !c || Number.isNaN(p.k) || Number.isNaN(p.d) || Number.isNaN(c.k) || Number.isNaN(c.d)) return null;
      if (p.k <= p.d && c.k > c.d && c.k < oversold + 15) return { direction: 'BUY', strength: strength(60), reason: `Stochastic %K crossed above %D from oversold (${c.k.toFixed(1)})` };
      if (p.k >= p.d && c.k < c.d && c.k > overbought - 15) return { direction: 'SELL', strength: strength(60), reason: `Stochastic %K crossed below %D from overbought (${c.k.toFixed(1)})` };
      return null;
    }
    case 'vwap_reversion': {
      const lookback = Math.min(Number(params.lookback ?? 60), bars.length - 1);
      const bufferPct = Number(params.bufferPct ?? 0.05);
      let pv = 0;
      let v = 0;
      for (let i = bars.length - lookback - 1; i < bars.length; i++) {
        const b = bars[i];
        const tp = (b.high + b.low + b.close) / 3;
        pv += tp * b.volume;
        v += b.volume;
      }
      if (!v) return null;
      const vwap = pv / v;
      const buf = vwap * (bufferPct / 100);
      if (prev.close < vwap - buf && last.close > vwap) return { direction: 'BUY', strength: strength(62), reason: `Price reclaimed VWAP ${vwap.toFixed(2)} from below` };
      if (prev.close > vwap + buf && last.close < vwap) return { direction: 'SELL', strength: strength(62), reason: `Price lost VWAP ${vwap.toFixed(2)} from above` };
      return null;
    }
    case 'donchian_breakout': {
      const period = Math.min(Number(params.period ?? 20), bars.length - 1);
      let hi = -Infinity;
      let lo = Infinity;
      for (let i = bars.length - period - 1; i < bars.length - 1; i++) {
        hi = Math.max(hi, bars[i].high);
        lo = Math.min(lo, bars[i].low);
      }
      if (last.close > hi) return { direction: 'BUY', strength: strength(64), reason: `Donchian breakout: close above ${period}-bar high ${hi.toFixed(2)}` };
      if (last.close < lo) return { direction: 'SELL', strength: strength(64), reason: `Donchian breakdown: close below ${period}-bar low ${lo.toFixed(2)}` };
      return null;
    }
    default:
      return null;
  }
}

function generateSignals(symbol: string, bars: YahooBar[]): Signal[] {
  if (bars.length < 60) return [];
  const closes = bars.map((b) => b.close);
  const signals: Signal[] = [];
  const cooldowns = new Map<string, number>(); // strategy -> last signal ts

  for (let i = 50; i < bars.length; i++) {
    const window = bars.slice(0, i + 1);
    const windowCloses = closes.slice(0, i + 1);
    const ind = computeIndicators(windowCloses, window.map((b) => ({ high: b.high, low: b.low, close: b.close })));

    for (const strat of STRATEGIES) {
      const result = evaluateStrategy(strat.strategy, strat.params, window, windowCloses, ind);
      if (!result) continue;

      const lastTs = cooldowns.get(strat.strategy) ?? 0;
      if (bars[i].ts - lastTs < COOLDOWN_DAYS * 86_400_000) continue;

      cooldowns.set(strat.strategy, bars[i].ts);
      signals.push({
        id: `${symbol}-${strat.strategy}-${bars[i].ts}`,
        symbol,
        strategy: strat.strategy,
        direction: result.direction,
        price: bars[i].close,
        strength: result.strength,
        reason: result.reason,
        indicatorSnapshot: ind.snapshot,
        ts: bars[i].ts,
      });
    }
  }

  return signals;
}

async function main(): Promise<void> {
  const universe = loadUniverse();
  console.log(`signals: universe ${universe.length} symbols`);

  // Load existing signals.json to carry forward any symbols we don't re-fetch
  let existing: Record<string, Signal[]> = {};
  if (existsSync(OUT_FILE)) {
    try {
      const raw = JSON.parse(readFileSync(OUT_FILE, 'utf8'));
      if (raw?.symbols) existing = raw.symbols;
    } catch { /* skip */ }
  }

  const result: Record<string, Signal[]> = {};
  let done = 0;
  let withSignals = 0;
  let totalSignals = 0;

  // Pooled fetch
  let cursor = 0;
  const fetched = new Map<string, YahooBar[]>();
  const worker = async () => {
    while (true) {
      const idx = cursor;
      cursor += 1;
      if (idx >= universe.length) return;
      const sym = universe[idx];
      const bars = await fetchDaily(sym);
      if (bars.length) fetched.set(sym, bars);
    }
  };
  await Promise.all(Array.from({ length: Math.min(POOL_SIZE, universe.length) }, worker));

  // Generate signals for each fetched symbol
  for (const [sym, bars] of fetched) {
    const sigs = generateSignals(sym, bars);
    if (sigs.length) {
      result[sym] = sigs;
      withSignals += 1;
      totalSignals += sigs.length;
    }
    done += 1;
  }

  // Carry forward symbols we didn't fetch (e.g., BSE-only) from previous run
  for (const [sym, sigs] of Object.entries(existing)) {
    if (!result[sym] && sigs.length) {
      result[sym] = sigs;
      withSignals += 1;
      totalSignals += sigs.length;
    }
  }

  mkdirSync(join(process.cwd(), 'frontend', 'public'), { recursive: true });
  writeFileSync(
    OUT_FILE,
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      symbols: Object.keys(result).length,
      totalSignals,
      data: result,
    }),
  );

  console.log(
    `signals: ${done}/${universe.length} fetched · ${withSignals} symbols with signals · ${totalSignals} total signals written`,
  );
}

main().catch((e) => {
  console.error('signals failed:', e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
