// Global commodity quotes for the dashboard (Yahoo chart meta).
// Brent/WTI, gold/silver, copper/aluminium, and USD/INR.
// India has no clean public tape for these in the NSE relay.

import { YAHOO_HEADERS, YAHOO_HOSTS } from './live';

export interface MacroQuote {
  id: string;
  name: string;
  group: 'Crude oil' | 'Bullion' | 'Metals' | 'Currency';
  ticker: string;
  unit: string;
  price: number;
  changePct: number;
}

const SPECS: { id: string; name: string; group: MacroQuote['group']; ticker: string; unit: string }[] = [
  { id: 'brent', name: 'Brent crude', group: 'Crude oil', ticker: 'BZ=F', unit: 'USD/bbl' },
  { id: 'wti', name: 'WTI crude', group: 'Crude oil', ticker: 'CL=F', unit: 'USD/bbl' },
  { id: 'gold', name: 'Gold', group: 'Bullion', ticker: 'GC=F', unit: 'USD/oz' },
  { id: 'silver', name: 'Silver', group: 'Bullion', ticker: 'SI=F', unit: 'USD/oz' },
  { id: 'copper', name: 'Copper', group: 'Metals', ticker: 'HG=F', unit: 'USD/lb' },
  { id: 'aluminium', name: 'Aluminium', group: 'Metals', ticker: 'ALI=F', unit: 'USD/t' },
  { id: 'usdinr', name: 'USD / INR', group: 'Currency', ticker: 'INR=X', unit: '₹ per $' },
];

type ChartBody = {
  chart?: {
    result?: Array<{ meta?: Record<string, unknown> }>;
  };
};

const num = (meta: Record<string, unknown> | undefined, key: string): number | null => {
  const v = meta?.[key];
  return typeof v === 'number' && isFinite(v) ? v : null;
};

async function yahooChart(ticker: string): Promise<ChartBody | null> {
  const path =
    `/v8/finance/chart/${encodeURIComponent(ticker)}` +
    '?range=5d&interval=1d&includePrePost=false';
  for (const host of YAHOO_HOSTS) {
    try {
      const res = await fetch(`${host}${path}`, {
        headers: YAHOO_HEADERS,
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      return (await res.json()) as ChartBody;
    } catch {
      continue;
    }
  }
  return null;
}

async function one(spec: (typeof SPECS)[number]): Promise<MacroQuote | null> {
  const body = await yahooChart(spec.ticker);
  const meta = body?.chart?.result?.[0]?.meta;
  const price = num(meta, 'regularMarketPrice');
  const prev =
    num(meta, 'chartPreviousClose') ??
    num(meta, 'previousClose') ??
    num(meta, 'regularMarketPreviousClose');
  if (price == null || prev == null || prev <= 0) return null;
  return {
    id: spec.id,
    name: spec.name,
    group: spec.group,
    ticker: spec.ticker,
    unit: spec.unit,
    price,
    changePct: ((price - prev) / prev) * 100,
  };
}

let cache: { at: number; quotes: MacroQuote[] } | null = null;
const TTL_MS = 60_000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=60',
    },
  });
}

export async function GET(): Promise<Response> {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) {
    return json({ quotes: cache.quotes, source: 'cache', asOf: cache.at });
  }
  const quotes = (await Promise.all(SPECS.map(one))).filter((q): q is MacroQuote => q != null);
  if (!quotes.length) return json({ error: 'commodity quotes unavailable', quotes: [] }, 502);
  cache = { at: now, quotes };
  return json({ quotes, source: 'yahoo', asOf: now });
}
