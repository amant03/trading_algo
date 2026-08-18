import { Candle, Instrument, SeededRng, Timeframe, round4 } from '@trading/shared';
import { query } from '@trading/shared';
import { logger } from '@trading/shared';
import { BARS_PER_DAY } from './simulator.js';

const DAY_MS = 24 * 60 * 60 * 1000;

interface DailyPoint {
  ts: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

/** Generate `days` of deterministic daily candles that converge to the base price. */
function generateDaily(inst: Instrument, days: number, seed: number): DailyPoint[] {
  const rng = new SeededRng(seed);
  const returns: number[] = [];
  const vol = inst.volatility;
  for (let i = 0; i < days; i++) {
    const r = rng.gauss(0.0004, vol);
    returns.push(Math.abs(r) < 0.0005 ? r + 0.0005 * (rng.bool() ? 1 : -1) : r);
  }
  // multipliers such that the last close == basePrice
  const mult = new Array<number>(days + 1);
  mult[days] = 1;
  for (let i = days - 1; i >= 0; i--) mult[i] = mult[i + 1] / (1 + returns[i]);

  const anchor = Date.now() - 30 * 60 * 60 * 1000; // anchored "today 15:30"
  const out: DailyPoint[] = [];
  for (let i = 0; i < days; i++) {
    const price = inst.basePrice * mult[i + 1];
    const open = inst.basePrice * mult[i];
    const close = price;
    const range = Math.abs(rng.gauss(0.003, vol * 0.5));
    const high = Math.max(open, close) * (1 + range);
    const low = Math.min(open, close) * (1 - range * 0.9);
    const shares = (inst.marketCap ?? 1e6) * 1e7 / Math.max(price, 1);
    const volume = Math.round(shares * 0.004 * rng.range(0.5, 1.5) + 50_000);
    out.push({
      ts: anchor - (days - 1 - i) * DAY_MS,
      o: round4(open),
      h: round4(high),
      l: round4(low),
      c: round4(close),
      v: volume,
    });
  }
  return out;
}

/** Generate the trailing intraday 1m bars for chart history. */
function generateIntraday(inst: Instrument, seed: number, barsPerDay: number): DailyPoint[] {
  const rng = new SeededRng(seed ^ 0x9e3779b9);
  const base = inst.basePrice;
  const vol = (inst.volatility / Math.sqrt(barsPerDay)) * 0.45;
  const out: DailyPoint[] = [];
  const intervalMs = 3000;
  const now = Date.now();
  const count = barsPerDay * 3; // 3 compressed days of 1m bars
  let price = base * 0.985;
  for (let i = 0; i < count; i++) {
    const ret = vol * rng.gauss(0, 1) + ((base - price) / price) * 0.03;
    const prev = price;
    price = Math.max(price * (1 + ret), base * 0.9);
    price = Math.min(price, base * 1.1);
    price = Math.round(price / inst.tickSize) * inst.tickSize;
    const open = round4(prev);
    const close = round4(price);
    const hi = round4(Math.max(open, close) * (1 + Math.abs(rng.gauss(0, vol * 0.4))));
    const lo = round4(Math.min(open, close) * (1 - Math.abs(rng.gauss(0, vol * 0.4))));
    const volume = Math.round(
      (((inst.marketCap ?? 1e6) * 1e7 / Math.max(price, 1)) * 0.004 / barsPerDay) * rng.range(0.5, 1.5),
    );
    out.push({ ts: now - (count - 1 - i) * intervalMs, o: open, h: hi, l: lo, c: close, v: volume });
  }
  return out;
}

/** Aggregate 1m bars into a higher timeframe series. */
function aggregate(bars: DailyPoint[], size: number, tf: Timeframe): DailyPoint[] {
  const out: DailyPoint[] = [];
  for (let i = 0; i < bars.length; i += size) {
    const chunk = bars.slice(i, i + size);
    const first = chunk[0];
    let h = -Infinity;
    let l = Infinity;
    let v = 0;
    for (const b of chunk) {
      h = Math.max(h, b.h);
      l = Math.min(l, b.l);
      v += b.v;
    }
    out.push({ ts: chunk[chunk.length - 1].ts, o: first.o, h, l, c: chunk[chunk.length - 1].c, v });
  }
  return out;
}

async function insertCandles(rows: Candle[]): Promise<void> {
  if (!rows.length) return;
  const chunkSize = 500;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const params: (number | string)[] = [];
    const values = chunk
      .map((r, idx) => {
        const p = idx * 8;
        params.push(r.instrumentId, r.timeframe, r.ts, r.open, r.high, r.low, r.close, r.volume);
        return `($${p + 1}, $${p + 2}, to_timestamp($${p + 3}/1000.0), $${p + 4}, $${p + 5}, $${p + 6}, $${p + 7}, $${p + 8})`;
      })
      .join(',');
    await query(
      `INSERT INTO candles (instrument_id, timeframe, ts, open, high, low, close, volume)
       VALUES ${values}
       ON CONFLICT (instrument_id, timeframe, ts) DO UPDATE SET
         open = EXCLUDED.open, high = EXCLUDED.high, low = EXCLUDED.low,
         close = EXCLUDED.close, volume = EXCLUDED.volume`,
      params,
    );
  }
}

export async function backfillInstruments(instruments: Instrument[]): Promise<void> {
  logger.info({ count: instruments.length }, 'backfilling historical candles');
  const started = Date.now();
  let total = 0;
  for (const inst of instruments) {
    const seed = 1000 + inst.id * 7919;
    const daily = generateDaily(inst, 260, seed);
    const intraday1m = generateIntraday(inst, seed, BARS_PER_DAY);

    const rows: Candle[] = [];
    for (const d of daily) rows.push({ instrumentId: inst.id, symbol: inst.symbol, timeframe: '1d', ts: d.ts, open: d.o, high: d.h, low: d.l, close: d.c, volume: d.v });
    for (const m of intraday1m) rows.push({ instrumentId: inst.id, symbol: inst.symbol, timeframe: '1m', ts: m.ts, open: m.o, high: m.h, low: m.l, close: m.c, volume: m.v });
    for (const tf of [['5m', 5], ['15m', 15], ['1h', 60]] as [Timeframe, number][]) {
      for (const a of aggregate(intraday1m, tf[1], tf[0])) {
        rows.push({ instrumentId: inst.id, symbol: inst.symbol, timeframe: tf[0], ts: a.ts, open: a.o, high: a.h, low: a.l, close: a.c, volume: a.v });
      }
    }
    await insertCandles(rows);
    total += rows.length;
  }
  logger.info({ total, elapsedMs: Date.now() - started }, 'backfill complete');
}

export { insertCandles };
