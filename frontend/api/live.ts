// Near-live NSE/BSE quotes. Default tape is the top ~120 names by market cap.
// Pass ?symbols=FOO,BAR to overlay any listed Indian stock on demand.

import { fetchLiveBundle, jsonHeaders, type IndexQuote, type LiveQuote } from '../src/lib/nse';

const TTL_MS = 12_000;

let cache: { at: number; quotes: LiveQuote[]; index: IndexQuote | null } | null = null;
let inflight: Promise<{ ts: number; quotes: LiveQuote[]; index: IndexQuote | null }> | null = null;

function parseSymbols(request?: Request): string[] {
  if (!request) return [];
  try {
    const url = new URL(request.url);
    return (url.searchParams.get('symbols') ?? '')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter((s) => /^[A-Z0-9][A-Z0-9&-]{0,19}$/.test(s))
      .slice(0, 24);
  } catch {
    return [];
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders() });
}

export async function GET(request?: Request): Promise<Response> {
  const extra = parseSymbols(request);
  const now = Date.now();

  if (extra.length) {
    try {
      const data = await fetchLiveBundle(extra);
      if (data.quotes.length && cache) {
        const by = new Map(cache.quotes.map((q) => [q.symbol, q]));
        for (const q of data.quotes) by.set(q.symbol, q);
        cache = { at: Date.now(), quotes: [...by.values()], index: data.index ?? cache.index };
      }
      return json({ ts: data.ts, source: 'yahoo', quotes: data.quotes, index: data.index ?? cache?.index ?? null });
    } catch (err) {
      const stale = extra
        .map((s) => cache?.quotes.find((q) => q.symbol === s))
        .filter((q): q is LiveQuote => Boolean(q));
      if (stale.length) return json({ ts: cache?.at ?? now, source: 'stale', quotes: stale, index: cache?.index ?? null });
      return json({ error: err instanceof Error ? err.message : 'live quotes unavailable', quotes: [], index: null }, 503);
    }
  }

  if (cache && now - cache.at < TTL_MS && cache.quotes.length) {
    return json({ ts: now, source: 'cache', quotes: cache.quotes, index: cache.index });
  }

  try {
    if (!inflight) {
      inflight = fetchLiveBundle([]).finally(() => {
        inflight = null;
      });
    }
    const data = await inflight;
    if (data.quotes.length) {
      cache = { at: Date.now(), quotes: data.quotes, index: data.index };
    }
    return json({ ts: data.ts, source: 'yahoo', quotes: data.quotes, index: data.index });
  } catch (err) {
    if (cache?.quotes.length) {
      return json({ ts: cache.at, source: 'stale', quotes: cache.quotes, index: cache.index });
    }
    return json({ error: err instanceof Error ? err.message : 'live quotes unavailable', quotes: [], index: null }, 503);
  }
}
