// Daily concall read.
//
// For each covered NSE symbol this pulls the company page on screener.in,
// downloads the latest transcript (and the previous one), the latest credit
// rating rationale, and the latest annual report when the file is small
// enough to read. Sentences are taken from those documents and grouped into
// what management says it will do, what it expects to endure, and the rest
// of a SWOT. Each filing is then matched to the stock's own news headlines
// and to the NSE price move versus Nifty over the next session and five
// sessions.
//
// The whole book is not re-read every night. A batch of never-read or stale
// names is read in full. A larger watch batch only re-checks the page: a new
// transcript URL is read immediately, otherwise the stored read is kept and
// the price reaction is refreshed.
//
// Writes frontend/public/concalls.json and one small file per symbol at
// frontend/public/cc/{SYMBOL}.json — the stock page loads only its own file.
//
// Env:
//   CONCALL_PER_RUN     full document reads this run (default 12)
//   CONCALL_WATCH       page re-checks of names already read (default 36)
//   CONCALL_STALE_DAYS  re-read a transcript after this many days (default 21)
//   CONCALL_ONLY        comma-separated symbols (those are read in full)

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import http from 'http';
import https from 'https';
import { join } from 'path';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import {
  matchNews,
  mineProse,
  mineRating,
  parseAnnualLink,
  parseAnnouncements,
  parseConcallLinks,
  parseRatingLink,
  priceReaction,
  type MinedProse,
  type PriceMove,
  type PxBar,
  type Swot,
} from './concall-mine.ts';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
const ENGINE = 2;
const PER_RUN = Math.max(0, Number(process.env.CONCALL_PER_RUN ?? 12));
const WATCH = Math.max(0, Number(process.env.CONCALL_WATCH ?? 36));
const STALE_DAYS = Math.max(1, Number(process.env.CONCALL_STALE_DAYS ?? 21));
const ONLY = (process.env.CONCALL_ONLY ?? '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
const PDF_MAX = 8 * 1024 * 1024;
const AR_MAX = 12 * 1024 * 1024;
const ANN_PDF_MAX = 1_200_000;

const PUBLIC = join(process.cwd(), 'frontend', 'public');
const OUT_FILE = join(PUBLIC, 'concalls.json');
const CC_DIR = join(PUBLIC, 'cc');
const ANALYSIS_FILE = join(PUBLIC, 'analysis.json');
const UNIVERSE_FILE = join(PUBLIC, 'universe.json');
const NEWS_FILE = join(PUBLIC, 'news.json');

interface CallBrief {
  period: string | null;
  url: string;
  eventDate: string | null;
  summary: string;
  highlights: string[];
  swot: Swot;
  tone: MinedProse['tone'];
}

interface Impact {
  kind: 'concall' | 'annual-report' | 'credit-rating' | 'announcement';
  label: string;
  date: string | null;
  url: string;
  return1d: number | null;
  return5d: number | null;
  excess1d: number | null;
  excess5d: number | null;
  sessions: number;
  priceBefore: number | null;
  priceAfter: number | null;
}

interface Announcement {
  title: string;
  url: string;
  date: string | null;
  summary: string;
}

export interface ConcallEntry {
  symbol: string;
  name: string;
  checkedAt: string;
  readAt: string | null;
  engineVersion: number;
  latest: CallBrief | null;
  prior: CallBrief | null;
  annual: { label: string; url: string; year: string | null; summary: string; highlights: string[] } | null;
  rating: { label: string; url: string; date: string | null; action: string; summary: string } | null;
  announcements: Announcement[];
  impacts: Impact[];
  newsMatches: { title: string; source: string; url: string; publishedAt: string; overlap: string; aroundFiling: boolean }[];
  transcriptUrl: string | null;
}

interface Store {
  generatedAt: string;
  engineVersion: number;
  universe: number;
  coverage: number;
  data: Record<string, ConcallEntry>;
}

interface StockRef {
  symbol: string;
  name: string;
  marketCap: number;
}

function httpGet(url: string, headers: Record<string, string>, timeoutMs: number, maxBytes: number, redirects = 0): Promise<{ status: number; body: Buffer } | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v: { status: number; body: Buffer } | null) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    const lib = url.startsWith('http:') ? http : https;
    const req = lib.get(url, { headers, timeout: timeoutMs }, (res) => {
      const status = res.statusCode ?? 0;
      const loc = res.headers.location;
      if (status >= 300 && status < 400 && loc && redirects < 4) {
        res.resume();
        const next = new URL(loc, url).toString();
        httpGet(next, headers, timeoutMs, maxBytes, redirects + 1).then(finish);
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      let tooBig = false;
      res.on('data', (c: Buffer) => {
        size += c.length;
        if (size > maxBytes) {
          tooBig = true;
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      res.on('end', () => finish(tooBig ? null : { status, body: Buffer.concat(chunks) }));
      res.on('error', () => finish(null));
    });
    req.on('error', () => finish(null));
    req.on('timeout', () => {
      req.destroy();
      finish(null);
    });
  });
}

async function fetchBuf(url: string, timeoutMs: number, maxBytes: number): Promise<Buffer | null> {
  const res = await httpGet(url, { 'User-Agent': UA, Accept: '*/*', Referer: 'https://www.screener.in/' }, timeoutMs, maxBytes);
  if (!res || res.status < 200 || res.status >= 300) return null;
  return res.body;
}

async function fetchText(url: string, timeoutMs = 25000): Promise<string | null> {
  try {
    const res = await httpGet(url, { 'User-Agent': UA, Accept: 'text/html' }, timeoutMs, 3_000_000);
    if (!res || res.status < 200 || res.status >= 300) return null;
    return res.body.toString('utf8');
  } catch {
    return null;
  }
}

async function fetchPdfText(url: string, maxBytes: number): Promise<string | null> {
  try {
    const buf = await fetchBuf(url, 60000, maxBytes);
    if (!buf || buf.length < 5 || buf.subarray(0, 4).toString() !== '%PDF') return null;
    const parsed = await pdfParse(buf);
    const text = String(parsed.text ?? '')
      .replace(/ﬁ/g, 'fi')
      .replace(/ﬂ/g, 'fl')
      .replace(/[ \t]+/g, ' ')
      .trim();
    return text.length > 200 ? text : null;
  } catch {
    return null;
  }
}

function annualSlice(text: string): string {
  const idx = text.search(/management discussion|dear shareholder|chairman's letter|chairperson's letter/i);
  if (idx >= 0) return text.slice(idx, idx + 18000);
  return text.slice(0, 14000);
}

function toBrief(period: string | null, url: string, mined: MinedProse): CallBrief {
  return {
    period,
    url,
    eventDate: mined.eventDate,
    summary: mined.summary,
    highlights: mined.highlights,
    swot: mined.swot,
    tone: mined.tone,
  };
}

function impactOf(kind: Impact['kind'], label: string, url: string, date: string | null, stock: PxBar[], market: PxBar[]): Impact {
  const px: PriceMove = priceReaction(stock, market, date);
  return {
    kind, label, date, url,
    return1d: px.return1d,
    return5d: px.return5d,
    excess1d: px.excess1d,
    excess5d: px.excess5d,
    sessions: px.sessions,
    priceBefore: px.priceBefore,
    priceAfter: px.priceAfter,
  };
}

async function loadBars(ticker: string): Promise<PxBar[]> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1y`;
    const res = await httpGet(url, { 'User-Agent': UA, Accept: 'application/json' }, 15000, 4_000_000);
    if (!res || res.status < 200 || res.status >= 300) return [];
    const json = JSON.parse(res.body.toString('utf8')) as {
      chart?: { result?: { timestamp?: number[]; indicators?: { quote?: { close?: (number | null)[] }[] } }[] };
    };
    const result = json.chart?.result?.[0];
    const ts = result?.timestamp ?? [];
    const closes = result?.indicators?.quote?.[0]?.close ?? [];
    const out: PxBar[] = [];
    for (let i = 0; i < ts.length; i++) {
      const c = closes[i];
      if (c == null || !Number.isFinite(c)) continue;
      const day = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(new Date(ts[i] * 1000));
      out.push({ day, c });
    }
    return out;
  } catch {
    return [];
  }
}

function loadStore(): Store | null {
  if (!existsSync(OUT_FILE)) return null;
  try {
    const raw = JSON.parse(readFileSync(OUT_FILE, 'utf8')) as Store;
    if (!raw?.data) return null;
    return raw;
  } catch {
    return null;
  }
}

function loadStocks(): StockRef[] {
  const out = new Map<string, StockRef>();
  if (existsSync(ANALYSIS_FILE)) {
    try {
      const raw = JSON.parse(readFileSync(ANALYSIS_FILE, 'utf8')) as {
        stocks?: Record<string, { name?: string; marketCap?: number }>;
      };
      for (const [sym, e] of Object.entries(raw.stocks ?? {})) {
        if (!sym) continue;
        out.set(sym, { symbol: sym, name: e?.name || sym, marketCap: Number(e?.marketCap) || 0 });
      }
    } catch { /* ignore */ }
  }
  if (existsSync(UNIVERSE_FILE)) {
    try {
      const raw = JSON.parse(readFileSync(UNIVERSE_FILE, 'utf8')) as {
        stocks?: { symbol?: string; name?: string; mktCap?: number; marketCap?: number }[];
      };
      for (const s of raw.stocks ?? []) {
        if (!s.symbol || out.has(s.symbol)) continue;
        out.set(s.symbol, { symbol: s.symbol, name: s.name || s.symbol, marketCap: Number(s.mktCap ?? s.marketCap) || 0 });
      }
    } catch { /* ignore */ }
  }
  return [...out.values()];
}

function loadNews(): Record<string, { title: string; source: string; url: string; publishedAt: string }[]> {
  if (!existsSync(NEWS_FILE)) return {};
  try {
    const raw = JSON.parse(readFileSync(NEWS_FILE, 'utf8')) as {
      items?: Record<string, { title: string; source: string; url: string; publishedAt: string }[]>;
    };
    return raw.items ?? {};
  } catch {
    return {};
  }
}

function ignoreTokens(name: string, symbol: string): string[] {
  return name
    .split(/[\s.]+/)
    .map((t) => t.toLowerCase())
    .filter((t) => t.length > 2 && !/^(ltd|limited|the|and|company)$/.test(t))
    .concat(symbol.toLowerCase());
}

function writeOutputs(store: Store): void {
  mkdirSync(CC_DIR, { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify(store));
  for (const [sym, entry] of Object.entries(store.data)) {
    const body = JSON.stringify({ generatedAt: store.generatedAt, ...entry });
    writeFileSync(join(CC_DIR, `${encodeURIComponent(sym)}.json`), body);
  }
}

function buildImpacts(entry: Pick<ConcallEntry, 'latest' | 'prior' | 'annual' | 'rating' | 'announcements'>, stock: PxBar[], market: PxBar[]): Impact[] {
  const impacts: Impact[] = [];
  if (entry.latest) impacts.push(impactOf('concall', entry.latest.period ? `Concall ${entry.latest.period}` : 'Latest concall', entry.latest.url, entry.latest.eventDate, stock, market));
  if (entry.prior?.eventDate) impacts.push(impactOf('concall', entry.prior.period ? `Concall ${entry.prior.period}` : 'Previous concall', entry.prior.url, entry.prior.eventDate, stock, market));
  if (entry.rating?.date) impacts.push(impactOf('credit-rating', entry.rating.label, entry.rating.url, entry.rating.date, stock, market));
  for (const a of entry.announcements) {
    if (!a.date) continue;
    impacts.push(impactOf('announcement', a.title, a.url, a.date, stock, market));
    if (impacts.length >= 8) break;
  }
  return impacts.slice(0, 8);
}

async function companyPage(symbol: string): Promise<string | null> {
  return await fetchText(`https://www.screener.in/company/${encodeURIComponent(symbol)}/consolidated/`)
    ?? await fetchText(`https://www.screener.in/company/${encodeURIComponent(symbol)}/`);
}

async function readSymbol(
  ref: StockRef,
  market: PxBar[],
  news: { title: string; source: string; url: string; publishedAt: string }[],
  previous: ConcallEntry | null,
  full: boolean,
): Promise<ConcallEntry | null> {
  const html = await companyPage(ref.symbol);
  if (!html || html.length < 2000) return null;

  const calls = parseConcallLinks(html);
  const anns = parseAnnouncements(html);
  const annual = parseAnnualLink(html);
  const ratingLink = parseRatingLink(html);
  const transcriptUrl = calls[0]?.url ?? null;
  const unchanged = previous?.transcriptUrl && transcriptUrl === previous.transcriptUrl;

  let latest = previous?.latest ?? null;
  let prior = previous?.prior ?? null;
  let annualOut = previous?.annual ?? null;
  let ratingOut = previous?.rating ?? null;
  let announcements: Announcement[] = anns.map((a) => {
    const old = previous?.announcements.find((p) => p.url === a.url);
    return { ...a, summary: old?.summary || a.title };
  });
  let readAt = previous?.readAt ?? null;

  const shouldRead = full || !unchanged || !latest || (previous?.engineVersion ?? 0) < ENGINE;
  if (shouldRead && transcriptUrl) {
    const text = await fetchPdfText(transcriptUrl, PDF_MAX);
    if (text) {
      latest = toBrief(calls[0].period, transcriptUrl, mineProse(text));
      readAt = new Date().toISOString();
    }
    const prevUrl = calls[1]?.url;
    if (prevUrl && prevUrl !== previous?.prior?.url) {
      const prevText = await fetchPdfText(prevUrl, PDF_MAX);
      if (prevText) prior = toBrief(calls[1].period, prevUrl, mineProse(prevText));
    }
    if (ratingLink) {
      const page = await fetchText(ratingLink.url);
      const mined = page ? mineRating(page) : { action: 'update', summary: '' };
      ratingOut = {
        label: ratingLink.label,
        url: ratingLink.url,
        date: ratingLink.date,
        action: mined.summary ? mined.action : (previous?.rating?.action ?? mined.action),
        summary: mined.summary || previous?.rating?.summary || '',
      };
    }
    if (annual && annual.url !== previous?.annual?.url) {
      const arText = await fetchPdfText(annual.url, AR_MAX);
      const mined = arText ? mineProse(annualSlice(arText)) : null;
      annualOut = {
        label: annual.label,
        url: annual.url,
        year: annual.year,
        summary: mined?.summary ?? '',
        highlights: mined?.highlights.slice(0, 4) ?? [],
      };
    }
    const freshAnn = announcements.filter((a) => a.summary === a.title && a.url !== transcriptUrl).slice(0, 2);
    for (const a of freshAnn) {
      const blob = await fetchPdfText(a.url, ANN_PDF_MAX);
      if (!blob) continue;
      const line = mineProse(blob.slice(0, 8000)).highlights[0];
      if (line) a.summary = line;
    }
  }

  const stock = await loadBars(`${ref.symbol}.NS`);
  const impacts = buildImpacts({ latest, prior, annual: annualOut, rating: ratingOut, announcements }, stock, market);
  const prose = [latest?.summary, ...(latest?.highlights ?? [])].filter(Boolean).join(' ');
  const newsMatches = matchNews(prose, news, latest?.eventDate ?? null, ignoreTokens(ref.name, ref.symbol));

  return {
    symbol: ref.symbol,
    name: ref.name,
    checkedAt: new Date().toISOString(),
    readAt,
    engineVersion: shouldRead && latest ? ENGINE : (previous?.engineVersion ?? ENGINE),
    latest,
    prior,
    annual: annualOut,
    rating: ratingOut,
    announcements,
    impacts,
    newsMatches,
    transcriptUrl,
  };
}

async function main(): Promise<void> {
  if (process.argv.includes('--split-only')) {
    const store = loadStore();
    if (!store) {
      console.log('concalls: no store to split');
      return;
    }
    store.generatedAt = store.generatedAt || new Date().toISOString();
    writeOutputs(store);
    console.log(`concalls: split ${Object.keys(store.data).length} symbols`);
    return;
  }

  const stocks = loadStocks();
  const bySym = new Map(stocks.map((s) => [s.symbol, s]));
  for (const sym of ONLY) {
    if (!bySym.has(sym)) bySym.set(sym, { symbol: sym, name: sym, marketCap: 0 });
  }
  const universe = [...bySym.values()];
  const prev = loadStore();
  const data: Record<string, ConcallEntry> = { ...(prev?.data ?? {}) };
  const news = loadNews();
  const staleBefore = Date.now() - STALE_DAYS * 86_400_000;

  const needsFull = (s: StockRef): boolean => {
    const old = data[s.symbol];
    if (!old) return true;
    if ((old.engineVersion ?? 0) < ENGINE) return true;
    // A name with no transcript is retried after two days, not every night.
    if (!old.latest) {
      const age = Date.now() - new Date(old.checkedAt).getTime();
      return !(age >= 0) || age > 2 * 86_400_000;
    }
    if (!old.readAt) return true;
    return new Date(old.readAt).getTime() < staleBefore;
  };

  let fullList: StockRef[];
  let watchList: StockRef[];
  if (ONLY.length) {
    fullList = ONLY.map((sym) => bySym.get(sym)!);
    watchList = [];
  } else {
    const ranked = [...universe].sort((a, b) => {
      const ea = data[a.symbol];
      const eb = data[b.symbol];
      const emptyA = ea?.latest ? 1 : 0;
      const emptyB = eb?.latest ? 1 : 0;
      if (emptyA !== emptyB) return emptyA - emptyB;
      const ta = ea?.readAt ? new Date(ea.readAt).getTime() : 0;
      const tb = eb?.readAt ? new Date(eb.readAt).getTime() : 0;
      if (ta !== tb) return ta - tb;
      return b.marketCap - a.marketCap;
    });
    fullList = ranked.filter(needsFull).slice(0, PER_RUN);
    const fullSet = new Set(fullList.map((s) => s.symbol));
    watchList = ranked
      .filter((s) => !fullSet.has(s.symbol) && data[s.symbol]?.latest)
      .sort((a, b) => (data[a.symbol]?.checkedAt ?? '').localeCompare(data[b.symbol]?.checkedAt ?? ''))
      .slice(0, WATCH);
  }

  console.log(`concalls: universe ${universe.length} · full ${fullList.length} · watch ${watchList.length}`);
  const market = await loadBars('^NSEI');
  console.log(`concalls: nifty bars ${market.length}`);

  const save = () => {
    const coverage = Object.values(data).filter((d) => d.latest).length;
    writeOutputs({
      generatedAt: new Date().toISOString(),
      engineVersion: ENGINE,
      universe: universe.length,
      coverage,
      data,
    });
  };

  let done = 0;
  for (const ref of fullList) {
    try {
      const entry = await readSymbol(ref, market, news[ref.symbol] ?? [], data[ref.symbol] ?? null, true);
      if (!entry) {
        console.log(`concalls: ${ref.symbol} page unavailable — keeping previous`);
      } else {
        data[ref.symbol] = entry;
        const tone = entry.latest?.tone ?? 'no transcript';
        console.log(`concalls: ${ref.symbol} ${entry.latest?.period ?? 'no call'} ${tone} impacts ${entry.impacts.length} news ${entry.newsMatches.length}`);
      }
    } catch (err) {
      console.log(`concalls: ${ref.symbol} FAILED ${err instanceof Error ? err.message.slice(0, 100) : err}`);
    }
    done += 1;
    if (done % 4 === 0) save();
  }

  let upgrades = 0;
  for (const ref of watchList) {
    try {
      const old = data[ref.symbol];
      const html = await companyPage(ref.symbol);
      const latestUrl = html ? parseConcallLinks(html)[0]?.url ?? null : null;
      const changed = Boolean(latestUrl && latestUrl !== old?.transcriptUrl);
      if (changed && upgrades < 6) {
        upgrades += 1;
        const entry = await readSymbol(ref, market, news[ref.symbol] ?? [], old ?? null, true);
        if (entry) {
          data[ref.symbol] = entry;
          console.log(`concalls: ${ref.symbol} new transcript ${entry.latest?.period ?? ''}`);
        }
      } else if (old && html) {
        const anns = parseAnnouncements(html).map((a) => {
          const kept = old.announcements.find((p) => p.url === a.url);
          return { ...a, summary: kept?.summary || a.title };
        });
        const stock = await loadBars(`${ref.symbol}.NS`);
        data[ref.symbol] = {
          ...old,
          announcements: anns.length ? anns : old.announcements,
          impacts: buildImpacts({ ...old, announcements: anns.length ? anns : old.announcements }, stock, market),
          newsMatches: matchNews(
            [old.latest?.summary, ...(old.latest?.highlights ?? [])].join(' '),
            news[ref.symbol] ?? [],
            old.latest?.eventDate ?? null,
            ignoreTokens(ref.name, ref.symbol),
          ),
          checkedAt: new Date().toISOString(),
        };
        console.log(`concalls: ${ref.symbol} watch prices refreshed`);
      }
    } catch (err) {
      console.log(`concalls: ${ref.symbol} watch FAILED ${err instanceof Error ? err.message.slice(0, 80) : err}`);
    }
  }

  save();
  const coverage = Object.values(data).filter((d) => d.latest).length;
  console.log(`concalls: done · coverage ${coverage}/${universe.length}`);
}

main().catch((err) => {
  console.error('concalls failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
