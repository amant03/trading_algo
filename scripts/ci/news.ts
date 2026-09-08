// Per-stock news via Google News RSS.
//
// Every automation run this pulls the latest headlines for each NSE symbol,
// merges them with whatever is already in `frontend/public/news.json`, prunes
// anything older than 7 days and writes the result back. The deployed UI reads
// this file straight off the `automation-data` branch (raw.githubusercontent)
// so news updates hourly-ish with zero redeploys.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { INSTRUMENTS as SEED } from '../../services/shared/src/instruments-data.js';

const NEWS_FILE = join(process.cwd(), 'frontend', 'public', 'news.json');
const KEEP_DAYS = 7;
const PER_SYMBOL = 12;
const FETCH_TIMEOUT_MS = 10_000;
const US_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

interface Article {
  title: string;
  source: string;
  url: string;
  publishedAt: string; // ISO
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

function significantTokens(name: string, symbol: string): string[] {
  const tokens = name
    .replace(/[^A-Za-z0-9&. -]/g, '')
    .split(/[\s.]+/)
    .filter((t) => t.length > 2 && !/^(ltd|limited|the|co|corporation|corp|group|industries|holding|bse|nse|share|bonds)$/i.test(t));
  if (symbol.length >= 2) tokens.unshift(symbol);
  return [...new Set(tokens)];
}

function looksRelevant(title: string, tokens: string[]): boolean {
  const t = title.toLowerCase();
  return tokens.some((tok) => t.includes(tok.toLowerCase()));
}

async function fetchRss(query: string): Promise<Article[]> {
  const url =
    'https://news.google.com/rss/search?q=' +
    encodeURIComponent(query) +
    '&hl=en-IN&gl=IN&ceid=IN:en';
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': US_UA, Accept: 'application/rss+xml' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
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
      const raw = decode(titleM[1].trim());
      if (!raw) continue;
      out.push({
        title: raw.replace(/^Top Stories\s*/, ''),
        source: srcM ? decode(srcM[1].trim()) : 'Google News',
        url: linkM[1].trim(),
        publishedAt: dateM ? new Date(dateM[1]).toISOString() : new Date().toISOString(),
        symbol: '',
      });
    }
    return out;
  } catch {
    return [];
  }
}

function normalize(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 80);
}

async function main(): Promise<void> {
  const previous: Record<string, Article[]> = {};
  if (existsSync(NEWS_FILE)) {
    try {
      const prev = JSON.parse(readFileSync(NEWS_FILE, 'utf8')) as {
        items?: Record<string, Article[]>;
      };
      if (prev.items) Object.assign(previous, prev.items);
    } catch {
      // ignore corrupt previous file
    }
  }

  const cutoff = Date.now() - KEEP_DAYS * 86_400_000;
  const merged: Record<string, Map<string, Article>> = {};

  const pushTo = (sym: string, a: Article) => {
    if (!sym) return;
    const key = normalize(a.title);
    if (key.length < 12) return;
    const t = new Date(a.publishedAt).getTime();
    if (!(sym in merged)) merged[sym] = new Map();
    if (!merged[sym].has(key) || t > new Date(merged[sym].get(key)!.publishedAt).getTime()) {
      merged[sym].set(key, { ...a, symbol: sym });
    }
  };

  // seed with previous week of news
  for (const sym of Object.keys(previous)) {
    for (const a of previous[sym]) {
      if (new Date(a.publishedAt).getTime() >= cutoff) pushTo(sym, a);
    }
  }

  // live fetch for every symbol
  let fetched = 0;
  for (const s of SEED) {
    const sym = s.symbol;
    const name = s.name;
    const tokens = significantTokens(name, sym);
    const queries = [
      `"${name}" stock NSE`,
      `"${name}" OR "${sym}" NSE law suit OR fraud OR scam OR SEBI OR CBI OR ED OR court OR FIR OR investigation OR penalty`,
      `${sym} NS news India market`,
    ];
    const seen: string[] = [];
    for (const q of queries) {
      const hits = await fetchRss(q);
      fetched += hits.length;
      for (const a of hits) {
        if (!looksRelevant(a.title, tokens)) continue;
        const n = normalize(a.title);
        if (seen.includes(n)) continue;
        seen.push(n);
        pushTo(sym, a);
      }
      await new Promise((r) => setTimeout(r, 120));
    }
  }

  const items: Record<string, Article[]> = {};
  for (const sym of Object.keys(merged)) {
    items[sym] = [...merged[sym].values()]
      .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
      .slice(0, PER_SYMBOL);
  }

  mkdirSync(join(process.cwd(), 'frontend', 'public'), { recursive: true });
  writeFileSync(
    NEWS_FILE,
    JSON.stringify({ generatedAt: new Date().toISOString(), symbols: Object.keys(items).length, items }, null, 0),
  );

  console.log(`news: ${Object.keys(items).length} symbols with news (raw fetched=${fetched}), 7-day window, max ${PER_SYMBOL}/symbol`);
}

main().catch((e) => {
  console.error('news failed:', e instanceof Error ? e.message : e);
  process.exitCode = 1;
});