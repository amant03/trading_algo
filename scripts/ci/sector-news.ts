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
// Run: npx tsx scripts/ci/sector-news.ts
// Workflow: after the pre-stage curl of sector-news.json (market-hours and
// the daily full run), otherwise that curl puts the previous snapshot back
// and the published file never moves.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const PUB = join(process.cwd(), 'frontend', 'public');
const OUT = join(PUB, 'sector-news.json');
const NEWS_RAW_URL = 'https://raw.githubusercontent.com/amant03/trading_algo/automation-data/frontend/public/news.json';
const SECTORS_RAW_URL = 'https://raw.githubusercontent.com/amant03/trading_algo/automation-data/frontend/public/sectors.json';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
const PER_SECTOR = 30;
const KEEP_DAYS = 7;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function abortAfter(ms: number): AbortSignal {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  if (typeof timer === 'object' && timer && 'unref' in timer) timer.unref();
  return ctrl.signal;
}

const publisherCache = new Map<string, Promise<string>>();

/** Google News RSS links are wrappers. Exchange the article id for the
 *  publisher URL (Moneycontrol, Reuters, …) so a click opens that article.
 *  If Google will not decode it, the wrapper URL is kept — never an empty href. */
function publisherUrl(googleUrl: string): Promise<string> {
  const cached = publisherCache.get(googleUrl);
  if (cached) return cached;
  const job = (async () => {
    const id = googleUrl.match(/news\.google\.com\/(?:rss\/)?articles\/([^/?#]+)/)?.[1];
    if (!id) return googleUrl;
    try {
      const page = await fetch(`https://news.google.com/rss/articles/${id}?hl=en-IN&gl=IN&ceid=IN:en`, {
        headers: { 'User-Agent': UA },
        signal: abortAfter(8_000),
      });
      const html = page.ok ? await page.text() : '';
      const sg = html.match(/data-n-a-sg="([^"]+)"/)?.[1];
      const ts = html.match(/data-n-a-ts="([^"]+)"/)?.[1];
      if (!sg || !ts) return googleUrl;
      const inner = JSON.stringify([
        'garturlreq',
        [['X', 'X', ['X', 'X'], null, null, 1, 1, 'IN:en', null, 1, null, null, null, null, null, 0, 1], 'X', 'X', 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0],
        id,
        Number(ts),
        sg,
      ]);
      const body = 'f.req=' + encodeURIComponent(JSON.stringify([[['Fbv4je', inner, null, 'generic']]]));
      const res = await fetch('https://news.google.com/_/DotsSplashUi/data/batchexecute?rpcids=Fbv4je', {
        method: 'POST',
        headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body,
        signal: abortAfter(8_000),
      });
      const text = res.ok ? await res.text() : '';
      const found = text.match(/https:\/\/(?!news\.google\.com\/)[^"\\]+/);
      return found?.[0] ?? googleUrl;
    } catch {
      return googleUrl;
    }
  })();
  publisherCache.set(googleUrl, job);
  return job;
}

function stampOf(value: unknown): number {
  if (!value || typeof value !== 'object') return 0;
  const o = value as { generatedAt?: string; updatedAt?: string };
  const t = Date.parse(o.generatedAt ?? o.updatedAt ?? '');
  return Number.isFinite(t) ? t : 0;
}

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
  'Food Delivery': ['Eternal Zomato food delivery India stock', 'Swiggy Instamart Blinkit quick commerce India'],
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
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: abortAfter(15_000) });
    if (!res.ok) return out;
    const xml = await res.text();
    // Google News article links are often 600–800 characters. A short cap
    // drops </link> and the headline is stored with an empty url.
    for (const body of xml.match(/<item>[\s\S]*?<\/item>/g) ?? []) {
      const title = decode(body.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '');
      const link = decode(body.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? '').trim();
      const pubDate = decode(body.match(/<pubDate>([^<]*?)<\/pubDate>/)?.[1] ?? '');
      const source = decode(body.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] ?? 'Google News');
      if (title && /^https?:\/\//i.test(link)) out.push({ title, link, pubDate, source });
      if (out.length >= 12) break;
    }
  } catch {
    // sector wire unavailable — member headlines still cover the sector
  }
  return out;
}

async function loadJson<T>(local: string, remote: string): Promise<T | null> {
  // Checkout copies on main lag the automation-data branch. Use whichever
  // snapshot is newer so a run still refreshes when the local file is stale.
  let fromDisk: T | null = null;
  try {
    if (existsSync(local)) fromDisk = JSON.parse(readFileSync(local, 'utf8')) as T;
  } catch {
    fromDisk = null;
  }
  let fromRemote: T | null = null;
  try {
    const res = await fetch(remote, { headers: { 'User-Agent': UA }, signal: abortAfter(20_000) });
    if (res.ok) fromRemote = (await res.json()) as T;
  } catch {
    fromRemote = null;
  }
  if (fromDisk && fromRemote) return stampOf(fromRemote) > stampOf(fromDisk) ? fromRemote : fromDisk;
  return fromDisk ?? fromRemote;
}

async function main(): Promise<void> {
  const sectorsFile = await loadJson<{ sectors?: Record<string, { sector?: string; industry?: string }> }>(
    join(PUB, 'sectors.json'), SECTORS_RAW_URL,
  );
  const symSector = new Map<string, string>();
  for (const [sym, v] of Object.entries(sectorsFile?.sectors ?? {})) {
    if (v?.sector) symSector.set(sym.toUpperCase(), v.sector);
  }
  if (!symSector.size) {
    // Never fail the workflow over a missing map — publish an empty file so
    // the UI shows "no data" instead of paging the owner at 3am.
    mkdirSync(PUB, { recursive: true });
    writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), sectorCount: 0, sectors: {}, warning: 'sectors.json unavailable — run sectors.ts first' }));
    console.log('sector-news: sectors map unavailable, wrote empty file');
    return;
  }

  const newsFile = await loadJson<{ items?: Record<string, Array<{ title?: string; source?: string; url?: string; publishedAt?: string; symbol?: string }>> }>(
    join(PUB, 'news.json'), NEWS_RAW_URL,
  );
  const cutoff = Date.now() - KEEP_DAYS * 86_400_000;
  const buckets = new Map<string, SectorItem[]>();
  const push = (sector: string, item: SectorItem): boolean => {
    const published = Date.parse(item.publishedAt);
    if (!Number.isFinite(published) || published < cutoff) return false;
    const arr = buckets.get(sector) ?? [];
    if (arr.some((x) => x.title === item.title)) return false;
    arr.push(item);
    buckets.set(sector, arr);
    return true;
  };

  // 1) member headlines re-tagged to sectors
  let memberCount = 0;
  for (const [sym, list] of Object.entries(newsFile?.items ?? {})) {
    const sector = symSector.get(sym.toUpperCase());
    if (!sector) continue;
    for (const a of list ?? []) {
      if (!a?.title || !/^https?:\/\//i.test(a.url ?? '')) continue;
      if (push(sector, {
        title: a.title, source: a.source ?? 'Google News', url: a.url ?? '',
        publishedAt: a.publishedAt ?? new Date().toISOString(),
        symbols: [sym.toUpperCase()], kind: 'member',
      })) memberCount += 1;
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
        if (push(sector, {
          title: a.title, source: a.source, url: a.link,
          publishedAt: (() => { const t = Date.parse(a.pubDate); return isFinite(t) ? new Date(t).toISOString() : new Date().toISOString(); })(),
          symbols: hits, kind: 'sector',
        })) wireCount += 1;
      }
      await sleep(500);
    }
    console.log(`sector-news: ${sector} wires done`);
  }

  const out: Record<string, SectorItem[]> = {};
  const toResolve: SectorItem[] = [];
  for (const [sector, list] of buckets) {
    out[sector] = list
      .sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1))
      .slice(0, PER_SECTOR);
    for (const item of out[sector]) {
      if (item.url.includes('news.google.com/')) toResolve.push(item);
    }
  }
  let cursor = 0;
  const resolveOne = async () => {
    while (cursor < toResolve.length) {
      const item = toResolve[cursor];
      cursor += 1;
      item.url = await publisherUrl(item.url);
    }
  };
  await Promise.all(Array.from({ length: Math.min(5, toResolve.length) }, resolveOne));
  const opened = toResolve.filter((item) => !item.url.includes('news.google.com/')).length;
  console.log(`sector-news: resolved ${opened}/${toResolve.length} headlines to publisher URLs`);
  mkdirSync(PUB, { recursive: true });
  writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), sectorCount: Object.keys(out).length, sectors: out }));
  console.log(`sector-news: ${Object.keys(out).length} sectors · ${memberCount} member + ${wireCount} wire items -> ${OUT}`);
}

main().catch((e) => {
  console.error('sector-news failed:', e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
