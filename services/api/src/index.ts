import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import {
  pool,
  query,
  logger,
  consumeTopic,
  TOPICS,
  config,
  dbReady,
  kafkaReady,
  Candle,
  Snapshot,
  Signal,
  NewsEvent,
  Trade,
  Order,
  EquityPoint,
  Instrument,
} from '@trading/shared';
import { MarketStore } from './market-store.js';
import { hub } from './hub.js';
import { registerRoutes } from './routes.js';
import { authHook, registerAuthRoutes } from './auth.js';

async function loadInstruments(): Promise<{ instruments: Instrument[]; bySymbol: Map<string, Instrument> }> {
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
  const instruments = res.rows.map((r) => ({
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
  const bySymbol = new Map(instruments.map((i) => [i.symbol, i]));
  return { instruments, bySymbol };
}

async function main(): Promise<void> {
  logger.info('api gateway starting...');
  if (!(await dbReady())) throw new Error('PostgreSQL unavailable');
  if (!(await kafkaReady())) throw new Error('Kafka unavailable');

  const store = new MarketStore();
  const { instruments, bySymbol } = await loadInstruments();

  const app = Fastify({ logger: false, bodyLimit: 1_048_576 });
  await app.register(cors, { origin: true });
  await app.register(websocket);

  app.register(async (fastify) => {
    fastify.get('/ws', { websocket: true }, (socket) => {
      hub.add(socket.socket);
    });
  });

  // Attach req.user from Bearer tokens (routes opt into enforcement).
  app.addHook('onRequest', authHook);

  await registerRoutes(app, { store, instruments, bySymbol });
  await registerAuthRoutes(app);

  await app.listen({ port: config.api.port, host: '0.0.0.0' });
  logger.info({ port: config.api.port }, 'api gateway listening');

  const consumers: Promise<unknown>[] = [
    consumeTopic<Snapshot>(TOPICS.snapshots, 'api-snapshots', async (batch) => {
      for (const s of batch) store.onSnapshot(s);
      hub.broadcast('snapshot', batch);
    }, { eachBatch: true }),

    consumeTopic<Candle>(TOPICS.candles, 'api-candles', async (batch) => {
      for (const c of batch) store.onCandle(c);
      hub.broadcast('candle', batch);
    }, { eachBatch: true }),

    consumeTopic<Signal>(TOPICS.signals, 'api-signals', async (batch) => {
      for (const s of batch) store.onSignal(s);
      hub.broadcast('signal', batch);
    }, { eachBatch: true }),

    consumeTopic<NewsEvent>(TOPICS.news, 'api-news', async (batch) => {
      for (const n of batch) store.onNews(n);
      hub.broadcast('news', batch);
    }, { eachBatch: true }),

    consumeTopic<Trade>(TOPICS.trades, 'api-trades', async (batch) => {
      for (const t of batch) store.onTrade(t);
      hub.broadcast('trade', batch);
    }, { eachBatch: true }),

    consumeTopic<Order>(TOPICS.orders, 'api-orders', async (batch) => {
      for (const o of batch) store.onOrder(o);
      hub.broadcast('order', batch);
    }, { eachBatch: true }),

    consumeTopic<EquityPoint>(TOPICS.equity, 'api-equity', async (batch) => {
      for (const e of batch) store.onEquity(e);
      hub.broadcast('equity', batch);
    }, { eachBatch: true }),
  ];

  const shutdown = async (): Promise<void> => {
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await Promise.all(consumers);
}

main().catch((err) => {
  logger.error({ err: err as Error }, 'api fatal');
  process.exit(1);
});