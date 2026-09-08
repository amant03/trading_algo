import pg from 'pg';
import { config } from './config.js';
import { logger } from './logger.js';

const { Pool } = pg;

export const pool = new Pool({
  host: config.pg.host,
  port: config.pg.port,
  database: config.pg.database,
  user: config.pg.user,
  password: config.pg.password,
  max: config.pg.max,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  allowExitOnIdle: true,
});

pool.on('error', (err: Error) => logger.error({ err: err.message }, 'pg pool error'));

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<pg.QueryResult<T>> {
  const started = Date.now();
  const res = await pool.query<T>(text, params as never[]);
  const elapsed = Date.now() - started;
  if (elapsed > 100) logger.debug({ elapsed, text }, 'slow query');
  return res;
}

/** Run several statements in one transaction. */
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function dbReady(waitMs = 15_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < waitMs) {
    try {
      await pool.query('SELECT 1');
      return true;
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'db not ready, retrying...');
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  return false;
}

export const closeDb = () => pool.end();

/**
 * Block until the instruments table has been seeded by market-data.
 * Services started in parallel must not cache an empty universe.
 */
export async function waitForInstruments(waitMs = 120_000, minCount = 1): Promise<number> {
  const start = Date.now();
  for (;;) {
    try {
      const res = await query<{ c: number }>(
        "SELECT COUNT(*)::int AS c FROM instruments WHERE status = 'ACTIVE'",
      );
      if (res.rows[0].c >= minCount) return res.rows[0].c;
    } catch {
      /* table may not exist yet on a fresh schema */
    }
    if (Date.now() - start > waitMs) throw new Error(`instruments not seeded within ${waitMs}ms`);
    logger.debug('waiting for instruments to be seeded...');
    await new Promise((r) => setTimeout(r, 1000));
  }
}

/** Block until at least `minCount` candles exist (market-data backfill done). */
export async function waitForCandles(waitMs = 180_000, minCount = 1): Promise<number> {
  const start = Date.now();
  for (;;) {
    try {
      const res = await query<{ c: number }>('SELECT COUNT(*)::int AS c FROM candles');
      if (res.rows[0].c >= minCount) return res.rows[0].c;
    } catch {
      /* table may not exist yet on a fresh schema */
    }
    if (Date.now() - start > waitMs) throw new Error(`candles not backfilled within ${waitMs}ms`);
    logger.debug('waiting for candle backfill...');
    await new Promise((r) => setTimeout(r, 1000));
  }
}
