import {
  pool,
  query,
  logger,
  consumeTopic,
  TOPICS,
  dbReady,
  kafkaReady,
  Signal,
  Order,
  Snapshot,
} from '@trading/shared';
import { PaperBroker } from './engine.js';

async function loadSymbolMap(): Promise<Map<number, string>> {
  const res = await query<{ id: number; symbol: string }>(
    "SELECT id, symbol FROM instruments WHERE status = 'ACTIVE'",
  );
  return new Map(res.rows.map((r) => [Number(r.id), r.symbol]));
}

async function loadLatestPrices(): Promise<Map<number, number>> {
  const res = await query<{ instrument_id: number; close: number }>(
    `SELECT DISTINCT ON (instrument_id) instrument_id, close
     FROM candles WHERE timeframe = '1m'
     ORDER BY instrument_id, ts DESC`,
  );
  return new Map(res.rows.map((r) => [Number(r.instrument_id), Number(r.close)]));
}

async function main(): Promise<void> {
  logger.info('executor service starting...');
  if (!(await dbReady())) throw new Error('PostgreSQL unavailable');
  if (!(await kafkaReady())) throw new Error('Kafka unavailable');

  const broker = new PaperBroker();
  broker.setSymbols(await loadSymbolMap());
  await broker.init();

  const prices = await loadLatestPrices();
  for (const [id, price] of prices) broker.lastPrices.set(id, price);
  logger.info({ priced: prices.size }, 'last prices loaded');

  await Promise.all([
    consumeTopic<Signal>(TOPICS.signals, 'executor-signals', async (signals) => {
      for (const s of signals) {
        try {
          await broker.onSignal(s);
        } catch (err) {
          logger.warn({ err: (err as Error).message, symbol: s.symbol, strategy: s.strategy }, 'signal execution failed');
        }
      }
    }, { eachBatch: false, heartbeatInterval: 3000 }),

    consumeTopic<Order>(TOPICS.orders, 'executor-orders', async (orders) => {
      for (const o of orders) {
        try {
          await broker.onOrder(o);
        } catch (err) {
          logger.warn({ err: (err as Error).message, symbol: o.symbol, id: o.id }, 'manual order failed');
        }
      }
    }, { eachBatch: false, heartbeatInterval: 3000 }),

    consumeTopic<Snapshot>(TOPICS.snapshots, 'executor-snapshots', async (snaps) => {
      for (const s of snaps) broker.applySnapshot(s);
      await broker.maybeSaveEquity();
    }, { eachBatch: true, heartbeatInterval: 3000 }),
  ]);

  const shutdown = async (): Promise<void> => {
    await broker.maybeSaveEquity(true);
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.error({ err: err as Error }, 'executor fatal');
  process.exit(1);
});