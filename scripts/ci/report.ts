import 'dotenv/config';
import pg from 'pg';
import { writeFileSync } from 'fs';
import { join } from 'path';

async function main() {
  const pool = new pg.Pool();

  const [instruments, candles, signals, orders, trades, positions, account, latestSignals, newsCount] = await Promise.all([
    pool.query('SELECT COUNT(*) as count FROM instruments'),
    pool.query('SELECT COUNT(*) as count FROM candles'),
    pool.query('SELECT COUNT(*) as count FROM signals'),
    pool.query('SELECT COUNT(*) as count FROM orders'),
    pool.query('SELECT COUNT(*) as count FROM trades'),
    pool.query('SELECT COUNT(*) as count FROM positions WHERE quantity > 0'),
    pool.query('SELECT cash_balance, equity FROM accounts WHERE id = 1'),
    pool.query(`
      SELECT i.symbol, s.direction, s.strategy, s.reason, s.ts
      FROM signals s
      JOIN instruments i ON s.instrument_id = i.id
      ORDER BY s.ts DESC
      LIMIT 5
    `),
    pool.query('SELECT COUNT(*) as count FROM news_events'),
  ]);

  const report = {
    timestamp: new Date().toISOString(),
    instruments: +instruments.rows[0].count,
    candles: +candles.rows[0].count,
    signals: +signals.rows[0].count,
    orders: +orders.rows[0].count,
    trades: +trades.rows[0].count,
    openPositions: +positions.rows[0].count,
    news: +newsCount.rows[0].count,
    account: account.rows[0] || null,
    latestSignals: latestSignals.rows,
  };

  console.log(JSON.stringify(report, null, 2));

  const outPath = join(process.cwd(), 'scripts', 'ci', 'report-latest.json');
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.error(`Report written to ${outPath}`);

  await pool.end();
}

main().catch((e) => {
  console.error('Report generation failed:', e.message);
  process.exit(1);
});
