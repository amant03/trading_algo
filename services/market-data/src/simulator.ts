import {
  Instrument,
  Candle,
  Snapshot,
  SeededRng,
  Timeframe,
  round4,
} from '@trading/shared';

/** One market day is simulated as this many 1m bars (compressed for a lively demo). */
export const BARS_PER_DAY = 78;

const TICK_STEP = 0.005; // small micro-drift probability
const SPOCK_PROB = 0.006; // "news shock" probability per bar
const SPOCK_MULT = 4.2;

interface Accum {
  timeframe: Timeframe;
  size: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  ts: number;
  count: number;
}

export class InstrumentSimulator {
  readonly instrument: Instrument;
  private rng: SeededRng;

  price: number;
  prevClose: number;
  momentum = 0;
  dayOpen = 0;
  dayHigh = 0;
  dayLow = 0;
  dayVolume = 0;
  dayBarCount = 0;

  private volPerBar: number;
  private avgDailyVolume: number;
  private accumulators: Map<Timeframe, Accum>;

  constructor(instrument: Instrument, seed: number) {
    this.instrument = instrument;
    this.rng = new SeededRng(seed);
    this.price = instrument.basePrice;
    this.prevClose = instrument.basePrice;
    this.dayOpen = instrument.basePrice;
    this.dayHigh = instrument.basePrice;
    this.dayLow = instrument.basePrice;

    const shares = instrument.marketCap ? (instrument.marketCap * 1e7) / instrument.basePrice : 5e8;
    this.avgDailyVolume = Math.max(50_000, shares * 0.004);
    this.volPerBar = (instrument.volatility / Math.sqrt(BARS_PER_DAY)) * 0.45;

    this.accumulators = new Map();
    this.resetDayAccumulators();
  }

  private resetDayAccumulators(): void {
    this.accumulators.clear();
    const sizes: [Timeframe, number][] = [
      ['5m', 5],
      ['15m', 15],
      ['1h', 60],
      ['1d', BARS_PER_DAY],
    ];
    for (const [tf, size] of sizes) {
      this.accumulators.set(tf, {
        timeframe: tf,
        size,
        open: this.dayOpen,
        high: this.dayHigh,
        low: this.dayLow,
        close: this.price,
        volume: 0,
        ts: Date.now(),
        count: 0,
      });
    }
  }

  /** Advance one bar, producing closed candles + a market snapshot. */
  step(ts: number): { closed: Candle[]; snapshot: Snapshot } {
    const inst = this.instrument;
    const rng = this.rng;
    const prevPrice = this.price;

    let ret = this.momentum * 0.55 + this.volPerBar * rng.gauss(0, 1);
    // mean-revert toward the previous close (intraday anchor)
    ret += ((this.prevClose - this.price) / this.price) * 0.04;
    if (rng.next() < SPOCK_PROB) ret += this.volPerBar * SPOCK_MULT * (rng.bool() ? 1 : -1);
    if (rng.next() < TICK_STEP) ret += this.volPerBar * 2 * (rng.bool() ? 1 : -1);

    this.momentum = this.momentum * 0.78 + ret * 0.22;
    let next = this.price * (1 + ret);
    next = Math.max(next, this.prevClose * 0.8);
    next = Math.min(next, this.prevClose * 1.2);
    next = Math.round(next / inst.tickSize) * inst.tickSize;
    this.price = round4(next);

    const vol = Math.round(
      (this.avgDailyVolume / BARS_PER_DAY) *
        (0.5 + rng.range(0, 1)) *
        (1 + (Math.abs(ret) / this.volPerBar) * 0.6),
    );

    // ---- update day statistics ----
    if (this.dayBarCount === 0) {
      this.dayOpen = this.price;
      this.dayHigh = this.price;
      this.dayLow = this.price;
    }
    this.dayHigh = Math.max(this.dayHigh, this.price);
    this.dayLow = Math.min(this.dayLow, this.price);
    this.dayVolume += vol;
    this.dayBarCount += 1;

    // ---- the 1m bar (open = previous price, high/low from the step) ----
    const oneMin: Candle = {
      instrumentId: inst.id,
      symbol: inst.symbol,
      timeframe: '1m',
      ts,
      open: round4(prevPrice),
      high: round4(Math.max(prevPrice, this.price)),
      low: round4(Math.min(prevPrice, this.price)),
      close: this.price,
      volume: vol,
    };

    const closed: Candle[] = [];
    closed.push(oneMin);

    // ---- feed aggregates with the closed 1m bar ----
    for (const acc of this.accumulators.values()) {
      if (acc.count === 0) {
        acc.open = oneMin.open;
        acc.high = oneMin.high;
        acc.low = oneMin.low;
        acc.close = oneMin.close;
        acc.volume = oneMin.volume;
        acc.ts = oneMin.ts;
      } else {
        acc.high = Math.max(acc.high, oneMin.high);
        acc.low = Math.min(acc.low, oneMin.low);
        acc.close = oneMin.close;
        acc.volume += oneMin.volume;
      }
      acc.count += 1;
      if (acc.count >= acc.size) {
        closed.push({
          instrumentId: inst.id,
          symbol: inst.symbol,
          timeframe: acc.timeframe,
          ts: oneMin.ts,
          open: acc.open,
          high: acc.high,
          low: acc.low,
          close: acc.close,
          volume: acc.volume,
        });
        // start next aggregate bar
        acc.open = oneMin.close;
        acc.high = oneMin.close;
        acc.low = oneMin.close;
        acc.close = oneMin.close;
        acc.volume = 0;
        acc.count = 0;
        acc.ts = oneMin.ts;
      }
    }

    // ---- day roll-over ----
    if (this.dayBarCount >= BARS_PER_DAY) {
      this.prevClose = this.price;
      this.dayBarCount = 0;
      this.dayVolume = 0;
      this.momentum = 0;
      this.resetDayAccumulators();
      // open the new day at current price
      this.dayOpen = this.price;
      this.dayHigh = this.price;
      this.dayLow = this.price;
    }

    const snapshot: Snapshot = {
      instrumentId: inst.id,
      symbol: inst.symbol,
      price: this.price,
      prevClose: this.prevClose,
      change: round4(this.price - this.prevClose),
      changePct: round4(((this.price - this.prevClose) / this.prevClose) * 100),
      dayOpen: this.dayOpen,
      dayHigh: this.dayHigh,
      dayLow: this.dayLow,
      dayVolume: this.dayVolume,
      ts,
    };

    return { closed, snapshot };
  }
}
