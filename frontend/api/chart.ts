// Top names by BSE/NSE market cap — used for the dashboard live tape.
export const LIVE_SYMBOLS: string[] = [
  "RELIANCE",
  "BHARTIARTL",
  "HDFCBANK",
  "ICICIBANK",
  "SBIN",
  "TCS",
  "BAJFINANCE",
  "LT",
  "LICI",
  "HINDUNILVR",
  "SUNPHARMA",
  "TITAN",
  "INFY",
  "KOTAKBANK",
  "ADANIPOWER",
  "ADANIENT",
  "MARUTI",
  "ADANIPORTS",
  "M&M",
  "AXISBANK",
  "HCLTECH",
  "HAL",
  "ITC",
  "BAJAJ-AUTO",
  "ULTRACEMCO",
  "NTPC",
  "JSWSTEEL",
  "BAJAJFINSV",
  "ETERNAL",
  "BEL",
  "ONGC",
  "NESTLEIND",
  "COALINDIA",
  "DIVISLAB",
  "HINDZINC",
  "POWERGRID",
  "SHRIRAMFIN",
  "DMART",
  "ASIANPAINT",
  "TATASTEEL",
  "HINDALCO",
  "GRASIM",
  "EICHERMOT",
  "ADANIGREEN",
  "SOLARINDS",
  "TVSMOTOR",
  "INDIGO",
  "IOC",
  "TORNTPHARM",
  "HYUNDAI",
  "MOTHERSON",
  "ADANIENSOL",
  "VAML",
  "SBILIFE",
  "WIPRO",
  "TMCV",
  "DLF",
  "IDEA",
  "PIDILITIND",
  "ABB",
  "TATACAP",
  "CHOLAFIN",
  "JIOFIN",
  "TECHM",
  "ICICIAMC",
  "TRENT",
  "BHEL",
  "BOSCHLTD",
  "CGPOWER",
  "SIEMENS",
  "CUMMINSIND",
  "UNIONBANK",
  "POWERINDIA",
  "VBL",
  "PNB",
  "BPCL",
  "LTM",
  "APOLLOHOSP",
  "POLYCAB",
  "BAJAJHLDNG",
  "GROWW",
  "BANKBARODA",
  "GVT&D",
  "BRITANNIA",
  "LENSKART",
  "LODHA",
  "PFC",
  "TATAPOWER",
  "MUTHOOTFIN",
  "JINDALSTEL",
  "HDFCLIFE",
  "INDIANB",
  "GAIL",
  "ZYDUSLIFE",
  "ENRIN",
  "LGEINDIA",
  "SBIFUNDS",
  "CANBK",
  "TMPV",
  "CIPLA",
  "ABCAPITAL",
  "IRFC",
  "PAYTM",
  "HEROMOTOCO",
  "MARICO",
  "VEDL",
  "HDFCAMC",
  "LAURUSLABS",
  "UNITDSPR",
  "OFSS",
  "INDHOTEL",
  "GMRAIRPORT",
  "LLOYDSME",
  "TATACONSUM",
  "ASHOKLEY",
  "AMBUJACEM",
  "MAZDOCK",
  "INDUSTOWER",
  "NYKAA",
  "MEESHO"
];

// Shared NSE quote/chart helpers used by Vercel serverless functions
// (`frontend/api/*.ts`) and the Vite dev middleware. No React imports.

export const NSE_UNIVERSE: { symbol: string; name: string; sector: string }[] = [
  { symbol: 'RELIANCE', name: 'Reliance Industries Ltd', sector: 'Energy' },
  { symbol: 'TCS', name: 'Tata Consultancy Services Ltd', sector: 'IT' },
  { symbol: 'HDFCBANK', name: 'HDFC Bank Ltd', sector: 'Banking' },
  { symbol: 'ICICIBANK', name: 'ICICI Bank Ltd', sector: 'Banking' },
  { symbol: 'INFY', name: 'Infosys Ltd', sector: 'IT' },
  { symbol: 'ITC', name: 'ITC Ltd', sector: 'FMCG' },
  { symbol: 'BHARTIARTL', name: 'Bharti Airtel Ltd', sector: 'Telecom' },
  { symbol: 'SBIN', name: 'State Bank of India', sector: 'Banking' },
  { symbol: 'KOTAKBANK', name: 'Kotak Mahindra Bank Ltd', sector: 'Banking' },
  { symbol: 'AXISBANK', name: 'Axis Bank Ltd', sector: 'Banking' },
  { symbol: 'LT', name: 'Larsen & Toubro Ltd', sector: 'Capital Goods' },
  { symbol: 'HINDUNILVR', name: 'Hindustan Unilever Ltd', sector: 'FMCG' },
  { symbol: 'SUNPHARMA', name: 'Sun Pharmaceutical Industries', sector: 'Pharma' },
  { symbol: 'BAJFINANCE', name: 'Bajaj Finance Ltd', sector: 'Financials' },
  { symbol: 'MARUTI', name: 'Maruti Suzuki India Ltd', sector: 'Auto' },
  { symbol: 'TITAN', name: 'Titan Company Ltd', sector: 'Consumer' },
  { symbol: 'ASIANPAINT', name: 'Asian Paints Ltd', sector: 'Consumer' },
  { symbol: 'ULTRACEMCO', name: 'UltraTech Cement Ltd', sector: 'Cement' },
  { symbol: 'NTPC', name: 'NTPC Ltd', sector: 'Power' },
  { symbol: 'ADANIENT', name: 'Adani Enterprises Ltd', sector: 'Conglomerate' },
  { symbol: 'ADANIPORTS', name: 'Adani Ports & SEZ Ltd', sector: 'Infrastructure' },
  { symbol: 'POWERGRID', name: 'Power Grid Corp of India', sector: 'Power' },
  { symbol: 'ONGC', name: 'Oil & Natural Gas Corp Ltd', sector: 'Energy' },
  { symbol: 'TATAMOTORS', name: 'Tata Motors Ltd', sector: 'Auto' },
  { symbol: 'TATASTEEL', name: 'Tata Steel Ltd', sector: 'Metals' },
  { symbol: 'JSWSTEEL', name: 'JSW Steel Ltd', sector: 'Metals' },
  { symbol: 'WIPRO', name: 'Wipro Ltd', sector: 'IT' },
  { symbol: 'TECHM', name: 'Tech Mahindra Ltd', sector: 'IT' },
  { symbol: 'HCLTECH', name: 'HCL Technologies Ltd', sector: 'IT' },
  { symbol: 'NESTLEIND', name: 'Nestle India Ltd', sector: 'FMCG' },
  { symbol: 'M&M', name: 'Mahindra & Mahindra Ltd', sector: 'Auto' },
  { symbol: 'TATACONSUM', name: 'Tata Consumer Products Ltd', sector: 'FMCG' },
  { symbol: 'BAJAJFINSV', name: 'Bajaj Finserv Ltd', sector: 'Financials' },
  { symbol: 'HDFCLIFE', name: 'HDFC Life Insurance Co', sector: 'Insurance' },
  { symbol: 'SBILIFE', name: 'SBI Life Insurance Co', sector: 'Insurance' },
  { symbol: 'DRREDDY', name: "Dr. Reddy's Laboratories Ltd", sector: 'Pharma' },
  { symbol: 'CIPLA', name: 'Cipla Ltd', sector: 'Pharma' },
  { symbol: 'APOLLOHOSP', name: 'Apollo Hospitals Enterprise', sector: 'Healthcare' },
  { symbol: 'GRASIM', name: 'Grasim Industries Ltd', sector: 'Cement' },
  { symbol: 'HINDALCO', name: 'Hindalco Industries Ltd', sector: 'Metals' },
  { symbol: 'BPCL', name: 'Bharat Petroleum Corp Ltd', sector: 'Energy' },
  { symbol: 'COALINDIA', name: 'Coal India Ltd', sector: 'Energy' },
  { symbol: 'EICHERMOT', name: 'Eicher Motors Ltd', sector: 'Auto' },
  { symbol: 'HEROMOTOCO', name: 'Hero MotoCorp Ltd', sector: 'Auto' },
  { symbol: 'INDUSINDBK', name: 'IndusInd Bank Ltd', sector: 'Banking' },
  { symbol: 'BRITANNIA', name: 'Britannia Industries Ltd', sector: 'FMCG' },
  { symbol: 'DIVISLAB', name: "Divi's Laboratories Ltd", sector: 'Pharma' },
  { symbol: 'BAJAJ-AUTO', name: 'Bajaj Auto Ltd', sector: 'Auto' },
  { symbol: 'TATAPOWER', name: 'Tata Power Co Ltd', sector: 'Power' },
  { symbol: 'IRCTC', name: 'Indian Railway Catering & Tourism Corp', sector: 'Travel' },
  { symbol: 'IDEA', name: 'Vodafone Idea Ltd', sector: 'Telecom' },
  { symbol: 'HAL', name: 'Hindustan Aeronautics Ltd', sector: 'Defence' },
];

export const NSE_SYMBOLS = LIVE_SYMBOLS;

export const YAHOO_HOSTS = [
  'https://query1.finance.yahoo.com',
  'https://query2.finance.yahoo.com',
];

export const YAHOO_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  Accept: 'application/json,text/plain,*/*',
  'Accept-Language': 'en-IN,en;q=0.9',
  Referer: 'https://finance.yahoo.com/',
  Origin: 'https://finance.yahoo.com',
};

export interface OHLCV {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface LiveQuote {
  symbol: string;
  name: string;
  sector: string;
  price: number;
  prevClose: number;
  changePct: number;
  change: number;
  dayHigh: number;
  dayLow: number;
  volume: number;
  ts: number;
}

export interface IndexQuote {
  symbol: string;
  price: number;
  changePct: number;
  timestamp: number;
}

export const RANGES: Record<string, { interval: string; label: string }> = {
  '1d': { interval: '1m', label: '1D' },
  '5d': { interval: '15m', label: '5D' },
  '1mo': { interval: '60m', label: '1M' },
  '6mo': { interval: '1d', label: '6M' },
  '1y': { interval: '1d', label: '1Y' },
  '5y': { interval: '1wk', label: '5Y' },
};

const META_NUM = (meta: Record<string, unknown> | undefined, k: string): number | null => {
  const v = meta?.[k];
  return typeof v === 'number' && isFinite(v) ? v : null;
};

export function yahooTicker(symbol: string): string {
  if (symbol === '^NSEI' || symbol === 'NIFTY50' || symbol === 'NIFTY') return '^NSEI';
  return `${symbol}.NS`;
}

export function stripYahooTicker(raw: string): string {
  if (raw === '^NSEI') return 'NIFTY50';
  return raw.replace(/\.(NS|BO)$/i, '').toUpperCase();
}

/** NSE cash session 09:15–15:30 IST, Mon–Fri. */
export function isIstMarketHours(now = Date.now()): boolean {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(now));
  const wd = parts.find((p) => p.type === 'weekday')?.value ?? '';
  if (wd === 'Sat' || wd === 'Sun') return false;
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  const hm = hour * 60 + minute;
  return hm >= 9 * 60 && hm <= 15 * 60 + 40;
}

function istMinutes(epochSec: number): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(epochSec * 1000));
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return hour * 60 + minute;
}

export function filterIstSession(rows: OHLCV[], range: string): OHLCV[] {
  if (range !== '1d' && range !== '5d') return rows;
  const lo = 9 * 60 + 15;
  const hi = 15 * 60 + 30;
  const kept = rows.filter((r) => {
    const m = istMinutes(r.t);
    return m >= lo && m <= hi;
  });
  return kept.length > 8 ? kept : rows;
}

export async function yahooJson<T>(pathAndQuery: string, timeoutMs = 7_000): Promise<T | null> {
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

export async function fetchChart(symbol: string, range: string, interval: string): Promise<OHLCV[] | null> {
  const tickers = symbol === '^NSEI' || symbol === 'NIFTY50' || symbol === 'NIFTY'
    ? ['^NSEI']
    : [yahooTicker(symbol), `${symbol}.BO`];
  for (const ticker of tickers) {
    const qs =
      `/v8/finance/chart/${encodeURIComponent(ticker)}` +
      `?range=${encodeURIComponent(range)}&interval=${encodeURIComponent(interval)}` +
      `&includePrePost=false&events=div%2Csplit&lang=en-IN&region=IN`;
    const body = await yahooJson<ChartBody>(qs);
    const parsed = rowsFromChart(body);
    if (parsed) return filterIstSession(parsed.rows, range);
  }
  return null;
}

function quoteFromMeta(symbol: string, meta: Record<string, unknown>): LiveQuote | null {
  const price = META_NUM(meta, 'regularMarketPrice');
  const prevClose = META_NUM(meta, 'chartPreviousClose') ?? META_NUM(meta, 'previousClose') ?? META_NUM(meta, 'regularMarketPreviousClose');
  if (price == null || prevClose == null || prevClose <= 0) return null;
  const info = NSE_UNIVERSE.find((s) => s.symbol === symbol);
  const change = price - prevClose;
  const ts = META_NUM(meta, 'regularMarketTime');
  const yahooName = typeof meta.shortName === 'string' ? meta.shortName : typeof meta.longName === 'string' ? meta.longName : '';
  return {
    symbol,
    name: info?.name ?? (yahooName || symbol),
    sector: info?.sector ?? '',
    price,
    prevClose,
    changePct: (change / prevClose) * 100,
    change,
    dayHigh: META_NUM(meta, 'regularMarketDayHigh') ?? price,
    dayLow: META_NUM(meta, 'regularMarketDayLow') ?? price,
    volume: Math.round(META_NUM(meta, 'regularMarketVolume') ?? 0),
    ts: ts != null && ts < 1e12 ? ts * 1000 : ts ?? Date.now(),
  };
}

type SparkPoint = {
  symbol?: string;
  fulldayPrice?: number;
  fulldayChange?: number;
  fulldayChangePercent?: number;
  close?: (number | null)[];
  timestamp?: number[];
  meta?: Record<string, unknown>;
};

async function fetchQuotesSpark(symbols: string[]): Promise<LiveQuote[]> {
  const tickers = symbols.map(yahooTicker).join(',');
  const qs = `/v8/finance/spark?symbols=${encodeURIComponent(tickers)}&range=1d&interval=5m&includePrePost=false`;
  const body = await yahooJson<Record<string, unknown>>(qs, 9_000);
  if (!body) return [];
  const out: LiveQuote[] = [];

  const legacy = (body as { spark?: { result?: Array<{ symbol?: string; response?: Array<{ meta?: Record<string, unknown> }> }> } }).spark?.result;
  if (Array.isArray(legacy)) {
    for (const item of legacy) {
      const raw = item.symbol ?? '';
      const sym = stripYahooTicker(raw);
      const resp = Array.isArray(item.response) ? item.response[0] : undefined;
      const q = quoteFromMeta(sym === 'NIFTY50' ? 'NIFTY50' : sym, resp?.meta ?? {});
      if (q) out.push(q);
    }
    if (out.length) return out;
  }

  for (const [key, val] of Object.entries(body)) {
    if (key === 'spark' || !val || typeof val !== 'object') continue;
    const v = val as SparkPoint;
    const raw = v.symbol ?? key;
    const sym = stripYahooTicker(raw);
    const closes = (v.close ?? []).filter((n): n is number => typeof n === 'number' && n > 0);
    const price = typeof v.fulldayPrice === 'number' ? v.fulldayPrice : closes[closes.length - 1];
    if (price == null || !(price > 0)) continue;
    const changePct = typeof v.fulldayChangePercent === 'number' ? v.fulldayChangePercent : 0;
    const prevClose = price / (1 + changePct / 100);
    const info = NSE_UNIVERSE.find((s) => s.symbol === sym);
    const ts = v.timestamp?.[v.timestamp.length - 1];
    out.push({
      symbol: sym === 'NIFTY50' ? 'NIFTY50' : sym,
      name: info?.name ?? sym,
      sector: info?.sector ?? '',
      price,
      prevClose,
      changePct,
      change: typeof v.fulldayChange === 'number' ? v.fulldayChange : price - prevClose,
      dayHigh: closes.length ? Math.max(...closes) : price,
      dayLow: closes.length ? Math.min(...closes) : price,
      volume: 0,
      ts: ts != null ? (ts < 1e12 ? ts * 1000 : ts) : Date.now(),
    });
  }
  return out;
}

async function fetchQuotesChart(symbols: string[]): Promise<LiveQuote[]> {
  const out: LiveQuote[] = [];
  const pool = 6;
  let cursor = 0;
  const workers = Array.from({ length: Math.min(pool, symbols.length) }, async () => {
    while (true) {
      const idx = cursor;
      cursor += 1;
      if (idx >= symbols.length) return;
      const symbol = symbols[idx];
      let q: LiveQuote | null = null;
      for (const ticker of [yahooTicker(symbol), `${symbol}.BO`]) {
        const qs = `/v8/finance/chart/${encodeURIComponent(ticker)}?range=1d&interval=5m&includePrePost=false`;
        const body = await yahooJson<ChartBody>(qs, 5_000);
        const parsed = rowsFromChart(body);
        q = quoteFromMeta(symbol, parsed?.meta ?? {});
        if (q) break;
      }
      if (q) out.push(q);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function fetchQuotesFor(symbols: string[]): Promise<LiveQuote[]> {
  const unique = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter((s) => s && s !== 'NIFTY50' && s !== '^NSEI'))];
  const quotes: LiveQuote[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < unique.length; i += 20) {
    const got = await fetchQuotesSpark(unique.slice(i, i + 20));
    for (const q of got) {
      if (seen.has(q.symbol)) continue;
      seen.add(q.symbol);
      quotes.push(q);
    }
  }
  const missing = unique.filter((s) => !seen.has(s));
  if (missing.length) {
    const extra = await fetchQuotesChart(missing.slice(0, 12));
    for (const q of extra) {
      if (seen.has(q.symbol)) continue;
      seen.add(q.symbol);
      quotes.push(q);
    }
  }
  return quotes;
}

export async function fetchLiveBundle(extra: string[] = []): Promise<{
  ts: number;
  quotes: LiveQuote[];
  index: IndexQuote | null;
}> {
  const quotes = await fetchQuotesFor(extra.length ? extra : LIVE_SYMBOLS);

  let index: IndexQuote | null = null;
  const niftySpark = await fetchQuotesSpark(['^NSEI']);
  const nifty = niftySpark[0] ?? (await fetchQuotesChart(['^NSEI']))[0];
  if (nifty) {
    index = { symbol: 'NIFTY 50', price: nifty.price, changePct: nifty.changePct, timestamp: nifty.ts };
  }

  return { ts: Date.now(), quotes, index };
}

export function jsonHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store, max-age=0',
    'Access-Control-Allow-Origin': '*',
  };
}

// OHLCV chart relay for the static deploy. Mirrors Google Finance ranges
// (1D defaults to 1-minute bars during the NSE cash session).

const TTL_MS = 20_000;
const cache: Record<string, { at: number; rows: OHLCV[] }> = {};

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const symbol = (url.searchParams.get('symbol') ?? url.searchParams.get('Symbol') ?? '')
    .toUpperCase()
    .trim();
  const range = (url.searchParams.get('range') ?? '1d').toLowerCase();

  if (!/^[A-Z0-9][A-Z0-9&-]{0,19}$/.test(symbol) && symbol !== '^NSEI' && symbol !== 'NIFTY50' && symbol !== 'NIFTY') {
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
  const key = `${symbol}:${range}`;
  const hit = cache[key];
  if (hit && now - hit.at < TTL_MS) {
    return new Response(
      JSON.stringify({ symbol, range, interval: spec.interval, currency: 'INR', source: 'cache', rows: hit.rows }),
      { status: 200, headers: jsonHeaders() },
    );
  }

  const rows = await fetchChart(symbol, range, spec.interval);
  if (!rows) {
    return new Response(JSON.stringify({ error: 'chart unavailable for symbol' }), {
      status: 404,
      headers: jsonHeaders(),
    });
  }

  cache[key] = { at: now, rows };
  return new Response(
    JSON.stringify({ symbol, range, interval: spec.interval, currency: 'INR', source: 'yahoo', rows }),
    { status: 200, headers: jsonHeaders() },
  );
}
