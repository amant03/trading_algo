// Publish the dashboard technical lens.
//
// Scrapes the same scanner in.tradingview.com uses (India, NSE, daily),
// then the global TradingView scanner if the India endpoint is thin.
// Each row carries all 26 technical points (11 oscillators, equal weight,
// and 15 moving averages, equal weight; the two groups then count 50/50).
//
// Writes frontend/public/tech-screen.json. If both scrapes fail and a
// previous file is already on disk (the workflow pre-stages it), that file
// is left in place so a bad run does not blank the charts.
//
// Run: npx tsx scripts/ci/tech-screen.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TECH_COLUMNS, parseScanRows, type TechRow } from '../../frontend/src/lib/lenses.ts';

const OUT = join(process.cwd(), 'frontend', 'public', 'tech-screen.json');
const LIMIT = 220;
const MIN_ROWS = 40;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

interface ScanBody { data?: { s: string; d: unknown[] }[] }

async function scan(url: string, body: unknown, label: string): Promise<TechRow[]> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'User-Agent': UA,
          Origin: 'https://in.tradingview.com',
          Referer: 'https://in.tradingview.com/',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 4000 * attempt));
        continue;
      }
      if (!res.ok) {
        console.log(`tech-screen: ${label} http ${res.status} (attempt ${attempt})`);
        await new Promise((r) => setTimeout(r, 1500 * attempt));
        continue;
      }
      const json = (await res.json()) as ScanBody;
      const rows = parseScanRows(json.data ?? []);
      console.log(`tech-screen: ${label} returned ${rows.length} names`);
      return rows;
    } catch (err) {
      console.log(`tech-screen: ${label} failed (attempt ${attempt}): ${err instanceof Error ? err.message : err}`);
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  return [];
}

function indiaBody() {
  return {
    filter: [{ left: 'exchange', operation: 'equal', right: 'NSE' }],
    options: { lang: 'en' },
    symbols: { query: { types: [] }, tickers: [] },
    sort: { sortBy: 'market_cap_basic', sortOrder: 'desc' },
    range: [0, LIMIT],
    columns: [...TECH_COLUMNS],
    markets: ['india'],
  };
}

function globalBody() {
  return {
    filter: [{ left: 'exchange', operation: 'equal', right: 'NSE' }],
    options: { lang: 'en' },
    symbols: { query: { types: [] }, tickers: [] },
    sort: { sortBy: 'market_cap_basic', sortOrder: 'desc' },
    range: [0, LIMIT],
    columns: [...TECH_COLUMNS],
    markets: ['india'],
  };
}

function previousCount(): number {
  if (!existsSync(OUT)) return 0;
  try {
    const prev = JSON.parse(readFileSync(OUT, 'utf8')) as { count?: number; rows?: unknown[] };
    return prev.rows?.length ?? prev.count ?? 0;
  } catch {
    return 0;
  }
}

async function main(): Promise<void> {
  let rows = await scan('https://scanner.tradingview.com/india/scan', indiaBody(), 'in.tradingview.com');
  let source = 'in.tradingview.com';
  if (rows.length < MIN_ROWS) {
    const global = await scan('https://scanner.tradingview.com/global/scan', globalBody(), 'tradingview.com global');
    if (global.length > rows.length) {
      rows = global;
      source = 'tradingview.com';
    }
  }
  if (rows.length < MIN_ROWS) {
    const kept = previousCount();
    if (kept > 0) {
      console.log(`tech-screen: scrape thin (${rows.length}); keeping previous file (${kept} names)`);
      return;
    }
    console.error('tech-screen: no rows and no previous file');
    process.exitCode = 1;
    return;
  }
  const payload = {
    asOf: new Date().toISOString(),
    source,
    market: 'india',
    count: rows.length,
    rows,
  };
  writeFileSync(OUT, JSON.stringify(payload));
  const top = rows[0];
  console.log(`tech-screen: wrote ${rows.length} names from ${source}; top ${top?.symbol} ${top?.techScore} ${top?.rating}`);
}

main().catch((err) => {
  console.error('tech-screen failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
