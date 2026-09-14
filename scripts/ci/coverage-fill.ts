// Gap-fill automation — fetches the data points the coverage audit found
// missing, from free fallback sources, and stores them for the UI.
//
// Source status (probed 2026-09-13):
//   Yahoo Finance ........ primary (quotes, daily+intraday candles) — works
//   screener.in .......... search API + server-rendered ratio pages — works,
//                          used for missing FUNDAMENTALS (no key, be polite)
//   TradingView scanner .. unofficial scan endpoint — works, used for missing
//                          QUOTES and as fundamentals fallback
//   Stooq ................ JS-challenge blocked — NOT usable
//   ticker.finology.in ... Cloudflare 403 — NOT usable
//
// Writes: frontend/public/fills.json
//   { generatedAt, stats, fundamentals: { SYM: {...} }, quotes: { SYM: {...} } }
// Intraday/history gaps have no historical fallback source; they are recorded
// in coverage.json and served going forward by the chart relay's interval
// fallback (frontend/api/chart.ts).
//
// Run:  npx tsx scripts/ci/coverage-fill.ts
// Envs: COVERAGE_FILL_MAX (fundamentals cap per run, default 800),
//       COVERAGE_FILL_POOL (screener concurrency, default 4).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const PUB = join(process.cwd(), 'frontend', 'public');
const COVERAGE_FILE = join(PUB, 'coverage.json');
const OUT = join(PUB, 'fills.json');
const FILL_MAX = Number(process.env.COVERAGE_FILL_MAX ?? 800);
const POOL = Number(process.env.COVERAGE_FILL_POOL ?? 4);
const PAUSE_MS = 400;
const USDINR = 88; // display-only conversion: TV market caps arrive in USD
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface FillFunda {
  name: string | null;
  sector: string | null;
  price: number | null;
  marketCapCr: number | null;
  pe: number | null;
  pb: number | null;
  roe: number | null;
  roce: number | null;
  debtToEquity: number | null;
  divYield: number | null;
  bookValue: number | null;
  faceValue: number | null;
  weekHigh52: number | null;
  weekLow52: number | null;
  source: 'screener.in' | 'tradingview';
  asOf: string;
}

interface FillQuote {
  price: number;
  volume: number | null;
  marketCap: number | null;
  source: 'tradingview';
  asOf: string;
}

const num = (v: unknown): number | null => {
  if (typeof v !== 'number' || !isFinite(v)) return null;
  return v;
};

// ---- screener.in ---------------------------------------------------------------

const failSamples: string[] = [];
const noteFail = (s: string) => {
  if (failSamples.length < 8) failSamples.push(s);
};

async function fetchText(url: string, timeoutMs: number): Promise<string | null> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(timeoutMs) });
      if (res.status === 429 || res.status >= 500) {
        await sleep(2000 * attempt);
        continue;
      }
      if (!res.ok) return null;
      return await res.text();
    } catch {
      await sleep(1500 * attempt);
    }
  }
  return null;
}

async function screenerSearch(symbol: string): Promise<string | null> {
  // Stagger + retry: screener.in rate-limits rapid bursts.
  await sleep(PAUSE_MS * (1 + Math.random()));
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`https://www.screener.in/api/company/search/?q=${encodeURIComponent(symbol)}`, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(12_000),
      });
      if (res.status === 429 || res.status >= 500) {
        await sleep(2000 * attempt);
        continue;
      }
      if (!res.ok) return null;
      const j = (await res.json()) as Array<{ url?: string }>;
      const url = j?.[0]?.url;
      return typeof url === 'string' && url.startsWith('/company/') ? `https://www.screener.in${url}` : null;
    } catch {
      await sleep(1500 * attempt);
    }
  }
  return null;
}

const RATIO_RE =
  /<span[^>]*>\s*([^<>]{1,30}?)\s*<\/span>\s*<span class="nowrap value">\s*(₹)?\s*<span class="number">\s*([\d,.\-]+)\s*<\/span>\s*([^<]{0,14})/gi;

function parseScreenerRatios(html: string): Record<string, { value: number; unit: string }> {
  const out: Record<string, { value: number; unit: string }> = {};
  let m: RegExpExecArray | null;
  RATIO_RE.lastIndex = 0;
  while ((m = RATIO_RE.exec(html))) {
    const label = m[1].trim().toLowerCase();
    const raw = m[3].replace(/,/g, '');
    const v = Number(raw);
    if (!isFinite(v)) continue;
    if (!(label in out)) out[label] = { value: v, unit: `${m[2] ?? ''}${m[4].trim()}` };
  }
  return out;
}

const getRatio = (r: Record<string, { value: number; unit: string }>, label: string): number | null => {
  const hit = r[label.toLowerCase()];
  return hit ? hit.value : null;
};

async function screenerFill(symbol: string): Promise<Omit<FillFunda, 'source' | 'asOf'> | null> {
  const url = await screenerSearch(symbol);
  if (!url) {
    noteFail(`${symbol}: search miss`);
    return null;
  }
  await sleep(PAUSE_MS);
  const html = await fetchText(url, 20_000);
  if (!html) {
    noteFail(`${symbol}: page fetch failed`);
    return null;
  }
  if (html.length < 20_000) {
    noteFail(`${symbol}: stub page (${html.length}b)`);
    return null;
  }
  const r = parseScreenerRatios(html);
  const mcap = getRatio(r, 'market cap');
  const capUnit = (r['market cap']?.unit ?? '').toLowerCase();
  const name = html.match(/<h1[^>]*>\s*([^<>]{2,80}?)\s*(?:<span|<\/h1)/i)?.[1]?.replace(/\s+/g, ' ').trim() ?? null;
  const sector = html.match(/sector:\s*<a[^>]*>([^<>]{2,60})<\/a>/i)?.[1]?.trim()
    ?? html.match(/industry:\s*<a[^>]*>([^<>]{2,60})<\/a>/i)?.[1]?.trim()
    ?? null;
  const bookValue = getRatio(r, 'book value');
  const curPrice = getRatio(r, 'current price');
  return {
    name,
    sector,
    price: curPrice,
    marketCapCr: mcap != null ? (capUnit.includes('cr') ? mcap : mcap / 1e7) : null,
    pe: getRatio(r, 'stock p/e'),
    pb: bookValue != null && curPrice != null && bookValue > 0 ? curPrice / bookValue : null,
    roe: getRatio(r, 'roe'),
    roce: getRatio(r, 'roce'),
    debtToEquity: getRatio(r, 'debt to equity'),
    divYield: getRatio(r, 'dividend yield'),
    bookValue,
    faceValue: getRatio(r, 'face value'),
    weekHigh52: null,
    weekLow52: null,
  };
}

// ---- tradingview scanner fallback ----------------------------------------------

const TV_COLS = [
  'name', 'description', 'close', 'change', 'volume', 'average_volume_30d_calc',
  'market_cap_basic', 'price_earnings_ttm', 'price_book_fq', 'return_on_equity',
  'debt_to_equity', 'dividends_yield', 'sector', 'exchange',
  'price_52_week_high', 'price_52_week_low',
];
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

async function tvBatch(tickers: string[]): Promise<Map<string, Array<number | string | null>>> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch('https://scanner.tradingview.com/global/scan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'User-Agent': UA,
          Origin: 'https://www.tradingview.com',
          Referer: 'https://www.tradingview.com/',
        },
        body: JSON.stringify({ symbols: { tickers }, columns: TV_COLS }),
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status === 429) {
        await sleep(4000 * attempt);
        continue;
      }
      if (!res.ok) {
        await sleep(1500 * attempt);
        continue;
      }
      const body = (await res.json()) as { data?: Array<{ s: string; d: Array<number | string | null> }> };
      return new Map((body.data ?? []).map((r) => [String(r.s).toUpperCase(), r.d]));
    } catch {
      await sleep(1500 * attempt);
    }
  }
  return new Map();
}

// ---- main ------------------------------------------------------------------------

async function main(): Promise<void> {
  if (!existsSync(COVERAGE_FILE)) throw new Error('coverage.json not found — run coverage.ts first');
  const cov = JSON.parse(readFileSync(COVERAGE_FILE, 'utf8')) as {
    gaps: { fundamentals: string[]; quote: string[]; intraday: string[]; history: string[] };
  };
  const asOf = new Date().toISOString();

  const prev: { fundamentals?: Record<string, FillFunda>; quotes?: Record<string, FillQuote> } = existsSync(OUT)
    ? JSON.parse(readFileSync(OUT, 'utf8'))
    : {};
  const fundamentals: Record<string, FillFunda> = { ...(prev.fundamentals ?? {}) };
  const quotes: Record<string, FillQuote> = { ...(prev.quotes ?? {}) };
  const stats = {
    fundamentalsAttempted: 0,
    fundamentalsFilled: 0,
    fundamentalsSources: { 'screener.in': 0, tradingview: 0 } as Record<string, number>,
    quotesFilled: 0,
    carried: Object.keys(fundamentals).length + Object.keys(quotes).length,
  };

  // 1) Quotes: every gapped symbol via TradingView (batched, fast).
  const quoteGaps = (cov.gaps.quote ?? []).filter((s) => !(s in quotes));
  for (let i = 0; i < quoteGaps.length; i += 100) {
    const batch = quoteGaps.slice(i, i + 100);
    const tickers = batch.flatMap((s) => [`NSE:${s}`, `BSE:${s}`]);
    const got = await tvBatch(tickers);
    for (const s of batch) {
      const d = got.get(`NSE:${s}`) ?? got.get(`BSE:${s}`);
      const price = num(d?.[2]);
      if (price != null && price > 0) {
        quotes[s] = { price, volume: num(d?.[4]), marketCap: num(d?.[6]), source: 'tradingview', asOf };
        stats.quotesFilled += 1;
      }
    }
    console.log(`fill: quotes ${Math.min(i + 100, quoteGaps.length)}/${quoteGaps.length} (filled ${stats.quotesFilled})`);
  }

  // 2) Fundamentals: screener.in first, TV fallback. Capped per run; symbols
  // with a working quote go first (ratios are most useful with a price).
  const fundaGaps = (cov.gaps.fundamentals ?? []).filter((s) => !(s in fundamentals));
  const quoteGapSet = new Set(cov.gaps.quote ?? []);
  fundaGaps.sort((a, b) => {
    const qa = quoteGapSet.has(a) ? 0 : 1;
    const qb = quoteGapSet.has(b) ? 0 : 1;
    return qb - qa || (a < b ? -1 : 1);
  });
  const todo = fundaGaps.slice(0, FILL_MAX);
  stats.fundamentalsAttempted = todo.length;

  // TV fallback data for the whole todo list in a few batched calls.
  const tvTickers = todo.flatMap((s) => [`NSE:${s}`, `BSE:${s}`]);
  const tvMap = new Map<string, Array<number | string | null>>();
  for (let i = 0; i < tvTickers.length; i += 100) {
    for (const [k, v] of await tvBatch(tvTickers.slice(i, i + 100))) tvMap.set(k, v);
  }

  let cursor = 0;
  const worker = async () => {
    while (true) {
      const sym = todo[cursor];
      cursor += 1;
      if (sym == null) return;
      const scr = await screenerFill(sym);
      const hasCore = scr && (scr.name != null || scr.marketCapCr != null || scr.pe != null);
      if (hasCore && scr) {
        const d = tvMap.get(`NSE:${sym}`) ?? tvMap.get(`BSE:${sym}`);
        const tvName = str(d?.[1]) || str(d?.[0]) || null;
        fundamentals[sym] = {
          ...scr,
          name: scr.name?.trim() ? scr.name : tvName,
          sector: scr.sector ?? (d ? str(d[12]) || null : null),
          price: scr.price ?? num(d?.[2]),
          weekHigh52: num(d?.[14]),
          weekLow52: num(d?.[15]),
          source: 'screener.in',
          asOf,
        };
        stats.fundamentalsFilled += 1;
        stats.fundamentalsSources['screener.in'] += 1;
      } else {
        const d = tvMap.get(`NSE:${sym}`) ?? tvMap.get(`BSE:${sym}`);
        const price = num(d?.[2]);
        if (price != null && price > 0) {
          const mcap = num(d?.[6]);
          fundamentals[sym] = {
            name: str(d[1]) || str(d[0]) || null,
            sector: str(d[12]) || null,
            price,
            marketCapCr: mcap != null ? (mcap * USDINR) / 1e7 : null,
            pe: num(d?.[7]),
            pb: num(d?.[8]),
            roe: num(d?.[9]),
            roce: null,
            debtToEquity: num(d?.[10]),
            divYield: num(d?.[11]),
            bookValue: null,
            faceValue: null,
            weekHigh52: num(d?.[14]),
            weekLow52: num(d?.[15]),
            source: 'tradingview',
            asOf,
          };
          stats.fundamentalsFilled += 1;
          stats.fundamentalsSources.tradingview += 1;
        }
      }
      if (cursor % 100 === 0 || cursor === todo.length) {
        console.log(`fill: fundamentals ${cursor}/${todo.length} (filled ${stats.fundamentalsFilled})`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(POOL, Math.max(todo.length, 1)) }, worker));

  mkdirSync(PUB, { recursive: true });
  writeFileSync(OUT, JSON.stringify({ generatedAt: asOf, stats, fundamentals, quotes }));
  const remaining = fundaGaps.length - todo.length;
  if (failSamples.length) console.log(`fill: miss samples: ${failSamples.slice(0, 8).join(' | ')}`);
  console.log(
    `fill: +${stats.fundamentalsFilled} fundamentals (screener.in ${stats.fundamentalsSources['screener.in']}, tv ${stats.fundamentalsSources.tradingview}), ` +
      `+${stats.quotesFilled} quotes, carried ${stats.carried}, remaining funda gaps ${remaining} -> ${OUT}`,
  );
}

main().catch((e) => {
  console.error('coverage-fill failed:', e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
