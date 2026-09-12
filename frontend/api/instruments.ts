// TradeAlgo serverless account API — GET /api/instruments.
// Serves the CDN universe as Instrument[] for the trading symbol picker.
// Self-contained (see api/auth/signup.ts header note). No store needed.
const UNIVERSE_URL = 'https://raw.githubusercontent.com/amant03/trading_algo/automation-data/frontend/public/universe.json';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

function symId(symbol: string): number {
  let h = 0;
  for (const c of symbol) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}

let cache: { at: number; body: string } | null = null;

export async function GET(): Promise<Response> {
  try {
    const now = Date.now();
    if (!cache || now - cache.at > 5 * 60_000) {
      const res = await fetch(UNIVERSE_URL, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) return json({ error: 'instrument list unavailable — try again' }, 503);
      const j = (await res.json()) as {
        stocks?: Array<{ symbol: string; name: string; exchange: string; isin: string; mktCap: number | null }>;
      };
      const list = (j.stocks ?? []).map((s) => ({
        id: symId(String(s.symbol).toUpperCase()),
        symbol: String(s.symbol).toUpperCase(),
        name: String(s.name ?? s.symbol),
        sector: '',
        isin: String(s.isin ?? ''),
        exchange: String(s.exchange ?? 'NSE'),
        marketCap: typeof s.mktCap === 'number' ? s.mktCap : 0,
        basePrice: 0,
      }));
      cache = { at: now, body: JSON.stringify(list) };
    }
    return new Response(cache.body, {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch {
    return json({ error: 'instrument list unavailable — try again' }, 503);
  }
}
