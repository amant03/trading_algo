// "Most attractive now" relay — live TradingView scanner query per market.
//
// Same unofficial scanner endpoint as api/tv.ts and api/us.ts (no login):
//   POST https://scanner.tradingview.com/global/scan
//   markets ["india"] for NSE/BSE, ["america"] for NYSE/NASDAQ.
//
// Attractiveness score (0–100, transparent by design — the UI shows the
// formula and each row's top reasons):
//   35 × normalised TV technical rating (Recommend.All, daily)
//   20 × day momentum (change %, clamped ±5)
//   10 × week momentum (Perf.W, clamped ±10)
//   15 × RSI sweet-spot (peaks at 45, zero outside 15–75)
//   10 × relative volume (volume / 30d average, capped at 3×)
//   10 × value (PE < 25 → 10, < 40 → 5, else 0)
//
// GET /api/attractive?market=in|us&sector=&cap=&limit=50
//   market: "in" (default, INR) or "us" (USD)
//   sector: exact TradingView sector name, or omit for all
//   cap: mega|large|mid|small (buckets in local currency), or omit for all
//   limit: rows to return, default 50, max 100

const SCAN_URL = 'https://scanner.tradingview.com/global/scan';
const POOL = 150;

const TV_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Origin: 'https://www.tradingview.com',
  Referer: 'https://www.tradingview.com/',
};

const COLUMNS = [
  'name', // 0
  'description', // 1
  'close', // 2
  'change', // 3  (day %)
  'Perf.W', // 4  (week %)
  'volume', // 5
  'average_volume_30d_calc', // 6
  'market_cap_basic', // 7
  'price_earnings_ttm', // 8
  'sector', // 9
  'exchange', // 10
  'RSI', // 11
  'Recommend.All', // 12
];

export type CapBucket = 'mega' | 'large' | 'mid' | 'small';

export interface AttractiveRow {
  symbol: string;
  name: string;
  price: number | null;
  changePct: number | null;
  weekPct: number | null;
  volume: number | null;
  relVol: number | null;
  marketCap: number | null; // always USD (that is what the scanner returns)
  marketCapDisplay: string; // local-currency string: ₹L cr / $T
  capBucket: CapBucket | null;
  pe: number | null;
  sector: string;
  exchange: string;
  rsi: number | null;
  rating: number | null;
  score: number;
  reasons: string[];
}

const num = (v: unknown): number | null => (typeof v === 'number' && isFinite(v) ? v : null);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

function capBucketFor(market: 'in' | 'us', mcap: number | null): CapBucket | null {
  if (mcap == null) return null;
  if (market === 'us') {
    // USD: mega $200B+, large $10B+, mid $2B+, else small
    if (mcap >= 2e11) return 'mega';
    if (mcap >= 1e10) return 'large';
    if (mcap >= 2e9) return 'mid';
    return 'small';
  }
  // USD equivalent of ₹1L cr+ / ₹25k cr+ (≈ $11B / $2.8B at ~88)
  if (mcap >= 1.1e10) return 'large';
  if (mcap >= 2.8e9) return 'mid';
  return 'small';
}

const USDINR = 88; // display-only conversion for Indian market caps

function capDisplay(market: 'in' | 'us', mcap: number | null): string {
  if (mcap == null) return '—';
  if (market === 'us') {
    if (mcap >= 1e12) return `$${(mcap / 1e12).toFixed(2)}T`;
    if (mcap >= 1e9) return `$${(mcap / 1e9).toFixed(2)}B`;
    return `$${(mcap / 1e6).toFixed(0)}M`;
  }
  const inr = mcap * USDINR;
  if (inr >= 1e12) return `₹${(inr / 1e12).toFixed(2)}L cr`;
  if (inr >= 1e10) return `₹${(inr / 1e7).toFixed(0)}K cr`;
  return `₹${(inr / 1e7).toFixed(1)} cr`;
}

// Pool rows can repeat a company per exchange (NSE+BSE, NASDAQ+OTC ADRs).
// Keep one row per symbol, preferring the primary listing venue.
const VENUE_RANK: Record<string, number> = { NSE: 0, NASDAQ: 0, NYSE: 0, BSE: 1, AMEX: 1 };
const venueRank = (ex: string): number => VENUE_RANK[ex.toUpperCase()] ?? 2;

// US view is for primary listings — drop OTC foreign ordinaries/ADRs.
const EXCLUDE_VENUE: Record<'in' | 'us', string[]> = { in: [], us: ['OTC', 'PINK', 'OTCQB', 'OTCQX'] };

const signed = (v: number | null, digits: number): string =>
  v == null ? 'n/a' : `${v >= 0 ? '+' : ''}${v.toFixed(digits)}`;

function scoreRow(
  r: Omit<AttractiveRow, 'score' | 'reasons' | 'capBucket'>,
  market: 'in' | 'us',
): { score: number; reasons: string[]; capBucket: CapBucket | null } {
  const parts: { pts: number; label: string }[] = [];
  const rating = r.rating ?? 0;
  parts.push({ pts: ((clamp(rating, -1, 1) + 1) / 2) * 35, label: `TV rating ${signed(r.rating, 2)}` });
  parts.push({ pts: ((clamp(r.changePct ?? 0, -5, 5) + 5) / 10) * 20, label: `day ${signed(r.changePct, 1)}%` });
  parts.push({ pts: ((clamp(r.weekPct ?? 0, -10, 10) + 10) / 20) * 10, label: `week ${signed(r.weekPct, 1)}%` });
  if (r.rsi != null) {
    parts.push({ pts: 15 * Math.max(0, 1 - Math.abs(r.rsi - 45) / 30), label: `RSI ${r.rsi.toFixed(0)}` });
  }
  if (r.relVol != null) {
    parts.push({ pts: Math.min(r.relVol, 3) / 3 * 10, label: `${r.relVol.toFixed(1)}× avg volume` });
  }
  if (r.pe != null && r.pe > 0) {
    if (r.pe < 25) parts.push({ pts: 10, label: `PE ${r.pe.toFixed(0)} (value)` });
    else if (r.pe < 40) parts.push({ pts: 5, label: `PE ${r.pe.toFixed(0)} (fair)` });
    else parts.push({ pts: 0, label: `PE ${r.pe.toFixed(0)} (pricey)` });
  }
  const score = Math.round(parts.reduce((a, p) => a + p.pts, 0) * 10) / 10;
  const reasons = parts
    .filter((p) => p.pts > 0.5)
    .sort((a, b) => b.pts - a.pts)
    .slice(0, 3)
    .map((p) => p.label);
  if (!reasons.length) reasons.push('broad market screen');
  return { score, reasons, capBucket: capBucketFor(market, r.marketCap) };
}

interface ScanBody {
  data?: { s: string; d: (number | string | null)[] }[];
  totalCount?: number;
}

async function fetchPool(market: 'in' | 'us'): Promise<ScanBody> {
  const res = await fetch(SCAN_URL, {
    method: 'POST',
    headers: TV_HEADERS,
    body: JSON.stringify({
      filter: [],
      options: { lang: 'en' },
      symbols: { query: { types: [] }, tickers: [] },
      sort: { sortBy: 'market_cap_basic', sortOrder: 'desc' },
      range: [0, POOL],
      columns: COLUMNS,
      markets: [market === 'in' ? 'india' : 'america'],
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`tradingview scan failed: ${res.status}`);
  return (await res.json()) as ScanBody;
}

export function jsonHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store, max-age=0',
    'Access-Control-Allow-Origin': '*',
  };
}

const TTL_MS = 60_000;

interface CacheVal { at: number; market: string; rows: AttractiveRow[]; sectors: { name: string; count: number }[]; total: number }
let cache: CacheVal | null = null;
let inflight: Promise<CacheVal> | null = null;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders() });
}

async function build(market: 'in' | 'us'): Promise<CacheVal> {
  const body = await fetchPool(market);
  const seen = new Map<string, AttractiveRow>();
  for (const row of body.data ?? []) {
    const d = row.d ?? [];
    const ticker = (str(row.s).split(':').pop() ?? str(row.s)).toUpperCase();
    const exchange = str(d[10]);
    if (EXCLUDE_VENUE[market].includes(exchange.toUpperCase())) continue;
    const prev = seen.get(ticker);
    if (prev && venueRank(prev.exchange) <= venueRank(exchange)) continue;
    const volume = num(d[5]);
    const avgVol = num(d[6]);
    const mcap = num(d[7]);
    const base = {
      symbol: ticker,
      name: str(d[1]) || str(d[0]) || ticker,
      price: num(d[2]),
      changePct: num(d[3]),
      weekPct: num(d[4]),
      volume: volume != null ? Math.round(volume) : null,
      relVol: volume != null && avgVol != null && avgVol > 0 ? Math.round((volume / avgVol) * 10) / 10 : null,
      marketCap: mcap,
      marketCapDisplay: capDisplay(market, mcap),
      pe: num(d[8]),
      sector: str(d[9]),
      exchange,
      rsi: num(d[11]),
      rating: num(d[12]),
    };
    if (base.price == null || base.price <= 0) continue;
    const { score, reasons, capBucket } = scoreRow(base, market);
    seen.set(ticker, { ...base, score, reasons, capBucket });
  }
  const all = [...seen.values()];

  const sectorCounts = new Map<string, number>();
  for (const r of all) {
    if (r.sector) sectorCounts.set(r.sector, (sectorCounts.get(r.sector) ?? 0) + 1);
  }
  const sectors = [...sectorCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  return { at: Date.now(), market, rows: all, sectors, total: body.totalCount ?? all.length };
}

export async function GET(request?: Request): Promise<Response> {
  let market: 'in' | 'us' = 'in';
  let sector = '';
  let cap = '';
  let limit = 50;
  if (request) {
    try {
      const q = new URL(request.url).searchParams;
      const m = (q.get('market') ?? 'in').toLowerCase();
      market = m === 'us' || m === 'usa' || m === 'america' ? 'us' : 'in';
      sector = (q.get('sector') ?? '').trim();
      cap = (q.get('cap') ?? '').trim().toLowerCase();
      const n = Number(q.get('limit') ?? 50);
      limit = isFinite(n) ? Math.max(1, Math.min(Math.floor(n), 100)) : 50;
    } catch {
      // defaults
    }
  }
  const now = Date.now();

  try {
    if (!cache || cache.market !== market || now - cache.at > TTL_MS) {
      if (!inflight) {
        inflight = build(market).finally(() => {
          inflight = null;
        });
      }
      cache = await inflight;
    }
    let rows = cache.rows;
    if (sector) rows = rows.filter((r) => r.sector === sector);
    if (cap) rows = rows.filter((r) => r.capBucket === cap);
    rows = [...rows].sort((a, b) => b.score - a.score).slice(0, limit);
    return json({
      ts: cache.at,
      source: 'tradingview',
      market,
      currency: market === 'in' ? 'INR' : 'USD',
      total: cache.total,
      count: rows.length,
      sectors: cache.sectors,
      rows,
    });
  } catch (err) {
    if (cache?.rows.length) {
      let rows = cache.rows;
      if (sector) rows = rows.filter((r) => r.sector === sector);
      if (cap) rows = rows.filter((r) => r.capBucket === cap);
      rows = [...rows].sort((a, b) => b.score - a.score).slice(0, limit);
      return json({ ts: cache.at, source: 'stale', market, currency: market === 'in' ? 'INR' : 'USD', total: cache.total, count: rows.length, sectors: cache.sectors, rows });
    }
    return json({ error: err instanceof Error ? err.message : 'attractive scan unavailable', rows: [] }, 503);
  }
}
