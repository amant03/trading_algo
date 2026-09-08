// OHLCV chart relay for the static deploy (no backend required).
//
// Same free Yahoo Finance v8 chart endpoint used by /api/live, exposed as a
// single small serverless function with range -> interval mapping that mirrors
// what Google Finance serves. A short module-level TTL keeps Yahoo traffic low
// when multiple users browse the same symbols.

const RANGES: Record<string, { interval: string; label: string }> = {
  '1d': { interval: '5m', label: '1D' },
  '5d': { interval: '15m', label: '5D' },
  '1mo': { interval: '60m', label: '1M' },
  '6mo': { interval: '1d', label: '6M' },
  '1y': { interval: '1d', label: '1Y' },
  '5y': { interval: '1wk', label: '5Y' },
};

const TTL_MS = 60_000;
const FETCH_TIMEOUT_MS = 6_000;

/** { symbol:range -> { at, rows } } */
const cache: Record<string, { at: number; rows: OHLCV[] }> = {};

interface OHLCV {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

async function yahooChart(symbol: string, range: string, interval: string): Promise<OHLCV[] | null> {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}.NS` +
    `?range=${range}&interval=${interval}&includePrePost=false&events=div%2Csplit`;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.status === 404 || res.status === 401) return null;
    if (!res.ok) throw new Error(`yahoo ${res.status}`);
    const body = (await res.json()) as {
      chart?: {
        result?: Array<{
          timestamp?: number[];
          indicators?: {
            quote?: Array<{
              open?: (number | null)[];
              high?: (number | null)[];
              low?: (number | null)[];
              close?: (number | null)[];
              volume?: (number | null)[];
            }>;
          };
        }>;
      };
    };
    const r = body?.chart?.result?.[0];
    const ts = r?.timestamp;
    const q = r?.indicators?.quote?.[0];
    if (!ts?.length || !q?.close) return null;
    const rows: OHLCV[] = [];
    for (let i = 0; i < ts.length; i++) {
      const o = q.open?.[i];
      const h = q.high?.[i];
      const l = q.low?.[i];
      const c = q.close?.[i];
      if (o == null || h == null || l == null || c == null) continue;
      rows.push({
        t: Math.floor(ts[i]), // Yahoo v8 timestamps are already epoch seconds
        o,
        h,
        l,
        c,
        v: Math.round(q.volume?.[i] ?? 0),
      });
    }
    return rows.length ? rows : null;
  } catch {
    return null;
  }
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const symbol = (url.searchParams.get('symbol') ?? url.searchParams.get('Symbol') ?? '')
    .toUpperCase()
    .trim();
  const range = (url.searchParams.get('range') ?? '1d').toLowerCase();

  if (!/^[A-Z0-9\-]{1,24}$/.test(symbol)) {
    return new Response(JSON.stringify({ error: 'missing or invalid symbol' }), {
      status: 400,
      headers: jsonHeaders(),
    });
  }
  const spec = RANGES[range];
  if (!spec) {
    return new Response(JSON.stringify({ error: 'unsupported range', ranges: Object.keys(RANGES), default: '1d' }), {
      status: 400,
      headers: jsonHeaders(),
    });
  }

  const now = Date.now();
  const hit = cache[`${symbol}:${range}`];
  if (hit && now - hit.at < TTL_MS) {
    return new Response(
      JSON.stringify({ symbol, range, interval: spec.interval, currency: 'INR', source: 'cache', rows: hit.rows }),
      { status: 200, headers: jsonHeaders() },
    );
  }

  const rows = await yahooChart(symbol, range, spec.interval);
  if (!rows) {
    return new Response(JSON.stringify({ error: 'chart unavailable for symbol (check spelling, delisted, or Yahoo 404)' }), {
      status: 404,
      headers: jsonHeaders(),
    });
  }

  cache[`${symbol}:${range}`] = { at: now, rows };
  return new Response(
    JSON.stringify({ symbol, range, interval: spec.interval, currency: 'INR', source: 'yahoo', rows }),
    { status: 200, headers: jsonHeaders() },
  );
}

function jsonHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  };
}