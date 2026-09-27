// Symbol → sector/industry map from the TradingView scanner (no key).
// Covers the whole tv-mapped universe so every stock page knows its sector —
// e.g. PBFINTECH resolves to Finance, which is what powers sector-wide news.
//
// Writes: frontend/public/sectors.json { updatedAt, sectors: { SYM: { sector, industry } } }
//
// Run: npx tsx scripts/ci/sectors.ts (weekly; TV data barely moves)

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const PUB = join(process.cwd(), 'frontend', 'public');
const OUT = join(PUB, 'sectors.json');
const BATCH = 100;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

// Secondary sector tags from company name + industry keywords, so policy
// news finds the right stocks even when the primary sector is generic —
// e.g. POLICYBZR (Internet Software) also watches Finance for IRDAI and
// insurance-sector headlines.
const SECONDARY: [RegExp, string][] = [
  [/insur/i, 'Finance'],
  [/\bbanks?\b|banking/i, 'Finance'],
  [/mutual funds?|asset management|nbfc|housing finance|microfin|gold loan|vehicle finance/i, 'Finance'],
  [/stock brok|brokerage|depository|exchange|amc\b/i, 'Finance'],
  [/fintech|policybazaar|insurtech/i, 'Finance'],
  [/pharma|drugs?|biotech|hospital|diagnostic|healthcare/i, 'Health Technology'],
  [/telecom|broadband|dth|cable tv/i, 'Communications'],
  [/airline|airport|hotel|resort|restaurant|tourism|multiplex|media|broadcast/i, 'Consumer Services'],
  [/solar|wind|renewable|power generat|transmission|utility|utilities/i, 'Utilities'],
  [/oil|gas|petroleum|refin|coal| mining|minerals|steel|aluminium|copper|zinc/i, 'Energy Minerals'],
  [/cement|chemical|fertiliz|paint|tyre|rubber|paper|packaging/i, 'Process Industries'],
  [/auto|motor|tractor|two wheeler|ev\b|battery/i, 'Consumer Durables'],
  [/fmcg|food|beverage|dairy|brewery|tobacco|textile|apparel|footwear/i, 'Consumer Non-Durables'],
  [/defence|defense|aerospace|railway|shipbuild|metro/i, 'Producer Manufacturing'],
  [/realty|real estate|construction|infrastructure|road|port/i, 'Producer Manufacturing'],
  [/software|infotech| bpo|kpo|consulting/i, 'Technology Services'],
];

async function scanOnce(tickers: string[]): Promise<Map<string, [string, string]>> {
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
        body: JSON.stringify({ symbols: { tickers }, columns: ['sector', 'industry'] }),
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
      const body = (await res.json()) as { data?: Array<{ s: string; d: Array<string | null> }> };
      const out = new Map<string, [string, string]>();
      for (const r of body.data ?? []) {
        out.set(String(r.s).toUpperCase(), [str(r.d?.[0]), str(r.d?.[1])]);
      }
      return out;
    } catch {
      await sleep(1500 * attempt);
    }
  }
  return new Map();
}

async function main(): Promise<void> {
  const mapFile = join(PUB, 'tv-map.json');
  if (!existsSync(mapFile)) throw new Error('tv-map.json not found');
  const tvMap = JSON.parse(readFileSync(mapFile, 'utf8')) as { map: Record<string, string> };
  const entries = Object.entries(tvMap.map ?? {});
  console.log(`sectors: resolving ${entries.length} tickers`);

  type SecEntry = { sector: string; industry: string; extra?: string[] };
  const prev: Record<string, SecEntry> = existsSync(OUT)
    ? ((JSON.parse(readFileSync(OUT, 'utf8')) as { sectors?: Record<string, SecEntry> }).sectors ?? {})
    : {};
  const sectors: Record<string, SecEntry> = { ...prev };
  let names: Record<string, string> = {};
  try {
    const uni = JSON.parse(readFileSync(join(PUB, 'universe.json'), 'utf8')) as { stocks?: Array<{ symbol?: string; name?: string }> };
    for (const s of uni.stocks ?? []) {
      if (s?.symbol) names[String(s.symbol).toUpperCase()] = String(s.name ?? '');
    }
  } catch {
    names = {};
  }
  const tagExtra = (sym: string, sector: string, industry: string): string[] => {
    const hay = `${names[sym] ?? sym} ${industry} ${sym}`;
    const out = new Set<string>();
    for (const [re, tag] of SECONDARY) {
      if (tag !== sector && re.test(hay)) out.add(tag);
    }
    return [...out].slice(0, 3);
  };
  let filled = 0;
  for (let i = 0; i < entries.length; i += BATCH) {
    const batch = entries.slice(i, i + BATCH);
    const got = await scanOnce(batch.map(([, tv]) => tv));
    for (const [sym, tv] of batch) {
      const key = sym.toUpperCase();
      const hit = got.get(tv.toUpperCase());
      if (hit && (hit[0] || hit[1])) {
        const extra = tagExtra(key, hit[0], hit[1]);
        sectors[key] = { sector: hit[0], industry: hit[1], ...(extra.length ? { extra } : {}) };
        filled += 1;
      }
    }
    if ((i / BATCH) % 10 === 0) console.log(`sectors: ${Math.min(i + BATCH, entries.length)}/${entries.length}`);
    await sleep(400);
  }
  mkdirSync(PUB, { recursive: true });
  writeFileSync(OUT, JSON.stringify({ updatedAt: new Date().toISOString(), count: Object.keys(sectors).length, sectors }));
  console.log(`sectors: +${filled} resolved, ${Object.keys(sectors).length} total -> ${OUT}`);
}

main().catch((e) => {
  console.error('sectors failed:', e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
