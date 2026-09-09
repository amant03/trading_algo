// Single-symbol import — bring one stock into full platform coverage.
//
// Triggered from the UI ("Import to the platform" button on a stock page that
// has no fundamentals yet) via the `import-symbol.yml` workflow. Fetches the
// real Yahoo fundamentals + Screener.in competitors + Google News for one NSE
// symbol, upserts it into the carried-forward analysis.json on the
// automation-data branch, and merges its news into news.json — so everyone
// sees the stock immediately, without waiting for the nightly coverage batch.
//
// Env:
//   IMPORT_SYMBOL   the NSE symbol to import (e.g. INFY)
//
// Writes:
//   frontend/public/analysis.json  (+ imported symbol, carried file intact)
//   frontend/public/news.json      (7-day news merged for the symbol)

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import {
  emptyMetrics,
  applyYahoo,
  applyScreener,
  fetchRealFundamentals,
  makeYahoo,
  buildEntry,
  screenerPeers,
  extractCompanion,
} from '../../frontend/src/lib/funda.js';

const ANALYSIS_FILE = join(process.cwd(), 'frontend', 'public', 'analysis.json');
const NEWS_FILE = join(process.cwd(), 'frontend', 'public', 'news.json');
const KEEP_DAYS = 7;
const PER_SYMBOL = 12;
const US_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

interface Article {
  title: string;
  source: string;
  url: string;
  publishedAt: string;
  symbol: string;
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function normalize(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 80);
}

async function fetchNews(symbol: string, name: string): Promise<Article[]> {
  const tokens = [
    symbol,
    ...name
      .replace(/[^A-Za-z0-9&. -]/g, '')
      .split(/[\s.]+/)
      .filter((t) => t.length > 2 && !/^(ltd|limited|the|co|corporation|corp|group|industries|holding|bse|nse|share|bonds)$/i.test(t)),
  ];
  const query = `"${name}" OR "${symbol}" NSE stock news India`;
  try {
    const res = await fetch(
      `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`,
      { headers: { 'User-Agent': US_UA, Accept: 'application/rss+xml' }, signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) return [];
    const xml = await res.text();
    const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
    const out: Article[] = [];
    for (const it of items) {
      const titleM = it.match(/<title>([\s\S]*?)<\/title>/);
      const linkM = it.match(/<link>([\s\S]*?)<\/link>/);
      const dateM = it.match(/<pubDate>([^<]*?)<\/pubDate>/);
      const srcM = it.match(/<source[^>]*>([\s\S]*?)<\/source>/);
      if (!titleM || !linkM) continue;
      const raw = decode(titleM[1].trim()).replace(/^Top Stories\s*/, '');
      const lower = raw.toLowerCase();
      if (!tokens.some((t) => t.length > 1 && lower.includes(t.toLowerCase()))) continue;
      out.push({
        title: raw,
        source: srcM ? decode(srcM[1].trim()) : 'Google News',
        url: linkM[1].trim(),
        publishedAt: dateM ? new Date(dateM[1]).toISOString() : new Date().toISOString(),
        symbol,
      });
    }
    return out;
  } catch {
    return [];
  }
}

async function main(): Promise<void> {
  const symbol = (process.env.IMPORT_SYMBOL ?? '').trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9&-]{0,19}$/.test(symbol)) {
    console.error(`import: IMPORT_SYMBOL required (got "${symbol}")`);
    process.exit(1);
  }

  const analysisPath = join(process.cwd(), 'frontend', 'public', 'analysis.json');
  const prev: Record<string, any> = {};
  let generatedAt = new Date().toISOString();
  if (existsSync(analysisPath)) {
    try {
      const a = JSON.parse(readFileSync(analysisPath, 'utf8')) as { generatedAt?: string; stocks?: Record<string, any> };
      if (a.stocks) Object.assign(prev, a.stocks);
      if (a.generatedAt) generatedAt = a.generatedAt;
    } catch {
      // start fresh
    }
  }

  const yahoo = await makeYahoo();
  const data = await yahoo.quoteSummary(`${symbol}.NS`);
  const m = emptyMetrics(symbol, { name: symbol });
  applyYahoo(m, data);
  const sf = await fetchRealFundamentals(symbol);
  applyScreener(m, sf);

  const peers = await screenerPeers(symbol);
  const entry = buildEntry({
    symbol,
    name: m.name ?? symbol,
    m,
    price: m.price,
    financials: sf,
    peers: peers.slice(0, 9).map((p) => ({ symbol: p, name: p, industry: null, sector: null })),
    quarterEnd: extractCompanion(data).quarterEnd,
  });
  if (!m.price) {
    console.error(`import: no price for ${symbol} — not a valid liquid NSE ticker?`);
    process.exit(2);
  }

  prev[symbol] = entry;
  const count = Object.keys(prev).length;

  mkdirSync(join(process.cwd(), 'frontend', 'public'), { recursive: true });
  writeFileSync(
    analysisPath,
    JSON.stringify(
      {
        generatedAt,
        source: 'yahoo',
        universe: count,
        seed: prev[symbol] && count === 1 ? 1 : undefined,
        batch: 1,
        carried: count - 1,
        stocks: prev,
      },
      null,
      0,
    ),
  );

  // ---- merge news for the imported symbol (7-day window) ------------------
  const cutoff = Date.now() - KEEP_DAYS * 86_400_000;
  const news: Record<string, Article[]> = {};
  if (existsSync(NEWS_FILE)) {
    try {
      const n = JSON.parse(readFileSync(NEWS_FILE, 'utf8')) as { items?: Record<string, Article[]> };
      if (n.items) Object.assign(news, n.items);
    } catch {
      // ignore corrupt file
    }
  }
  const hits = await fetchNews(symbol, m.name ?? symbol);
  const merged = new Map<string, Article>();
  for (const a of news[symbol] ?? []) {
    if (new Date(a.publishedAt).getTime() >= cutoff) merged.set(normalize(a.title), a);
  }
  for (const a of hits) {
    const k = normalize(a.title);
    if (k.length >= 12 && (!merged.has(k) || new Date(a.publishedAt).getTime() > new Date(merged.get(k)!.publishedAt).getTime())) {
      merged.set(k, a);
    }
  }
  news[symbol] = [...merged.values()]
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    .slice(0, PER_SYMBOL);
  writeFileSync(
    NEWS_FILE,
    JSON.stringify({ generatedAt: new Date().toISOString(), symbols: Object.keys(news).length, items: news }, null, 0),
  );

  console.log(
    `import: ${symbol} added to coverage (${count} stocks now) — ${m.name ?? symbol}, PE ${m.pe?.toFixed(1) ?? 'n/a'}, ` +
      `${peers.length} screener peers, ${news[symbol].length} news items merged`,
  );
}

main().catch((e) => {
  console.error('import failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});