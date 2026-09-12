// US stock screener relay, mirroring deepentropy/tvscreener StockScreener.
//
// tvscreener (Python) is a thin wrapper over TradingView's public scanner:
//   POST https://scanner.tradingview.com/global/scan
//   body: { filter, options:{lang}, symbols:{query,tickers}, sort, range,
//           columns, markets }
//   defaults for US stocks: markets=["america"], sort by
//   market_cap_basic desc, range [0,150].
// See: https://github.com/deepentropy/tvscreener
// (tvscreener/core/stock.py -> url=get_url("global"),
//  tvscreener/core/base.py -> REQUEST_HEADERS / _build_payload / get(),
//  tvscreener/util.py -> get_url(), tvscreener/field/stock.py -> columns)
//
// This serverless function replicates the same HTTP call in TypeScript so the
// static Vercel deploy can serve live US data without a Python runtime.

const SCAN_URL = 'https://scanner.tradingview.com/global/scan';

const TV_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Origin: 'https://www.tradingview.com',
  Referer: 'https://www.tradingview.com/',
};

// Minimal column set (tvscreener StockField field_names) for a market table.
const COLUMNS = [
  'name',
  'description',
  'close',
  'change',
  'change_abs',
  'volume',
  'market_cap_basic',
  'price_earnings_ttm',
  'sector',
  'exchange',
  'Recommend.All',
];

export interface USQuote {
  symbol: string;
  name: string;
  price: number | null;
  change: number | null;
  changePct: number | null;
  volume: number | null;
  marketCap: number | null;
  pe: number | null;
  sector: string;
  exchange: string;
  rating: number | null;
}

interface ScanRow {
  s: string;
  d: (number | string | null)[];
}

interface ScanBody {
  data?: ScanRow[];
  totalCount?: number;
}

const num = (v: unknown): number | null =>
  typeof v === 'number' && isFinite(v) ? v : null;

const str = (v: unknown): string =>
  typeof v === 'string' ? v : '';

function rowsFromScan(body: ScanBody | null): USQuote[] {
  if (!body?.data?.length) return [];
  return body.data.map((row) => {
    const d = row.d ?? [];
    // Order matches COLUMNS above.
    const [name, desc, close, changePct, changeAbs, volume, mcap, pe, sector, exchange, rating] = d;
    const ticker = str(row.s).split(':').pop() ?? str(row.s);
    return {
      symbol: ticker.toUpperCase(),
      name: str(desc) || str(name) || ticker,
      price: num(close),
      change: num(changeAbs),
      changePct: num(changePct),
      volume: num(volume) != null ? Math.round(num(volume) as number) : null,
      marketCap: num(mcap),
      pe: num(pe),
      sector: str(sector),
      exchange: str(exchange),
      rating: num(rating),
    };
  });
}

async function fetchUS(limit: number): Promise<{ rows: USQuote[]; total: number }> {
  const payload = {
    filter: [],
    options: { lang: 'en' },
    symbols: { query: { types: [] }, tickers: [] },
    sort: { sortBy: 'market_cap_basic', sortOrder: 'desc' },
    range: [0, Math.max(1, Math.min(limit, 150))],
    columns: COLUMNS,
    markets: ['america'],
  };
  const res = await fetch(SCAN_URL, {
    method: 'POST',
    headers: TV_HEADERS,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`tradingview scan failed: ${res.status}`);
  const body = (await res.json()) as ScanBody;
  return { rows: rowsFromScan(body), total: body.totalCount ?? rowsFromScan(body).length };
}

export function jsonHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store, max-age=0',
    'Access-Control-Allow-Origin': '*',
  };
}

const TTL_MS = 60_000;

let cache: { at: number; rows: USQuote[]; total: number } | null = null;
let inflight: Promise<{ rows: USQuote[]; total: number }> | null = null;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders() });
}

function parseLimit(request?: Request): number {
  if (!request) return 50;
  try {
    const n = Number(new URL(request.url).searchParams.get('limit') ?? 50);
    if (!isFinite(n)) return 50;
    return Math.max(1, Math.min(Math.floor(n), 150));
  } catch {
    return 50;
  }
}

// Live US stock snapshot via TradingView screener (tvscreener-compatible).
// GET /api/us?limit=50 (default 50, max 150)
export async function GET(request?: Request): Promise<Response> {
  const limit = parseLimit(request);
  const now = Date.now();

  if (cache && now - cache.at < TTL_MS && cache.rows.length >= limit) {
    return json({
      ts: cache.at,
      source: 'cache',
      via: 'tradingview-tvscreener',
      total: cache.total,
      rows: cache.rows.slice(0, limit),
    });
  }

  try {
    if (!inflight) {
      inflight = fetchUS(Math.max(limit, cache?.rows.length ?? 0)).finally(() => {
        inflight = null;
      });
    }
    const data = await inflight;
    if (data.rows.length) cache = { at: Date.now(), rows: data.rows, total: data.total };
    return json({ ts: Date.now(), source: 'tradingview', via: 'tradingview-tvscreener', total: data.total, rows: data.rows.slice(0, limit) });
  } catch (err) {
    if (cache?.rows.length) {
      return json({ ts: cache.at, source: 'stale', via: 'tradingview-tvscreener', total: cache.total, rows: cache.rows.slice(0, limit) });
    }
    return json({ error: err instanceof Error ? err.message : 'us screener unavailable', rows: [] }, 503);
  }
}
