import {
  pool,
  query,
  logger,
  consumeTopic,
  TOPICS,
  dbReady,
  kafkaReady,
  waitForCandles,
  Signal,
  Order,
  Snapshot,
} from '@trading/shared';
import { PaperBroker, LEGACY_ACCOUNT_ID } from './engine.js';

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

  const symbols = await loadSymbolMap();
  const brokers = new Map<number, PaperBroker>();

  /** Lazily get (or create) the broker for an account. Unknown accounts are refused. */
  async function getBroker(accountId: number): Promise<PaperBroker | null> {
    const existing = brokers.get(accountId);
    if (existing) return existing;
    let userId: number | null = null;
    if (accountId !== LEGACY_ACCOUNT_ID) {
      const acc = await query<{ id: number; user_id: number | null }>(
        'SELECT id, user_id FROM accounts WHERE id = $1',
        [accountId],
      );
      if (!acc.rows[0]) {
        logger.warn({ accountId }, 'order for unknown account — refusing');
        return null;
      }
      userId = acc.rows[0].user_id == null ? null : Number(acc.rows[0].user_id);
    }
    // Note: the legacy row itself is created by broker.init() on fresh DBs.
    const broker = new PaperBroker(accountId, userId);
    broker.setSymbols(symbols);
    await broker.init();
    // market-data backfills candles in parallel — wait so opening marks are real
    await waitForCandles(180_000, 50);
    const prices = await loadLatestPrices();
    for (const [id, price] of prices) broker.lastPrices.set(id, price);
    brokers.set(broker.accountId, broker);
    logger.info({ accountId: broker.accountId, userId: broker.userId }, 'paper broker initialised');
    return broker;
  }

  // Legacy global account keeps the pre-auth behaviour: algorithm signals
  // auto-trade here exactly as before. Per-user auto-trade toggles arrive
  // with the algorithm-builder UX (Phase 3).
  const legacy = await getBroker(LEGACY_ACCOUNT_ID);
  if (!legacy) throw new Error('legacy paper account missing and could not be created');

  await Promise.all([
    consumeTopic<Signal>(TOPICS.signals, 'executor-signals', async (signals) => {
      for (const s of signals) {
        try {
          await legacy.onSignal(s);
        } catch (err) {
          logger.warn({ err: (err as Error).message, symbol: s.symbol, strategy: s.strategy }, 'signal execution failed');
        }
      }
    }, { eachBatch: false, heartbeatInterval: 3000 }),

    consumeTopic<Order>(TOPICS.orders, 'executor-orders', async (orders) => {
      for (const o of orders) {
        try {
          const broker = o.accountId === LEGACY_ACCOUNT_ID ? legacy : await getBroker(o.accountId);
          if (!broker) continue;
          await broker.onOrder(o);
        } catch (err) {
          logger.warn({ err: (err as Error).message, symbol: o.symbol, id: o.id }, 'manual order failed');
        }
      }
    }, { eachBatch: false, heartbeatInterval: 3000 }),

    consumeTopic<Snapshot>(TOPICS.snapshots, 'executor-snapshots', async (snaps) => {
      for (const s of snaps) {
        for (const broker of brokers.values()) broker.applySnapshot(s);
      }
      for (const broker of brokers.values()) {
        try {
          await broker.maybeSaveEquity();
        } catch (err) {
          logger.warn({ err: (err as Error).message, accountId: broker.accountId }, 'equity save failed');
        }
      }
    }, { eachBatch: true, heartbeatInterval: 3000 }),
  ]);

  const shutdown = async (): Promise<void> => {
    for (const broker of brokers.values()) {
      try {
        await broker.maybeSaveEquity(true);
      } catch { /* shutting down — best effort */ }
    }
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
