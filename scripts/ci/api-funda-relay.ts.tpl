// ----------------------------------------------------------------------
// NOTE: this handler is self-contained on purpose. Vercel compiles each api/*.ts
// as its OWN function and does NOT bundle relative imports, so any
// import ... from './x' (or from '../src/...') makes the emitted lambda crash
// with an instant empty 500. The full fundamentals engine from
// src/lib/funda.ts is inlined above by scripts/ci/regen-api-funda.mjs — keep
// the engine and this relay in sync via that script.
// ----------------------------------------------------------------------
// On-demand fundamentals + analyst model relay.
//
// Computes the same analysis that the nightly batch produces
// (`scripts/ci/fundamentals.ts` -> analysis.json) for ANY symbol, live, using
// free Yahoo quoteSummary data + Screener.in ratios (consolidated view
// preferred, standalone fallback) + Finology sector key-ratios (PEG always
// derived from Screener PE ÷ earnings growth). Results are cached
// in-memory for 6h and merged into the frontend store, so
// watchlisted/viewed stocks get full fundamentals without waiting for the
// nightly run — while prices keep updating through /api/live and /api/chart.
//
// GET /api/funda?symbols=RELIANCE,TCS   (comma list, max 8)

interface UniverseRow {
  symbol: string;
  name: string;
  cap: string | null;
  mktCap: number | null;
}

// NOTE: kept self-contained (no `import ... from './chart'`) — Vercel builds
// every api/*.ts as its own function, and cross-function imports break the
// emitted lambdas at runtime (instant 500).
const NSE_UNIVERSE: { symbol: string; name: string; sector: string }[] = [
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

function jsonHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store, max-age=0',
    'Access-Control-Allow-Origin': '*',
  };
}

const TTL_MS = 6 * 3600 * 1000;
const cache = new Map<string, { at: number; hash: string }>();

const SYM_RE = /^[A-Z0-9&-]{1,20}$/;

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

async function peersFor(
  symbol: string,
  universe: Map<string, UniverseRow>,
): Promise<{ symbol: string; name: string | null; industry: null; sector: string | null }[]> {
  // Real competitors from Screener.in's peer table first.
  try {
    const scr = await screenerPeers(symbol);
    if (scr.length) {
      return scr.slice(0, 8).map((p) => {
        const u = universe.get(p);
        return { symbol: p, name: u?.name ?? null, industry: null as null, sector: u?.cap ?? null };
      });
    }
  } catch {
    // fall through to market-cap proximity
  }
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
        const [yahooData, sf] = await Promise.all([
          yahoo.quoteSummary(`${sym}.NS`),
          fetchRealFundamentals(sym),
        ]);
        applyYahoo(m, yahooData);
        applyScreener(m, sf);
        m.growth = m.earningsGrowth ?? m.revenueGrowth;
        const entry = buildEntry({
          symbol: sym,
          name: m.name ?? sym,
          m,
          price: m.price,
          financials: sf ?? null,
          peers: await peersFor(sym, universe),
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