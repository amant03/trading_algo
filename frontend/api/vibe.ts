// Cross-market daily bars for the Vibe-Trading tab.
// One Yahoo chart call per ticker. The NSE relay in chart.ts always appends
// `.NS`; this route accepts an explicit Yahoo ticker so US, HK, Canada, UK,
// Korea, crypto, forex, and futures can be loaded beside India.

// Kept inside this file on purpose. Importing ./chart.ts pulls that route's
// GET handler into this function, and Vercel then crashes the invocation.

const YAHOO_HOSTS = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];

const YAHOO_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  Accept: 'application/json,text/plain,*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://finance.yahoo.com/',
  Origin: 'https://finance.yahoo.com',
};

interface OHLCV {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

function jsonHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store, max-age=0',
    'Access-Control-Allow-Origin': '*',
  };
}

async function yahooJson<T>(pathAndQuery: string, timeoutMs = 12_000): Promise<T | null> {
  for (const host of YAHOO_HOSTS) {
    try {
      const res = await fetch(`${host}${pathAndQuery}`, {
        headers: YAHOO_HEADERS,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) continue;
      return (await res.json()) as T;
    } catch {
      continue;
    }
  }
  return null;
}

const RANGES = new Set(['6mo', '1y', '2y', '5y']);
const TICKER = /^\^?[A-Z0-9][A-Z0-9.^=-]{0,24}$/;

type ChartBody = {
  chart?: {
    result?: Array<{
      meta?: Record<string, unknown>;
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

const cache: Record<string, { at: number; body: string }> = {};
const TTL_MS = 120_000;

function rowsFromChart(body: ChartBody | null): { rows: OHLCV[]; meta: Record<string, unknown> } | null {
  const r = body?.chart?.result?.[0];
  const ts = r?.timestamp;
  const q = r?.indicators?.quote?.[0];
  const meta = (r?.meta ?? {}) as Record<string, unknown>;
  if (!ts?.length || !q?.close) return null;
  const rows: OHLCV[] = [];
  for (let i = 0; i < ts.length; i++) {
    const o = q.open?.[i];
    const h = q.high?.[i];
    const l = q.low?.[i];
    const c = q.close?.[i];
    if (o == null || h == null || l == null || c == null) continue;
    if (!(o > 0) || !(c > 0)) continue;
    rows.push({
      t: Math.floor(ts[i]),
      o,
      h,
      l,
      c,
      v: Math.round(q.volume?.[i] ?? 0),
    });
  }
  if (!rows.length) return null;
  return { rows, meta };
}

function currencyFallback(ticker: string): string {
  if (ticker.endsWith('.NS') || ticker.endsWith('.BO') || ticker === '^NSEI') return 'INR';
  if (ticker.endsWith('.HK')) return 'HKD';
  if (ticker.endsWith('.TO') || ticker.endsWith('.V')) return 'CAD';
  if (ticker.endsWith('.L')) return 'GBP';
  if (ticker.endsWith('.KS') || ticker.endsWith('.KQ')) return 'KRW';
  if (ticker.endsWith('.SA')) return 'BRL';
  return 'USD';
}

async function load(ticker: string, range: string): Promise<{
  rows: OHLCV[];
  currency: string;
  name: string;
} | null> {
  const qs =
    `/v8/finance/chart/${encodeURIComponent(ticker)}` +
    `?range=${encodeURIComponent(range)}&interval=1d&includePrePost=false&events=div%2Csplit`;
  const body = await yahooJson<ChartBody>(qs, 12_000);
  const parsed = rowsFromChart(body);
  if (!parsed) return null;
  const metaCcy = parsed.meta.currency;
  const currency = typeof metaCcy === 'string' && metaCcy ? metaCcy : currencyFallback(ticker);
  const shortName = parsed.meta.shortName ?? parsed.meta.longName;
  const name = typeof shortName === 'string' && shortName ? shortName : ticker;
  return { rows: parsed.rows, currency, name };
}

export async function GET(request: Request): Promise<Response> {
  try {
    return await handle(request);
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'vibe chart failed' }), {
      status: 500,
      headers: jsonHeaders(),
    });
  }
}

async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const ticker = (url.searchParams.get('ticker') ?? '').trim().toUpperCase();
  const range = (url.searchParams.get('range') ?? '2y').toLowerCase();

  if (!TICKER.test(ticker)) {
    return new Response(JSON.stringify({ error: 'missing or invalid ticker' }), {
      status: 400,
      headers: jsonHeaders(),
    });
  }
  if (!RANGES.has(range)) {
    return new Response(JSON.stringify({ error: 'unsupported range', ranges: [...RANGES] }), {
      status: 400,
      headers: jsonHeaders(),
    });
  }

  const key = `${ticker}:${range}`;
  const hit = cache[key];
  if (hit && Date.now() - hit.at < TTL_MS) {
    return new Response(hit.body, { status: 200, headers: jsonHeaders() });
  }

  const ranges = range === '2y' ? ['2y', '1y'] : [range];
  let got: { rows: OHLCV[]; currency: string; name: string } | null = null;
  let used = range;
  for (const candidate of ranges) {
    got = await load(ticker, candidate);
    if (got && got.rows.length >= 30) {
      used = candidate;
      break;
    }
    got = got && got.rows.length ? got : null;
    used = candidate;
  }

  if (!got) {
    return new Response(JSON.stringify({ error: 'chart unavailable', ticker }), {
      status: 404,
      headers: jsonHeaders(),
    });
  }

  const payload = JSON.stringify({
    ticker,
    name: got.name,
    currency: got.currency,
    range: used,
    interval: '1d',
    source: 'yahoo',
    rows: got.rows,
  });
  cache[key] = { at: Date.now(), body: payload };
  return new Response(payload, { status: 200, headers: jsonHeaders() });
}
