// Near-live NSE quotes for the static deploy.
// Proxies Yahoo Finance v8 chart (per-symbol, no auth needed) into a single
// normalized quote payload. A short in-memory TTL avoids hammering Yahoo when
// the frontend polls; the same module state carries across warm invocations.

const SYMBOLS = [
  'RELIANCE', 'TCS', 'HDFCBANK', 'ICICIBANK', 'INFY', 'ITC', 'BHARTIARTL',
  'SBIN', 'KOTAKBANK', 'AXISBANK', 'LT', 'HINDUNILVR', 'SUNPHARMA',
  'BAJFINANCE', 'MARUTI', 'TITAN', 'ASIANPAINT', 'ULTRACEMCO', 'NTPC',
  'ADANIENT', 'ADANIPORTS', 'POWERGRID', 'ONGC', 'TATAMOTORS', 'TATASTEEL',
  'JSWSTEEL', 'WIPRO', 'TECHM', 'HCLTECH', 'NESTLEIND', 'M&M', 'TATACONSUM',
  'BAJAJFINSV', 'HDFCLIFE', 'SBILIFE', 'DRREDDY', 'CIPLA', 'APOLLOHOSP',
  'GRASIM', 'HINDALCO', 'BPCL', 'COALINDIA', 'EICHERMOT', 'HEROMOTOCO',
  'INDUSINDBK', 'BRITANNIA', 'DIVISLAB', 'BAJAJ-AUTO', 'TATAPOWER', 'IRCTC',
  'IDEA', 'HAL',
];

const TTL_MS = 45_000;
const MAX_PER_REQ = 26;
const POOL = 6;
const SPACING_MS = 60;
const FETCH_TIMEOUT_MS = 5_000;

let quotes: Record<string, Quote & { at: number }> = {};

interface Quote {
  symbol: string;
  price: number;
  prevClose: number;
  changePct: number;
  dayHigh: number;
  dayLow: number;
  volume: number;
  ts: number;
}

async function yahooJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function fetchOne(symbol: string): Promise<Quote | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}.NS?range=1d&interval=5m&includePrePost=false`;
  const body = await yahooJson<{ chart?: { result?: { meta?: Record<string, unknown> }[] } }>(url);
  const meta = body?.chart?.result?.[0]?.meta;
  if (!meta) return null;
  const num = (k: string): number | null => {
    const v = meta[k];
    return typeof v === 'number' && isFinite(v) ? v : null;
  };
  const price = num('regularMarketPrice');
  const prevClose = num('chartPreviousClose') ?? num('previousClose');
  const dayHigh = num('regularMarketDayHigh');
  const dayLow = num('regularMarketDayLow');
  const volume = num('regularMarketVolume');
  const ts = num('regularMarketTime');
  if (price == null || prevClose == null || prevClose <= 0) return null;
  const changePct = ((price - prevClose) / prevClose) * 100;
  return {
    symbol,
    price,
    prevClose,
    changePct,
    dayHigh: dayHigh ?? price,
    dayLow: dayLow ?? price,
    volume: Math.round(volume ?? 0),
    ts: (ts ?? Date.now()) * 1000,
  };
}

async function fetchAll(): Promise<{ ts: number; quotes: Quote[] }> {
  const now = Date.now();
  const stale = SYMBOLS.filter((s) => !quotes[s] || now - quotes[s].at > TTL_MS);
  // Bounded refresh each invocation: rotate over the stale set so a cold or
  // slow instance never blows the function duration limit. Everything already
  // cached is still returned, so the response always contains all symbols seen
  // in the last ~2 polls (~30s), then the other half on the next poll.
  const chunks: string[][] = [];
  for (let i = 0; i < stale.length; i += MAX_PER_REQ) chunks.push(stale.slice(i, i + MAX_PER_REQ));
  const selected = chunks.length ? chunks[Math.floor(now / 20_000) % chunks.length] : [];

  let fetched: Quote[] = [];
  if (selected.length) {
    let cursor = 0;
    const workers = Array.from({ length: POOL }, async () => {
      while (true) {
        const idx = cursor;
        cursor += 1;
        if (idx >= selected.length) return;
        const q = await fetchOne(selected[idx]);
        if (q) {
          quotes[q.symbol] = { ...q, at: Date.now() };
          fetched.push(q);
        }
        await new Promise((r) => setTimeout(r, SPACING_MS));
      }
    });
    await Promise.all(workers);
  }

  const out = SYMBOLS.map((s) => quotes[s]).filter(Boolean).map(({ symbol, price, prevClose, changePct, dayHigh, dayLow, volume, ts }) => ({
    symbol, price, prevClose, changePct, dayHigh, dayLow, volume, ts,
  }));
  return { ts: Date.now(), quotes: out };
}

export async function GET(request: Request): Promise<Response> {
  const fresh = Object.values(quotes).filter((q) => Date.now() - q.at < TTL_MS);
  if (fresh.length >= SYMBOLS.length) {
    return new Response(
      JSON.stringify({
        ts: Date.now(),
        source: 'cache',
        quotes: SYMBOLS.map((s) => quotes[s]).filter(Boolean).map(({ symbol, price, prevClose, changePct, dayHigh, dayLow, volume, ts }) => ({ symbol, price, prevClose, changePct, dayHigh, dayLow, volume, ts })),
      }),
      { status: 200, headers: jsonHeaders() },
    );
  }
  const { ts, quotes: out } = await fetchAll();
  return new Response(
    JSON.stringify({ ts, source: 'yahoo', quotes: out }),
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