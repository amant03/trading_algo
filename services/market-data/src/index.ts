import {
  pool,
  query,
  logger,
  publishBatch,
  TOPICS,
  INSTRUMENTS,
  config,
  kafkaReady,
  dbReady,
  Candle,
  Snapshot,
  Tick,
  Instrument,
  Side,
  round4,
} from '@trading/shared';
import { InstrumentSimulator } from './simulator.js';
import { backfillInstruments, insertCandles } from './backfill.js';

const TARGET_INDEX = 24700;

async function seedAndLoadInstruments(): Promise<Instrument[]> {
  const count = (await query('SELECT COUNT(*)::int AS c FROM instruments')).rows[0].c;
  if (count === 0) {
    logger.info({ count: INSTRUMENTS.length }, 'seeding instruments');
  }
  for (const s of INSTRUMENTS) {
    await query(
      `INSERT INTO instruments (symbol, name, exchange, segment, sector, industry, base_price, lot_size, tick_size, market_cap, volatility)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (symbol) DO UPDATE SET
         name = EXCLUDED.name, sector = EXCLUDED.sector, industry = EXCLUDED.industry,
         base_price = EXCLUDED.base_price, market_cap = EXCLUDED.market_cap, volatility = EXCLUDED.volatility`,
      [s.symbol, s.name, s.exchange, s.segment, s.sector, s.industry, s.basePrice, s.lotSize, 0.05, s.marketCapCr, s.volatility],
    );
  }
  const res = await query<{
    id: number;
    symbol: string;
    name: string;
    exchange: string;
    segment: string;
    sector: string | null;
    industry: string | null;
    base_price: number;
    lot_size: number;
    tick_size: number;
    market_cap: number | null;
    volatility: number;
  }>(
    `SELECT id, symbol, name, exchange, segment, sector, industry, base_price, lot_size, tick_size, market_cap, volatility
     FROM instruments WHERE status = 'ACTIVE' ORDER BY id`,
  );
  return res.rows.map((r) => ({
    id: r.id,
    symbol: r.symbol,
    name: r.name,
    exchange: r.exchange,
    segment: r.segment,
    sector: r.sector,
    industry: r.industry,
    basePrice: Number(r.base_price),
    lotSize: Number(r.lot_size),
    tickSize: Number(r.tick_size),
    marketCap: r.market_cap == null ? null : Number(r.market_cap),
    volatility: Number(r.volatility),
  }));
}

function computeIndexScale(instruments: Instrument[]): number {
  let num = 0;
  let den = 0;
  for (const inst of instruments) {
    const mc = inst.marketCap ?? 1;
    num += mc * inst.basePrice;
    den += mc;
  }
  const baseline = num / den;
  return TARGET_INDEX / baseline;
}

function makeIndexSnapshot(snaps: Snapshot[], instruments: Instrument[], scale: number): Snapshot {
  let num = 0;
  let den = 0;
  let numPrev = 0;
  for (const s of snaps) {
    const inst = instruments.find((i) => i.id === s.instrumentId);
    if (!inst) continue;
    const mc = inst.marketCap ?? 1;
    num += mc * s.price;
    numPrev += mc * s.prevClose;
    den += mc;
  }
  const price = (num / den) * scale;
  const prev = (numPrev / den) * scale;
  return {
    instrumentId: 0,
    symbol: 'NIFTY50',
    price: round4(price),
    prevClose: round4(prev),
    change: round4(price - prev),
    changePct: round4(((price - prev) / prev) * 100),
    dayOpen: round4(prev),
    dayHigh: round4(Math.max(price, prev)),
    dayLow: round4(Math.min(price, prev)),
    dayVolume: 0,
    ts: Date.now(),
  };
}

async function main(): Promise<void> {
  logger.info('market-data service starting...');

  const dbOk = await dbReady();
  if (!dbOk) throw new Error('PostgreSQL unavailable');
  logger.info('PostgreSQL connected');

  const kafkaOk = await kafkaReady();
  if (!kafkaOk) throw new Error('Kafka unavailable');
  logger.info('Kafka connected');

  const instruments = await seedAndLoadInstruments();
  await backfillInstruments(instruments);
  const scale = computeIndexScale(instruments);

  const simulators = instruments.map((inst) => new InstrumentSimulator(inst, config.sim.seed + inst.id * 9973));

  logger.info({ instruments: instruments.length, intervalSec: config.sim.candleIntervalSec }, 'starting live market simulation');

  let lastFlush = Date.now();
  const pendingCandles: Candle[] = [];

  const tick = async (): Promise<void> => {
    const now = Date.now();
    const candles: Candle[] = [];
    const ticks: Tick[] = [];
    const snaps: Snapshot[] = [];

    for (const sim of simulators) {
      const { closed, snapshot } = sim.step(now);
      candles.push(...closed);
      ticks.push({
        instrumentId: snapshot.instrumentId,
        symbol: snapshot.symbol,
        ts: now,
        price: snapshot.price,
        volume: 0,
        side: snapshot.change >= 0 ? ('BUY' as Side) : ('SELL' as Side),
      });
      snaps.push(snapshot);
    }
    snaps.push(makeIndexSnapshot(snaps, instruments, scale));
    pendingCandles.push(...candles);

    try {
      const tasks: Promise<void>[] = [
        publishBatch(TOPICS.candles, candles.map((c) => ({ payload: c, key: c.symbol }))),
        publishBatch(TOPICS.ticks, ticks.map((t) => ({ payload: t, key: t.symbol }))),
        publishBatch(TOPICS.snapshots, snaps.map((s) => ({ payload: s, key: s.symbol }))),
      ];
      await Promise.all(tasks);

      if (now - lastFlush >= 3000) {
        lastFlush = now;
        const batch = pendingCandles.splice(0, pendingCandles.length);
        if (batch.length) await insertCandles(batch);
      }
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'market-data tick error');
    }
  };

  const timer = setInterval(() => {
    tick().catch((err) => logger.error({ err: (err as Error).message }, 'tick failed'));
  }, config.sim.candleIntervalSec * 1000);
  // fire one immediately
  await tick();

  const shutdown = async (): Promise<void> => {
    clearInterval(timer);
    logger.info('flushing remaining candles');
    if (pendingCandles.length) await insertCandles(pendingCandles.splice(0));
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.error({ err: err as Error }, 'market-data fatal');
  process.exit(1);
});
