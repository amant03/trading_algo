// Sector-wide news — every stock page shows headlines affecting its sector,
// not just headlines naming the stock (e.g. PBFINTECH sees insurance-sector
// and IRDAI policy news). Two feeds merged per sector:
//   1. member headlines: news.json items re-tagged to their symbol's sector
//   2. sector wires: Google News RSS per sector query (policy/regulator news
//      that rarely names a ticker)
//
// Needs: sectors.json (symbol→sector) + news.json (fresh in-workspace or from
// automation-data). Writes: frontend/public/sector-news.json
//   { generatedAt, sectors: { SECTOR: [{ title, source, url, publishedAt,
//     symbols: [matched members], kind: 'member'|'sector' }] } }
//
// Run: npx tsx scripts/ci/sector-news.ts (market-hours, after news.ts)

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const PUB = join(process.cwd(), 'frontend', 'public');
const OUT = join(PUB, 'sector-news.json');
const NEWS_RAW_URL = 'https://raw.githubusercontent.com/amant03/trading_algo/automation-data/frontend/public/news.json';
const SECTORS_RAW_URL = 'https://raw.githubusercontent.com/amant03/trading_algo/automation-data/frontend/public/sectors.json';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
const PER_SECTOR = 30;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface SectorItem {
  title: string;
  source: string;
  url: string;
  publishedAt: string;
  symbols: string[];
  kind: 'member' | 'sector';
}

// Extra policy/regulator wires per TV sector; default query covers the rest.
const SECTOR_QUERIES: Record<string, string[]> = {
  Finance: ['insurance sector India IRDAI', 'RBI banks India policy'],
  'Health Technology': ['pharma sector India USFDA'],
  Communications: ['telecom sector India TRAI'],
  Utilities: ['power sector India policy'],
  'Energy Minerals': ['oil gas sector India ONGC'],
  'Electronic Technology': ['Indian IT sector stocks'],
  'Consumer Non-Durables': ['FMCG sector India demand'],
  'Consumer Durables': ['auto sector India sales SIAM'],
  'Consumer Services': ['aviation hotels India stocks'],
  'Producer Manufacturing': ['capex manufacturing India stocks'],
  'Non-Energy Minerals': ['steel metal stocks India'],
  'Retail Trade': ['retail consumption India stocks'],
  Transportation: ['logistics aviation India stocks'],
  'Technology Services': ['Indian IT services stocks'],
};

function rssQuery(sector: string): string[] {
  if (SECTOR_QUERIES[sector]) return SECTOR_QUERIES[sector];
  return [`${sector} stocks India`];
}

function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

interface RssArticle { title: string; link: string; pubDate: string; source: string }

async function fetchRss(query: string): Promise<RssArticle[]> {
  const out: RssArticle[] = [];
  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN%3Aen`;
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return out;
    const xml = await res.text();
    for (const m of xml.matchAll(/<item>([\s\S]{0,4000}?)<\/item>/g)) {
      const body = m[1];
      const title = decode(body.match(/<title>([\s\S]{0,500}?)<\/title>/)?.[1] ?? '');
      const link = decode(body.match(/<link>([\s\S]{0,500}?)<\/link>/)?.[1] ?? '');
      const pubDate = decode(body.match(/<pubDate>([^<>]{0,60})<\/pubDate>/)?.[1] ?? '');
      const source = decode(body.match(/<source[^>]*>([^<>]{0,80})<\/source>/)?.[1] ?? 'Google News');
      if (title) out.push({ title, link, pubDate, source });
      if (out.length >= 12) break;
    }
  } catch {
    // sector wire unavailable — member headlines still cover the sector
  }
  return out;
}

async function loadJson<T>(local: string, remote: string): Promise<T | null> {
  try {
    if (existsSync(local)) return JSON.parse(readFileSync(local, 'utf8')) as T;
  } catch {
    // fall through to remote
  }
  try {
    const res = await fetch(remote, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20_000) });
    if (res.ok) return (await res.json()) as T;
  } catch {
    // unavailable
  }
  return null;
}

async function main(): Promise<void> {
  const sectorsFile = await loadJson<{ sectors?: Record<string, { sector?: string; industry?: string }> }>(
    join(PUB, 'sectors.json'), SECTORS_RAW_URL,
  );
  const symSector = new Map<string, string>();
  for (const [sym, v] of Object.entries(sectorsFile?.sectors ?? {})) {
    if (v?.sector) symSector.set(sym.toUpperCase(), v.sector);
  }
  if (!symSector.size) throw new Error('sectors.json empty — run sectors.ts first');

  const newsFile = await loadJson<{ items?: Record<string, Array<{ title?: string; source?: string; url?: string; publishedAt?: string; symbol?: string }>> }>(
    join(PUB, 'news.json'), NEWS_RAW_URL,
  );
  const buckets = new Map<string, SectorItem[]>();
  const push = (sector: string, item: SectorItem) => {
    const arr = buckets.get(sector) ?? [];
    if (!arr.some((x) => x.title === item.title)) arr.push(item);
    buckets.set(sector, arr);
  };

  // 1) member headlines re-tagged to sectors
  let memberCount = 0;
  for (const [sym, list] of Object.entries(newsFile?.items ?? {})) {
    const sector = symSector.get(sym.toUpperCase());
    if (!sector) continue;
    for (const a of list ?? []) {
      if (!a?.title) continue;
      push(sector, {
        title: a.title, source: a.source ?? 'Google News', url: a.url ?? '',
        publishedAt: a.publishedAt ?? new Date().toISOString(),
        symbols: [sym.toUpperCase()], kind: 'member',
      });
      memberCount += 1;
    }
  }

  // 2) sector wires (policy/regulator headlines)
  const sectors = [...new Set(symSector.values())].sort();
  let wireCount = 0;
  for (const sector of sectors) {
    for (const q of rssQuery(sector)) {
      const arts = await fetchRss(q);
      for (const a of arts) {
        // Attach member symbols mentioned in the headline (whole-word).
        const upper = ` ${a.title.toUpperCase()} `;
        const hits: string[] = [];
        for (const [sym] of symSector) {
          if (sym.length > 3 && upper.includes(` ${sym} `)) hits.push(sym);
          if (hits.length >= 5) break;
        }
        push(sector, {
          title: a.title, source: a.source, url: a.link,
          publishedAt: (() => { const t = Date.parse(a.pubDate); return isFinite(t) ? new Date(t).toISOString() : new Date().toISOString(); })(),
          symbols: hits, kind: 'sector',
        });
        wireCount += 1;
      }
      await sleep(500);
    }
    console.log(`sector-news: ${sector} wires done`);
  }

  const out: Record<string, SectorItem[]> = {};
  for (const [sector, list] of buckets) {
    out[sector] = list
      .sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1))
      .slice(0, PER_SECTOR);
  }
  mkdirSync(PUB, { recursive: true });
  writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), sectorCount: Object.keys(out).length, sectors: out }));
  console.log(`sector-news: ${Object.keys(out).length} sectors · ${memberCount} member + ${wireCount} wire items -> ${OUT}`);
}

main().catch((e) => {
  console.error('sector-news failed:', e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
