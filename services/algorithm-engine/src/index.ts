import {
  pool,
  query,
  logger,
  consumeTopic,
  publishBatch,
  TOPICS,
  dbReady,
  kafkaReady,
  Candle,
  Signal,
  AlgorithmConfig,
  waitForInstruments,
  waitForCandles,
} from '@trading/shared';
import { AlgorithmEngine, DEFAULT_CONFIGS } from './engine.js';

async function seedDefaultConfigs(): Promise<void> {
  for (const cfg of DEFAULT_CONFIGS) {
    await query(
      `INSERT INTO algorithm_configs (strategy, enabled, params) VALUES ($1, $2, $3)
       ON CONFLICT (strategy) DO NOTHING`,
      [cfg.strategy, cfg.enabled, JSON.stringify(cfg.params)],
    );
  }
}

async function loadConfigs(): Promise<AlgorithmConfig[]> {
  const res = await query<{ strategy: string; enabled: boolean; params: Record<string, number | boolean | string> }>(
    'SELECT strategy, enabled, params FROM algorithm_configs ORDER BY id',
  );
  return res.rows.map((r) => ({ strategy: r.strategy, enabled: r.enabled, params: r.params }));
}

async function loadInstruments(): Promise<{ id: number; symbol: string }[]> {
  const res = await query<{ id: number; symbol: string }>(
    "SELECT id, symbol FROM instruments WHERE status = 'ACTIVE' ORDER BY id",
  );
  return res.rows;
}

async function loadHistory(instruments: { id: number; symbol: string }[]): Promise<Map<number, Candle[]>> {
  const map = new Map<number, Candle[]>();
  for (const inst of instruments) {
    const res = await query<{
      instrument_id: number;
      ts: string;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
    }>(
      `SELECT instrument_id, ts, open, high, low, close, volume
       FROM candles WHERE instrument_id = $1 AND timeframe = '1m'
       ORDER BY ts DESC LIMIT 300`,
      [inst.id],
    );
    map.set(inst.id, res.rows.map((r) => ({
      instrumentId: r.instrument_id,
      symbol: inst.symbol,
      timeframe: '1m',
      ts: new Date(r.ts).getTime(),
      open: Number(r.open),
      high: Number(r.high),
      low: Number(r.low),
      close: Number(r.close),
      volume: Number(r.volume),
    })));
  }
  logger.info({ instruments: instruments.length }, 'engine warmup loaded');
  return map;
}

async function persistSignals(signals: Signal[]): Promise<void> {
  if (!signals.length) return;
  const params: (number | string)[] = [];
  const values = signals
    .map((s, idx) => {
      const p = idx * 8;
      params.push(s.instrumentId, s.strategy, s.direction, s.price, s.strength, s.reason, JSON.stringify(s.indicatorSnapshot), s.ts);
      return `($${p + 1}, $${p + 2}, $${p + 3}, $${p + 4}, $${p + 5}, $${p + 6}, $${p + 7}::jsonb, to_timestamp($${p + 8}/1000.0))`;
    })
    .join(',');
  const res = await query<{ id: number }>(
    `INSERT INTO signals (instrument_id, strategy, direction, price, strength, reason, indicator_snapshot, ts)
     VALUES ${values} RETURNING id`,
    params,
  );
  res.rows.forEach((row, i) => {
    if (signals[i]) signals[i].id = row.id;
  });
  await publishBatch(TOPICS.signals, signals.map((s) => ({ payload: s, key: s.symbol })));
  logger.info({ count: signals.length }, 'signals published');
}

async function main(): Promise<void> {
  logger.info('algorithm-engine service starting...');
  if (!(await dbReady())) throw new Error('PostgreSQL unavailable');
  if (!(await kafkaReady())) throw new Error('Kafka unavailable');

  await seedDefaultConfigs();

  // The universe and history are seeded by the market-data service. Starting in
  // parallel, we must wait — otherwise we cache an empty instrument set forever.
  const count = await waitForInstruments();
  logger.info({ instruments: count }, 'instrument universe ready');
  await waitForCandles(180_000, 50);
  logger.info('candle history ready');

  const engine = new AlgorithmEngine();
  engine.setInstruments(await loadInstruments());
  engine.warmup(await loadHistory([...engine['instruments'].values()]));
  engine.setConfigs(await loadConfigs());
  logger.info({ totalSignals: engine.totalSignals }, 'engine ready');

  await consumeTopic<Candle>(
    TOPICS.candles,
    'algorithm-engine',
    async (candles) => {
      const signals: Signal[] = [];
      for (const c of candles) signals.push(...engine.onCandle(c));
      if (signals.length) await persistSignals(signals);
    },
    { eachBatch: false, heartbeatInterval: 3000 },
  );

  const configTimer = setInterval(async () => {
    try {
      engine.setConfigs(await loadConfigs());
    } catch (err) {
      logger.error({ err: (err as Error).message }, 'config refresh failed');
    }
  }, 30_000);

  const shutdown = async (): Promise<void> => {
    clearInterval(configTimer);
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.error({ err: err as Error }, 'algorithm-engine fatal');
  process.exit(1);
});
