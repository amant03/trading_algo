import { pool } from '@trading/shared';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const API = process.env.REPORT_API_URL ?? 'http://127.0.0.1:8080';

async function fetchJson(path: string): Promise<unknown | null> {
  try {
    const res = await fetch(`${API}${path}`);
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

async function main() {
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

  writeFileSync(join(process.cwd(), 'scripts', 'ci', 'report-latest.json'), JSON.stringify(report, null, 2));

  // Snapshot for the deployed frontend: captures the live API state at the end
  // of the run so the Vercel UI can render real data even with no backend.
  const [overview, instrumentQuotes, signalFeed, newsFeed] = await Promise.all([
    fetchJson('/api/market/overview'),
    fetchJson('/api/instruments'),
    fetchJson('/api/signals?limit=60'),
    fetchJson('/api/news?limit=60'),
  ]);

  const uiSnapshot = {
    generatedAt: report.timestamp,
    report,
    overview,
    instruments: instrumentQuotes,
    signals: signalFeed,
    news: newsFeed,
  };
  mkdirSync(join(process.cwd(), 'frontend', 'public'), { recursive: true });
  writeFileSync(
    join(process.cwd(), 'frontend', 'public', 'snapshot.json'),
    JSON.stringify(uiSnapshot),
  );

  await pool.end();
}

main().catch((e) => {
  console.error('Report generation failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
