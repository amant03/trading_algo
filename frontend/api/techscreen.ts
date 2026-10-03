// NSE technical screen from the TradingView scanner (same source as
// in.tradingview.com). Daily ratings, top names by market cap.
//
// GET /api/techscreen?limit=200

import { TECH_COLUMNS, parseScanRows, type TechRow } from '../src/lib/lenses';

const SCAN_URL = 'https://scanner.tradingview.com/india/scan';
const TV_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Origin: 'https://in.tradingview.com',
  Referer: 'https://in.tradingview.com/',
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': status === 200 ? 'public, max-age=45' : 'no-store, max-age=0',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

const TTL_MS = 60_000;
interface CacheVal { at: number; limit: number; rows: TechRow[] }
let cache: CacheVal | null = null;

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const limit = Math.min(250, Math.max(20, Math.round(Number(url.searchParams.get('limit') ?? 200)) || 200));
    const now = Date.now();
    if (cache && cache.limit === limit && now - cache.at < TTL_MS) {
      return json({ asOf: new Date(cache.at).toISOString(), source: 'cache', market: 'india', count: cache.rows.length, rows: cache.rows });
    }

    const res = await fetch(SCAN_URL, {
      method: 'POST',
      headers: TV_HEADERS,
      body: JSON.stringify({
        filter: [{ left: 'exchange', operation: 'equal', right: 'NSE' }],
        options: { lang: 'en' },
        symbols: { query: { types: [] }, tickers: [] },
        sort: { sortBy: 'market_cap_basic', sortOrder: 'desc' },
        range: [0, limit],
        columns: [...TECH_COLUMNS],
        markets: ['india'],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return json({ error: `tradingview scanner unavailable (http ${res.status})` }, 502);
    const body = (await res.json()) as { data?: { s: string; d: unknown[] }[] };
    const rows = parseScanRows(body.data ?? []);
    cache = { at: now, limit, rows };
    return json({ asOf: new Date(now).toISOString(), source: 'tradingview', market: 'india', count: rows.length, rows });
  } catch {
    return json({ error: 'tradingview scanner unreachable — try again shortly' }, 502);
  }
}
