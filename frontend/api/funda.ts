// On-demand fundamentals + analyst model relay.
//
// Computes the same analysis that the nightly batch produces
// (`scripts/ci/fundamentals.ts` -> analysis.json) for ANY symbol, live, using
// free Yahoo quoteSummary data. Results are cached in-memory for 6h (~once a
// day, matching the "ratios refresh daily, prices keep streaming" model) and
// merged into the frontend store, so watchlisted/viewed stocks get full
// fundamentals/AI-data without waiting for the nightly run — while prices keep
// updating through /api/live and /api/chart as usual.
//
// GET /api/funda?symbols=RELIANCE,TCS   (comma list, max 8)

import { makeYahoo, emptyMetrics, applyYahoo, extractCompanion, buildEntry } from '../src/lib/funda';
import { jsonHeaders, NSE_UNIVERSE } from './chart';

interface UniverseRow {
  symbol: string;
  name: string;
  cap: string | null;
  mktCap: number | null;
}

const TTL_MS = 6 * 3600 * 1000;
const cache = new Map<string, { at: number; hash: string }>();

const SYM_RE = /^[A-Z0-9&-]{1,20}$/;

function lastHash(entries: string[]): string {
  return [...entries].sort().join(',');
}

async function loadUniverse(base: string): Promise<Map<string, UniverseRow>> {
  const map = new Map<string, UniverseRow>();
  try {
    const res = await fetch(`${base}/universe.json`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return map;
    const data = (await res.json()) as { stocks?: UniverseRow[] };
    for (const u of data.stocks ?? []) {
      if (u?.symbol) map.set(u.symbol, u);
    }
  } catch {
    // universe unavailable — peers fall back to the NSE seed
  }
  return map;
}

function peersFor(symbol: string, universe: Map<string, UniverseRow>): { symbol: string; name: string | null; industry: null; sector: null }[] {
  const me = universe.get(symbol);
  if (!me) {
    return NSE_UNIVERSE.filter((s) => s.symbol !== symbol)
      .slice(0, 6)
      .map((s) => ({ symbol: s.symbol, name: s.name, industry: null as null, sector: s.sector }));
  }
  const sameCap = [...universe.values()]
    .filter((u) => u.symbol !== symbol && (u.cap ?? '') === (me.cap ?? ''))
    .sort((a, b) => Math.abs((a.mktCap ?? 0) - (me.mktCap ?? 0)) - Math.abs((b.mktCap ?? 0) - (me.mktCap ?? 0)));
  return (sameCap.length ? sameCap : [...universe.values()].filter((u) => u.symbol !== symbol))
    .slice(0, 6)
    .map((u) => ({ symbol: u.symbol, name: u.name, industry: null as null, sector: u.cap ?? null }));
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const raw = (url.searchParams.get('symbols') ?? url.searchParams.get('symbol') ?? '')
    .toUpperCase()
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => SYM_RE.test(s));
  const uniq: string[] = [...new Set(raw)].slice(0, 8);

  if (!uniq.length) {
    return new Response(JSON.stringify({ error: 'missing or invalid symbols' }), {
      status: 400,
      headers: jsonHeaders(),
    });
  }

  const need = uniq.filter((s) => !cache.has(s));
  if (need.length) {
    const yahoo = await makeYahoo();
    const base = url.origin;
    const universe = await loadUniverse(base);
    await Promise.all(
      need.map(async (sym) => {
        const m = emptyMetrics(sym, { name: NSE_UNIVERSE.find((s) => s.symbol === sym)?.name ?? sym });
        const yahooData = await yahoo.quoteSummary(`${sym}.NS`);
        applyYahoo(m, yahooData);
        const entry = buildEntry({
          symbol: sym,
          name: m.name ?? sym,
          m,
          price: m.price,
          peers: peersFor(sym, universe),
          quarterEnd: extractCompanion(yahooData).quarterEnd,
        });
        cache.set(sym, { at: Date.now(), hash: JSON.stringify(entry) });
      }),
    );
  }

  const stocks: Record<string, unknown> = {};
  let stale = 0;
  for (const sym of uniq) {
    const hit = cache.get(sym);
    if (!hit) continue;
    if (Date.now() - hit.at > TTL_MS) {
      stale += 1;
      cache.delete(sym);
      continue;
    }
    try {
      stocks[sym] = JSON.parse(hit.hash);
    } catch {
      // skip corrupt cache entry
    }
  }

  if (!Object.keys(stocks).length) {
    return new Response(JSON.stringify({ error: 'fundamentals unavailable for symbols' }), {
      status: 404,
      headers: jsonHeaders(),
    });
  }

  return new Response(
    JSON.stringify({ generatedAt: new Date().toISOString(), staleSkipped: stale, stocks }),
    { status: 200, headers: jsonHeaders() },
  );
}