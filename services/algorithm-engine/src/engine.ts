import {
  AlgorithmConfig,
  Candle,
  Signal,
  clamp,
  round2,
  sma,
  ema,
  rsi,
  macd,
  bollinger,
  atr,
  stochastic,
  supertrend,
} from '@trading/shared';

export const DEFAULT_CONFIGS: AlgorithmConfig[] = [
  { strategy: 'ma_cross', enabled: true, params: { fast: 20, slow: 50 } },
  { strategy: 'rsi_reversal', enabled: true, params: { period: 14, oversold: 30, overbought: 70 } },
  { strategy: 'macd_cross', enabled: true, params: { fast: 12, slow: 26, signal: 9 } },
  { strategy: 'bb_breakout', enabled: true, params: { period: 20, mult: 2 } },
  { strategy: 'supertrend', enabled: true, params: { period: 10, mult: 3 } },
  { strategy: 'stoch_cross', enabled: true, params: { kPeriod: 14, dPeriod: 3, oversold: 20, overbought: 80 } },
  { strategy: 'vwap_reversion', enabled: true, params: { lookback: 60, bufferPct: 0.05 } },
  { strategy: 'donchian_breakout', enabled: true, params: { period: 20 } },
];

interface StrategyResult {
  direction: 'BUY' | 'SELL';
  strength: number;
  reason: string;
}

const WINDOW = 300;
const COOLDOWN_BARS = 4;

interface InstrumentMeta {
  id: number;
  symbol: string;
}

interface StrategyState {
  lastSignalBarTs: number;
  signalCount: number;
}

export class AlgorithmEngine {
  private windows = new Map<number, Candle[]>();
  private states = new Map<string, StrategyState>();
  private configs: Map<string, AlgorithmConfig> = new Map(
    DEFAULT_CONFIGS.map((c) => [c.strategy, c]),
  );
  private instruments = new Map<number, InstrumentMeta>();
  totalSignals = 0;

  setInstruments(instruments: InstrumentMeta[]): void {
    this.instruments = new Map(instruments.map((i) => [i.id, i]));
  }

  setConfigs(configs: AlgorithmConfig[]): void {
    const map = new Map<string, AlgorithmConfig>();
    for (const def of DEFAULT_CONFIGS) map.set(def.strategy, def);
    for (const c of configs) if (map.has(c.strategy)) map.set(c.strategy, c);
    this.configs = map;
  }

  getConfigs(): AlgorithmConfig[] {
    return [...this.configs.values()];
  }

  warmup(candlesByInstrument: Map<number, Candle[]>): void {
    for (const [id, candles] of candlesByInstrument) {
      const sorted = [...candles].sort((a, b) => a.ts - b.ts);
      this.windows.set(id, sorted.slice(-WINDOW));
    }
  }

  onCandle(candle: Candle): Signal[] {
    if (candle.timeframe !== '1m') return [];
    const window = this.windows.get(candle.instrumentId);
    if (!window) return [];
    if (window.length && window[window.length - 1].ts === candle.ts) {
      window[window.length - 1] = candle;
    } else {
      window.push(candle);
      if (window.length > WINDOW) window.shift();
    }
    if (window.length < 60) return [];

    const inst = this.instruments.get(candle.instrumentId);
    if (!inst) return [];

    const indicators = this.computeIndicators(window);
    const signals: Signal[] = [];

    for (const cfg of this.configs.values()) {
      if (!cfg.enabled) continue;
      const result = this.evaluateStrategy(cfg.strategy, cfg.params, window, indicators);
      if (!result) continue;

      const key = `${candle.instrumentId}:${cfg.strategy}`;
      const st = this.states.get(key);
      if (st && candle.ts - st.lastSignalBarTs < COOLDOWN_BARS * 3000) continue;

      const signal: Signal = {
        id: 0,
        instrumentId: candle.instrumentId,
        symbol: inst.symbol,
        strategy: cfg.strategy,
        direction: result.direction,
        price: candle.close,
        strength: result.strength,
        reason: result.reason,
        indicatorSnapshot: indicators.snapshot,
        ts: candle.ts,
      };
      this.states.set(key, {
        lastSignalBarTs: candle.ts,
        signalCount: (st?.signalCount ?? 0) + 1,
      });
      this.totalSignals += 1;
      signals.push(signal);
    }
    return signals;
  }

  private computeIndicators(window: Candle[]): {
    sma20: number[];
    sma50: number[];
    rsi14: number[];
    macdLine: number[];
    boll: ReturnType<typeof bollinger>;
    atrs: number[];
    stoch: ReturnType<typeof stochastic>;
    st: ReturnType<typeof supertrend>;
    snapshot: Record<string, number | string | null>;
  } {
    const closes = window.map((c) => c.close);
    const ohlc = window.map((c) => ({ high: c.high, low: c.low, close: c.close }));
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
      price: window[window.length - 1].close,
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

  private evaluateStrategy(
    strategy: string,
    params: Record<string, number | boolean | string>,
    window: Candle[],
    ind: ReturnType<AlgorithmEngine['computeIndicators']>,
  ): StrategyResult | null {
    const last = window[window.length - 1];
    const prev = window[window.length - 2];
    const closes = window.map((c) => c.close);
    const movePct = ((last.close - prev.close) / prev.close) * 100;

    const strength = (base: number): number =>
      clamp(Math.round(base + Math.abs(movePct) * 12 + (ind.snapshot.atr as number ?? 0) * 2), 5, 99);

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
        if (p <= oversold && c > oversold) return { direction: 'BUY', strength: strength(70 + Math.round((oversold - c) * -1)), reason: `RSI(${period}) ${c.toFixed(1)} rebounded out of oversold` };
        if (p >= overbought && c < overbought) return { direction: 'SELL', strength: strength(70 + Math.round(c - overbought)), reason: `RSI(${period}) ${c.toFixed(1)} fell out of overbought` };
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
        if (p <= 0 && c > 0) return { direction: 'BUY', strength: strength(55), reason: `MACD histogram turned positive (bullish cross)` };
        if (p >= 0 && c < 0) return { direction: 'SELL', strength: strength(55), reason: `MACD histogram turned negative (bearish cross)` };
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
        const ohlc = window.map((c) => ({ high: c.high, low: c.low, close: c.close }));
        const st = supertrend(ohlc, period, mult);
        const p = st[st.length - 2];
        const c = st[st.length - 1];
        if (Number.isNaN(p.line) || Number.isNaN(c.line)) return null;
        if (p.direction === 'down' && c.direction === 'up') return { direction: 'BUY', strength: strength(65), reason: `SuperTrend flipped to UP (trend reversal bullish)` };
        if (p.direction === 'up' && c.direction === 'down') return { direction: 'SELL', strength: strength(65), reason: `SuperTrend flipped to DOWN (trend reversal bearish)` };
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
        const lookback = Math.min(Number(params.lookback ?? 60), window.length - 1);
        const bufferPct = Number(params.bufferPct ?? 0.05);
        let pv = 0;
        let v = 0;
        for (let i = window.length - lookback - 1; i < window.length; i++) {
          const b = window[i];
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
        const period = Math.min(Number(params.period ?? 20), window.length - 1);
        let hi = -Infinity;
        let lo = Infinity;
        for (let i = window.length - period - 1; i < window.length - 1; i++) {
          hi = Math.max(hi, window[i].high);
          lo = Math.min(lo, window[i].low);
        }
        if (last.close > hi) return { direction: 'BUY', strength: strength(64), reason: `Donchian breakout: close above ${period}-bar high ${hi.toFixed(2)}` };
        if (last.close < lo) return { direction: 'SELL', strength: strength(64), reason: `Donchian breakdown: close below ${period}-bar low ${lo.toFixed(2)}` };
        return null;
      }
      default:
        return null;
    }
  }
}
