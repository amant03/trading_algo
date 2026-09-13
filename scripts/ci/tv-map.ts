// Build frontend/public/tv-map.json: universe symbol -> TradingView ticker.
// Probes the unofficial TV scanner (plain HTTPS, no login) in polite batches:
// pass 1 tries the listing exchange (NSE:SYM / BSE:SYM), pass 2 tries the
// other exchange for misses. Symbols TV doesn't list are left OUT — the Test
// page falls back to guessing NSE:SYM and shows TV's own error state.
// Run:  npx tsx scripts/ci/tv-map.ts   (one-off + whenever listings change)
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SCAN_URL = 'https://scanner.tradingview.com/global/scan';
const BATCH = 100;
const PAUSE_MS = 600;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const OUT = join(process.cwd(), 'frontend', 'public', 'tv-map.json');
const UNI = join(process.cwd(), 'frontend', 'public', 'universe.json');
// TV_ONLY: comma-separated symbols to (re)check without rebuilding the world.
const ONLY = (process.env.TV_ONLY ?? '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function scanOnce(tickers: string[]): Promise<Set<string>> {
  let lastErr = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(SCAN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': UA },
        body: JSON.stringify({ symbols: { tickers }, columns: ['close'] }),
        signal: AbortSignal.timeout(15000),
      });
      if (res.status === 429) {
        lastErr = 'HTTP 429';
        await sleep(5000 * attempt);
        continue;
      }
      if (!res.ok) {
        lastErr = `HTTP ${res.status}`;
        await sleep(2000 * attempt);
        continue;
      }
      const body = (await res.json()) as { data?: Array<{ s: string }> };
      return new Set((body.data ?? []).map((r) => String(r.s).toUpperCase()));
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      await sleep(2000 * attempt);
    }
  }
  console.log(`  batch FAILED after retries (${lastErr}) — skipping ${tickers.length} tickers`);
  return new Set();
}

async function main(): Promise<void> {
  const uni = JSON.parse(readFileSync(UNI, 'utf8')) as {
    stocks: Array<{ symbol: string; exchange: string }>;
  };
  let syms = [...new Set(
    (uni.stocks ?? [])
      .map((s) => String(s.symbol ?? '').trim().toUpperCase())
      .filter((s) => /^[A-Z0-9&.\-]{1,20}$/.test(s)),
  )];
  const allSyms = [...syms];
  console.log(`tv-map: ${syms.length} candidate symbols`);

  const map = new Map<string, string>();
  if (ONLY.length) {
    // Targeted recheck: keep the existing map, refresh only listed symbols.
    try {
      const prev = JSON.parse(readFileSync(OUT, 'utf8')) as { map?: Record<string, string> };
      for (const [k, v] of Object.entries(prev.map ?? {})) map.set(k, v);
    } catch { /* no previous map */ }
    const before = syms.length;
    syms = syms.filter((s) => ONLY.includes(s));
    for (const s of syms) map.delete(s);
    console.log(`tv-map: targeted mode ${syms.length}/${before} symbols (kept ${map.size} existing)`);
  }
  // Pass 1: primary exchange inferred from listing (default NSE).
  const needAlt: string[] = [];
  for (let i = 0; i < syms.length; i += BATCH) {
    const batch = syms.slice(i, i + BATCH);
    const tickers = batch.map((s) => {
      const stock = uni.stocks.find((x) => String(x.symbol).toUpperCase() === s);
      const ex = String(stock?.exchange ?? 'NSE').toUpperCase() === 'BSE' ? 'BSE' : 'NSE';
      return `${ex}:${s}`;
    });
    const found = await scanOnce(tickers);
    batch.forEach((s, j) => {
      if (found.has(tickers[j])) map.set(s, tickers[j]);
      else needAlt.push(s);
    });
    console.log(`tv-map: pass1 ${Math.min(i + BATCH, syms.length)}/${syms.length} resolved=${map.size} missing=${needAlt.length}`);
    await sleep(PAUSE_MS);
  }
  // Pass 2: alternate exchange for misses.
  let altResolved = 0;
  for (let i = 0; i < needAlt.length; i += BATCH) {
    const batch = needAlt.slice(i, i + BATCH);
    const tickers = batch.map((s) => {
      const stock = uni.stocks.find((x) => String(x.symbol).toUpperCase() === s);
      const primaryIsBse = String(stock?.exchange ?? 'NSE').toUpperCase() === 'BSE';
      return `${primaryIsBse ? 'NSE' : 'BSE'}:${s}`;
    });
    const found = await scanOnce(tickers);
    batch.forEach((s, j) => {
      if (found.has(tickers[j])) {
        map.set(s, tickers[j]);
        altResolved += 1;
      }
    });
    console.log(`tv-map: pass2 ${Math.min(i + BATCH, needAlt.length)}/${needAlt.length} altResolved=${altResolved}`);
    await sleep(PAUSE_MS);
  }
  // Pass 3: TradingView spells some NSE hyphens as underscores
  // (BAJAJ-AUTO -> BAJAJ_AUTO). Try '_' variants for whatever is left.
  const stillMissing = syms.filter((s) => !map.has(s) && s.includes('-'));
  let varResolved = 0;
  for (let i = 0; i < stillMissing.length; i += BATCH) {
    const batch = stillMissing.slice(i, i + BATCH);
    const tickers = batch.map((s) => `NSE:${s.replace(/-/g, '_')}`);
    const found = await scanOnce(tickers);
    batch.forEach((s, j) => {
      if (found.has(tickers[j])) {
        map.set(s, tickers[j]);
        varResolved += 1;
      }
    });
    const tickersB = batch.filter((s) => !map.has(s)).map((s) => `BSE:${s.replace(/-/g, '_')}`);
    if (tickersB.length) {
      const foundB = await scanOnce(tickersB);
      batch.forEach((s) => {
        const t = `BSE:${s.replace(/-/g, '_')}`;
        if (!map.has(s) && foundB.has(t)) {
          map.set(s, t);
          varResolved += 1;
        }
      });
    }
    console.log(`tv-map: pass3 ${Math.min(i + BATCH, stillMissing.length)}/${stillMissing.length} varResolved=${varResolved}`);
    await sleep(PAUSE_MS);
  }
  const unresolved = [...allSyms].filter((s) => !map.has(s));
  const out = {
    generatedAt: new Date().toISOString(),
    universe: allSyms.length,
    resolved: map.size,
    unresolved: unresolved.length,
    map: Object.fromEntries([...map.entries()].sort()),
  };
  writeFileSync(OUT, JSON.stringify(out));
  console.log(`tv-map: done resolved=${map.size}/${syms.length} unresolved=${unresolved.length}`);
  if (unresolved.length) console.log(`tv-map: unresolved sample: ${unresolved.slice(0, 20).join(',')}`);
}

main().catch((e) => {
  console.error('tv-map failed:', e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
