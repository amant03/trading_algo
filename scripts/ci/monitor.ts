import { pool, query } from '@trading/shared';

/**
 * Pipeline progress monitor + quality gate.
 * Polls DB counts, logs progress, exits 0 early when the engine is producing
 * signals AND the executor is trading; fails if the brain stays silent.
 *
 * Env knobs: WINDOW_SEC (default 480), GRACE_SEC (default 180), POLL_SEC (20).
 */

const WINDOW_SEC = Number(process.env.WINDOW_SEC ?? 480);
const GRACE_SEC = Number(process.env.GRACE_SEC ?? 180);
const POLL_SEC = Number(process.env.POLL_SEC ?? 20);

async function counts(): Promise<{ candles: number; signals: number; orders: number; trades: number }> {
  const res = await query<{ candles: string; signals: string; orders: string; trades: string }>(
    `SELECT
       (SELECT COUNT(*) FROM candles)  AS candles,
       (SELECT COUNT(*) FROM signals)  AS signals,
       (SELECT COUNT(*) FROM orders)   AS orders,
       (SELECT COUNT(*) FROM trades)   AS trades`,
  );
  return {
    candles: Number(res.rows[0].candles),
    signals: Number(res.rows[0].signals),
    orders: Number(res.rows[0].orders),
    trades: Number(res.rows[0].trades),
  };
}

async function main(): Promise<void> {
  const start = Date.now();
  let last: Awaited<ReturnType<typeof counts>> | null = null;

  while ((Date.now() - start) / 1000 < WINDOW_SEC) {
    await new Promise((r) => setTimeout(r, POLL_SEC * 1000));
    try {
      last = await counts();
    } catch (err) {
      console.log(`[t=${Math.round((Date.now() - start) / 1000)}s] db not ready: ${(err as Error).message}`);
      continue;
    }
    const t = Math.round((Date.now() - start) / 1000);
    console.log(`[t=${t}s] candles=${last.candles} signals=${last.signals} orders=${last.orders} trades=${last.trades}`);

    const healthy =
      last.signals > 0 && last.orders > 0 && last.trades > 0 && t >= GRACE_SEC;
    if (healthy) {
      console.log('Pipeline healthy — signals flowing, executor trading.');
      break;
    }
  }

  if (!last) throw new Error('Could never read pipeline counts from the database');
  if (last.signals === 0) throw new Error('GATE FAILED: algorithm-engine produced zero signals');
  if (last.orders === 0) throw new Error('GATE FAILED: signals produced but executor placed zero orders');
  console.log(`Gate passed: signals=${last.signals} orders=${last.orders} trades=${last.trades} candles=${last.candles}`);
}

main()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    void pool.end();
    process.exit(1);
  });
