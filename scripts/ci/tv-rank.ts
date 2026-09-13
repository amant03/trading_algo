// Rank every mapped stock by TradingView "buyability" and publish
// frontend/public/tv-rank.json for the Test tab's market-wide list.
// Buyability score (transparent by design, shown in the UI footnote):
//   score = 0.5 * Recommend.All|1D + 0.25 * Recommend.All|1W
//         + 0.25 * Recommend.MA|1D   (each in [-1, 1])
//         + 0.05 if RSI < 30 (oversold) / -0.05 if RSI > 70 (overbought)
//         + 0.03 if close > SMA50 (trend confirmation)
// clamped to [-1, 1], sorted descending. Null TA counts as neutral (0);
// rows without a close price are dropped.
const LIQ_VALUE = 1_000_000; // Rs 10L/day traded value = "liquid enough to buy"
// Same unofficial scanner endpoint as tv-map.ts / api/tv.ts (no login).
// Run:  npx tsx scripts/ci/tv-rank.ts   (CI runs it in market-hours mode)
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SCAN_URL = 'https://scanner.tradingview.com/global/scan';
const BATCH = 100;
const PAUSE_MS = 600;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const OUT = join(process.cwd(), 'frontend', 'public', 'tv-rank.json');
const MAP_FILE = join(process.cwd(), 'frontend', 'public', 'tv-map.json');
const UNI = join(process.cwd(), 'frontend', 'public', 'universe.json');

const COLS = ['close', 'change', 'volume', 'RSI', 'SMA50', 'Recommend.All', 'Recommend.All|1W', 'Recommend.MA'];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const num = (v: unknown): number | null => (typeof v === 'number' && isFinite(v) ? v : null);
const clamp = (v: number): number => Math.max(-1, Math.min(1, v));

function labelFor(sc: number): string {
  if (sc >= 0.5) return 'Strong Buy';
  if (sc >= 0.1) return 'Buy';
  if (sc > -0.1) return 'Neutral';
  if (sc > -0.5) return 'Sell';
  return 'Strong Sell';
}

async function scanOnce(tickers: string[]): Promise<Map<string, Array<number | null>>> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(SCAN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': UA },
        body: JSON.stringify({ symbols: { tickers }, columns: COLS }),
        signal: AbortSignal.timeout(15000),
      });
      if (res.status === 429) {
        await sleep(5000 * attempt);
        continue;
      }
      if (!res.ok) {
        await sleep(2000 * attempt);
        continue;
      }
      const body = (await res.json()) as { data?: Array<{ s: string; d: Array<number | null> }> };
      return new Map((body.data ?? []).map((r) => [String(r.s).toUpperCase(), r.d]));
    } catch {
      await sleep(2000 * attempt);
    }
  }
  console.log(`  batch FAILED after retries — skipping ${tickers.length} tickers`);
  return new Map();
}

async function main(): Promise<void> {
  const tvMap = JSON.parse(readFileSync(MAP_FILE, 'utf8')) as { map: Record<string, string> };
  const uni = JSON.parse(readFileSync(UNI, 'utf8')) as {
    stocks: Array<{ symbol: string; name: string }>;
  };
  const names = new Map(
    (uni.stocks ?? []).map((s) => [String(s.symbol).toUpperCase(), String(s.name ?? s.symbol)]),
  );
  const entries = Object.entries(tvMap.map ?? {});
  console.log(`tv-rank: scanning ${entries.length} mapped tickers`);
  const rows: Array<{
    s: string; n: string; tv: string; c: number; ch: number | null; vol: number | null;
    rsi: number | null; sc: number; lb: string; lq: boolean;
  }> = [];
  for (let i = 0; i < entries.length; i += BATCH) {
    const batch = entries.slice(i, i + BATCH);
    const got = await scanOnce(batch.map(([, tv]) => tv));
    for (const [sym, tv] of batch) {
      const d = got.get(tv.toUpperCase());
      if (!d) continue;
      const close = num(d[0]);
      if (close == null) continue;
      const all1D = num(d[5]) ?? 0;
      const all1W = num(d[6]) ?? 0;
      const ma1D = num(d[7]) ?? 0;
      const rsi = num(d[3]);
      const sma50 = num(d[4]);
      let sc = 0.5 * all1D + 0.25 * all1W + 0.25 * ma1D;
      if (rsi != null) {
        if (rsi < 30) sc += 0.05;
        else if (rsi > 70) sc -= 0.05;
      }
      if (sma50 != null && close > sma50) sc += 0.03;
      sc = clamp(sc);
      const vol = num(d[2]);
      rows.push({
        s: sym,
        n: names.get(sym) ?? sym,
        tv,
        c: close,
        ch: num(d[1]),
        vol,
        rsi,
        sc: Math.round(sc * 1000) / 1000,
        lb: labelFor(sc),
        lq: vol != null && vol * close >= LIQ_VALUE,
      });
    }
    if ((i / BATCH) % 10 === 0) console.log(`tv-rank: ${Math.min(i + BATCH, entries.length)}/${entries.length} rows=${rows.length}`);
    await sleep(PAUSE_MS);
  }
  rows.sort((a, b) => b.sc - a.sc);
  const liquid = rows.filter((r) => r.lq).length;
  const out = { asOf: new Date().toISOString(), count: rows.length, liquid, rows };
  writeFileSync(OUT, JSON.stringify(out));
  const top = rows.find((r) => r.lq);
  console.log(`tv-rank: done ${rows.length} rows (${liquid} liquid), top liquid=${top?.s} sc=${top?.sc}`);
}

main().catch((e) => {
  console.error('tv-rank failed:', e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
