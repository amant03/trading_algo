// Data-coverage audit — checks EVERY stock in the universe for EVERY data
// point the Stock page needs, and stores the gaps for the fill automation.
//
// Data points per symbol:
//   quote      — Yahoo meta price (header price, prev close)
//   intraday   — Yahoo 1d/1m bars (1D chart, day OHLC, volume, Technical tab)
//   history    — Yahoo 1y/1d bars (long-range charts, backtests, signals)
//   fundamentals — analysis.json entry (nightly Screener+Yahoo engine)
//   news       — news.json entry (Google News RSS automation)
//   signals    — signals.json entry (strategy engine on daily bars)
//   tvmap      — tv-map.json ticker (TradingView lab + Test tab)
//
// Method: Yahoo spark endpoint batches 20 symbols per call (intraday +
// history + quote in 2 calls per batch); local JSON files are read once.
// Writes: frontend/public/coverage.json (totals + full gap symbol lists).
//
// Run:  npx tsx scripts/ci/coverage.ts
// Envs: COVERAGE_MAX_SYMBOLS (slice for testing), COVERAGE_BATCH (20),
//       COVERAGE_POOL (6).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const PUB = join(process.cwd(), 'frontend', 'public');
const OUT = join(PUB, 'coverage.json');
const BATCH = Number(process.env.COVERAGE_BATCH ?? 20);
const POOL = Number(process.env.COVERAGE_POOL ?? 6);
const MAX_SYMBOLS = Number(process.env.COVERAGE_MAX_SYMBOLS ?? 0);
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

interface UniverseRow {
  symbol: string;
  name: string;
  exchange: string;
}

interface SparkHit {
  bars: number;
  price: number | null;
}

const stripTicker = (raw: string): string => raw.replace(/\.(NS|BO)$/i, '').toUpperCase();

function parseSpark(body: unknown): Map<string, SparkHit> {
  const out = new Map<string, SparkHit>();
  if (!body || typeof body !== 'object') return out;
  const put = (rawSym: string, closes: unknown, ts: unknown, meta: Record<string, unknown> | undefined, flat?: Record<string, unknown>) => {
    const sym = stripTicker(String(rawSym ?? ''));
    if (!sym) return;
    const cArr = Array.isArray(closes) ? closes.filter((n) => typeof n === 'number' && (n as number) > 0) : [];
    const tArr = Array.isArray(ts) ? ts : [];
    const bars = Math.min(cArr.length, tArr.length || cArr.length);
    let price: number | null = null;
    const p = meta?.regularMarketPrice;
    if (typeof p === 'number' && isFinite(p) && p > 0) price = p;
    else if (cArr.length) price = cArr[cArr.length - 1] as number;
    else if (flat) price = flatMeta(flat);
    const prev = out.get(sym);
    if (!prev || bars > prev.bars || (price != null && prev.price == null)) {
      out.set(sym, { bars: Math.max(bars, prev?.bars ?? 0), price: price ?? prev?.price ?? null });
    }
  };
  const rec = body as Record<string, unknown>;
  // Flat meta shape: { SYM: { symbol, fulldayPrice, previousClose, ... } }
  // (weekends / pre-open return this with empty timestamp+close arrays).
  const flatMeta = (v: Record<string, unknown>): number | null => {
    for (const k of ['fulldayPrice', 'regularMarketPrice']) {
      const p = (v.meta as Record<string, unknown> | undefined)?.[k] ?? v[k];
      if (typeof p === 'number' && isFinite(p) && p > 0) return p;
    }
    return null;
  };
  // Legacy shape: { spark: { result: [{ symbol, response: [{ meta }], close?, timestamp? }] } }
  const legacy = (rec.spark as { result?: unknown[] } | undefined)?.result;
  if (Array.isArray(legacy)) {
    for (const item of legacy) {
      const it = item as Record<string, unknown>;
      const resp = (it.response as Array<{ meta?: Record<string, unknown> }> | undefined)?.[0];
      put(String(it.symbol ?? ''), it.close, it.timestamp, resp?.meta);
    }
  }
  // Current shape: { SYM.NS: { symbol, close[], timestamp[], meta } }
  for (const [key, val] of Object.entries(rec)) {
    if (key === 'spark' || !val || typeof val !== 'object') continue;
    const v = val as Record<string, unknown>;
    if (!('close' in v) && !('timestamp' in v) && typeof v.symbol !== 'string' && !('fulldayPrice' in v)) continue;
    put(String(v.symbol ?? key), v.close, v.timestamp, v.meta as Record<string, unknown> | undefined, v);
  }
  return out;
}

async function sparkBatch(tickers: string[], range: string, interval: string): Promise<Map<string, SparkHit>> {
  const qs = `/v8/finance/spark?symbols=${encodeURIComponent(tickers.join(','))}&range=${range}&interval=${interval}&includePrePost=false`;
  for (const host of ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com']) {
    try {
      const res = await fetch(`${host}${qs}`, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) continue;
      return parseSpark(await res.json());
    } catch {
      // try next host
    }
  }
  return new Map();
}

function loadKeys(file: string, pick: (j: unknown) => string[]): Set<string> {
  try {
    if (!existsSync(file)) return new Set();
    return new Set(pick(JSON.parse(readFileSync(file, 'utf8'))));
  } catch {
    return new Set();
  }
}

async function main(): Promise<void> {
  const uni = JSON.parse(readFileSync(join(PUB, 'universe.json'), 'utf8')) as { stocks: UniverseRow[] };
  let stocks = (uni.stocks ?? []).map((s) => ({
    symbol: String(s.symbol).toUpperCase(),
    exchange: String(s.exchange ?? 'NSE').toUpperCase(),
  }));
  if (MAX_SYMBOLS > 0) stocks = stocks.slice(0, MAX_SYMBOLS);

  const funda = loadKeys(join(PUB, 'analysis.json'), (j) => Object.keys((j as { stocks?: object }).stocks ?? {}).map((s) => s.toUpperCase()));
  const tvmap = loadKeys(join(PUB, 'tv-map.json'), (j) => Object.keys((j as { map?: object }).map ?? {}).map((s) => s.toUpperCase()));
  const signals = loadKeys(join(PUB, 'signals.json'), (j) => Object.keys((j as { data?: object }).data ?? {}).map((s) => s.toUpperCase()));
  const news = loadKeys(join(PUB, 'news.json'), (j) => Object.keys((j as { items?: object }).items ?? {}).map((s) => s.toUpperCase()));

  const gaps = { quote: [] as string[], intraday: [] as string[], history: [] as string[], fundamentals: [] as string[], news: [] as string[], signals: [] as string[], tvmap: [] as string[] };
  const totals = { universe: stocks.length, quote: 0, intraday: 0, history: 0, fundamentals: 0, news: 0, signals: 0, tvmap: 0 };

  const tickerFor = (s: (typeof stocks)[number], flip: boolean): string => {
    const primary = s.exchange === 'NSE' ? '.NS' : '.BO';
    const alt = primary === '.NS' ? '.BO' : '.NS';
    return `${s.symbol}${flip ? alt : primary}`;
  };

  let cursor = 0;
  const worker = async () => {
    while (true) {
      const slice = stocks.slice(cursor, cursor + BATCH);
      cursor += BATCH;
      if (!slice.length) return;
      const tickers = slice.map((s) => tickerFor(s, false));
      // Intraday uses range=5d (not 1d): Yahoo returns zero 1m bars on
      // weekends/holidays for range=1d even for liquid names, while 5d
      // always carries the last sessions. Presence of 1m bars = the chart
      // relay can serve a 1D chart on trading days.
      const [intra, hist] = await Promise.all([
        sparkBatch(tickers, '5d', '1m'),
        sparkBatch(tickers, '1y', '1d'),
      ]);
      // Fallback suffix for symbols missing on the primary exchange.
      const missing = slice.filter((s) => !intra.has(s.symbol) && !hist.has(s.symbol));
      let intra2 = new Map<string, SparkHit>();
      let hist2 = new Map<string, SparkHit>();
      if (missing.length) {
        const altTickers = missing.map((s) => tickerFor(s, true));
        [intra2, hist2] = await Promise.all([
          sparkBatch(altTickers, '5d', '1m'),
          sparkBatch(altTickers, '1y', '1d'),
        ]);
      }
      for (const s of slice) {
        const i = intra.get(s.symbol) ?? intra2.get(s.symbol);
        const h = hist.get(s.symbol) ?? hist2.get(s.symbol);
        const price = i?.price ?? h?.price ?? null;
        if (price != null) totals.quote += 1;
        else gaps.quote.push(s.symbol);
        if ((i?.bars ?? 0) > 0) totals.intraday += 1;
        else gaps.intraday.push(s.symbol);
        if ((h?.bars ?? 0) > 0) totals.history += 1;
        else gaps.history.push(s.symbol);
        if (funda.has(s.symbol)) totals.fundamentals += 1;
        else gaps.fundamentals.push(s.symbol);
        if (news.has(s.symbol)) totals.news += 1;
        else gaps.news.push(s.symbol);
        if (signals.has(s.symbol)) totals.signals += 1;
        else gaps.signals.push(s.symbol);
        if (tvmap.has(s.symbol)) totals.tvmap += 1;
        else gaps.tvmap.push(s.symbol);
      }
      if (cursor % 500 < BATCH) {
        console.log(`coverage: ${Math.min(cursor, stocks.length)}/${stocks.length} symbols checked`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(POOL, Math.ceil(stocks.length / BATCH)) }, worker));

  const out = {
    generatedAt: new Date().toISOString(),
    universe: stocks.length,
    totals,
    gaps,
    notes: 'quote/intraday/history via Yahoo spark (batched); fundamentals via analysis.json; news via news.json; signals via signals.json; tvmap via tv-map.json.',
  };
  mkdirSync(PUB, { recursive: true });
  writeFileSync(OUT, JSON.stringify(out));
  console.log(
    `coverage: universe=${totals.universe} quote=${totals.quote} intraday=${totals.intraday} history=${totals.history} ` +
      `fundamentals=${totals.fundamentals} news=${totals.news} signals=${totals.signals} tvmap=${totals.tvmap} -> ${OUT}`,
  );
}

main().catch((e) => {
  console.error('coverage failed:', e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
