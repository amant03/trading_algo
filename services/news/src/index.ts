import {
  pool,
  query,
  logger,
  publishBatch,
  TOPICS,
  dbReady,
  kafkaReady,
  NewsEvent,
} from '@trading/shared';
import { SeededRng } from '@trading/shared';
import { generateNewsEvent } from './generator.js';

interface Inst {
  id: number;
  symbol: string;
  name: string;
  sector: string | null;
}

async function loadInstruments(): Promise<Inst[]> {
  const res = await query<{ id: number; symbol: string; name: string; sector: string | null }>(
    'SELECT id, symbol, name, sector FROM instruments WHERE status = $1 ORDER BY id',
    ['ACTIVE'],
  );
  return res.rows;
}

async function insertNews(events: NewsEvent[]): Promise<void> {
  if (!events.length) return;
  const params: (number | string | string[] | null)[] = [];
  const values = events
    .map((e, idx) => {
      const p = idx * 9;
      params.push(e.instrumentId, e.symbol, e.headline, e.summary, e.source, e.sentiment, e.impact, e.category, e.tags);
      return `($${p + 1}, $${p + 2}, $${p + 3}, $${p + 4}, $${p + 5}, $${p + 6}, $${p + 7}, $${p + 8}, $${p + 9}::text[])`;
    })
    .join(',');
  const res = await query<{ id: number }>(
    `INSERT INTO news_events (instrument_id, symbol, headline, summary, source, sentiment, impact, category, tags)
     VALUES ${values}
     ON CONFLICT DO NOTHING
     RETURNING id`,
    params,
  );
  // attach real ids for consumers
  res.rows.forEach((row, i) => {
    if (events[i]) events[i].id = row.id;
  });
}

async function seedBacklog(instruments: Inst[]): Promise<void> {
  const rng = new SeededRng(777_001);
  const events: NewsEvent[] = [];
  for (const inst of instruments) {
    const per = 3 + rng.int(0, 4);
    for (let i = 0; i < per; i++) {
      const ev = generateNewsEvent(rng, inst);
      ev.publishedAt = Date.now() - rng.int(5, 60 * 24 * 7) * 60 * 1000;
      ev.eventTime = ev.publishedAt;
      events.push(ev);
    }
  }
  // some macro events
  for (let i = 0; i < 10; i++) events.push(generateNewsEvent(rng, null));
  events.sort((a, b) => a.publishedAt - b.publishedAt);
  await insertNews(events);
  logger.info({ backlog: events.length }, 'news backlog seeded');
}

async function main(): Promise<void> {
  logger.info('news service starting...');
  if (!(await dbReady())) throw new Error('PostgreSQL unavailable');
  if (!(await kafkaReady())) throw new Error('Kafka unavailable');

  const instruments = await loadInstruments();
  const rng = new SeededRng(Date.now() % 1_000_000);

  const { count } = (await query<{ count: number }>('SELECT COUNT(*)::int AS count FROM news_events')).rows[0];
  if (count === 0) await seedBacklog(instruments);

  const emit = async (): Promise<void> => {
    const isMacro = rng.bool(0.18);
    const inst = isMacro ? null : rng.pick(instruments);
    const event = generateNewsEvent(rng, inst);
    await insertNews([event]);
    await publishBatch(TOPICS.news, [{ payload: event, key: event.symbol ?? 'MACRO' }]);
  };

  logger.info('news feed live');
  const timer = setInterval(() => {
    emit().catch((err) => logger.error({ err: (err as Error).message }, 'news emit failed'));
  }, 12_000);

  const shutdown = async (): Promise<void> => {
    clearInterval(timer);
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.error({ err: err as Error }, 'news fatal');
  process.exit(1);
});
