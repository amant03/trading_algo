// Yahoo-backed Indian equity search (NSE + BSE). Complements the local
// universe.json so names that aren't in the snapshot still resolve.

import { jsonHeaders, stripYahooTicker } from '../src/lib/nse';

interface Hit {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') ?? '').trim();
  if (q.length < 1 || q.length > 40) {
    return new Response(JSON.stringify({ q, hits: [] }), { status: 200, headers: jsonHeaders() });
  }
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}` +
        `&quotesCount=20&newsCount=0&listsCount=0&region=IN&lang=en-IN`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(6_000),
      },
    );
    if (!res.ok) throw new Error(`yahoo ${res.status}`);
    const body = (await res.json()) as {
      quotes?: Array<{ symbol?: string; shortname?: string; longname?: string; quoteType?: string; exchange?: string }>;
    };
    const hits: Hit[] = [];
    const seen = new Set<string>();
    for (const row of body.quotes ?? []) {
      const raw = String(row.symbol ?? '');
      if (row.quoteType && row.quoteType !== 'EQUITY') continue;
      if (!/\.(NS|BO)$/i.test(raw)) continue;
      const symbol = stripYahooTicker(raw);
      const exchange = /\.BO$/i.test(raw) ? 'BSE' : 'NSE';
      if (seen.has(symbol)) {
        if (exchange === 'NSE') {
          const hit = hits.find((h) => h.symbol === symbol);
          if (hit) hit.exchange = 'NSE';
        }
        continue;
      }
      seen.add(symbol);
      hits.push({
        symbol,
        name: String(row.longname || row.shortname || symbol),
        exchange,
        type: 'EQUITY',
      });
    }
    return new Response(JSON.stringify({ q, hits }), { status: 200, headers: jsonHeaders() });
  } catch {
    return new Response(JSON.stringify({ q, hits: [] }), { status: 200, headers: jsonHeaders() });
  }
}
