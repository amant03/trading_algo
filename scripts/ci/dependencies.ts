// Dependencies engine — disclosed + reverse-graph supplier/customer map.
//
// For every covered stock (market cap > Rs 5,000 cr) this reads what the
// company ITSELF disclosed and extracts the counterparties it depends on:
//   * cost side  (suppliers) — who it buys inputs from
//   * revenue side (customers) — who buys its output
//
// Ranking is by disclosed economics, not name frequency:
//   1. % of revenue / purchases when the filing states it
//   2. related-party purchase / sale amounts in the annual report
//   3. listed counterparties over unnamed private entities
//
// Sources (public, login-free via screener.in document links):
//   S1. Latest credit-rating rationale (CRISIL/ICRA/CARE/India Ratings)
//   S2. Latest annual-report PDF — Related Party notes (Ind AS 24) + MD&A
//   S3. Latest concall transcript + investor presentation PDFs
//
// After per-symbol extraction, a reverse-graph pass fills the other side:
// if ONGC discloses IOC as a customer, IOC's cost side gains ONGC. That is
// how the long tail (and names that never name counterparties) get coverage
// without inventing relationships.
//
// Anti-hallucination:
//   * a listed link is emitted only when a company name / standard abbreviation
//     sits in a relational sentence (customers include, supplies to, sourced
//     from, …) or on an RPT purchase/sale row with a rupee amount
//   * intra-group unlisted SPVs (Adani Transmission Step-Two, …) are dropped
//   * JV / "was formed" boilerplate is dropped
//   * every row carries verbatim evidence + source
//
// Incremental cycle: symbols are ordered oldest-checked first so the whole
// >₹5,000 cr set rotates. Empty names are retried when the engine version
// bumps. DEPS_PER_RUN (default 60) caps fetches per job.
//
// Writes: frontend/public/dependencies.json
//
// Env:
//   DEPS_PER_RUN      max symbols fetched this run (default 60; 0 = sanitize only)
//   DEPS_ONLY         comma-separated symbols (targeted runs)
//   DEPS_STALE_DAYS   refresh after this many days (default 7)

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
const THRESHOLD = 5e10; // Rs 5,000 cr
const POOL_SIZE = 6;
const PDF_MAX_BYTES = 60 * 1024 * 1024;
const PER_RUN = Math.max(0, Number(process.env.DEPS_PER_RUN ?? 60));
const STALE_DAYS = Math.max(1, Number(process.env.DEPS_STALE_DAYS ?? 7));
const ONLY = (process.env.DEPS_ONLY ?? '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
const OUT_FILE = join(process.cwd(), 'frontend', 'public', 'dependencies.json');
const ANALYSIS_FILE = join(process.cwd(), 'frontend', 'public', 'analysis.json');
const UNIVERSE_FILE = join(process.cwd(), 'frontend', 'public', 'universe.json');
const ENGINE_VERSION = 5;

export type DepBasis = 'disclosed-report' | 'disclosed-rpt' | 'disclosed-fact' | 'inferred-reverse';

export interface DepRow {
  name: string;
  symbol: string | null;
  side: 'supplier' | 'customer';
  evidence: string;
  source: string;
  basis: DepBasis;
  amount?: number | null;
  share?: number | null;
  via?: { symbol: string; name: string } | null;
}

export interface DepEntry {
  suppliers: DepRow[];
  customers: DepRow[];
  sources: { label: string; url: string }[];
  checkedAt: string;
  note?: string | null;
  engineVersion?: number;
  about?: { text: string; highlights: string[] } | null;
  costSplit?: { label: string; pct: number }[] | null;
  revenueGeo?: { label: string; pct: number }[] | null;
  factors?: { label: string; evidence: string; source: string }[] | null;
}

interface LiteCo {
  symbol: string;
  name: string;
  core: string[];
  norm: string;
  inAnalysis: boolean;
}

interface StoreFile {
  generatedAt: string;
  thresholdCr: number;
  universe: number;
  coverage: number;
  engineVersion: number;
  data: Record<string, DepEntry>;
}

// ---- text helpers ------------------------------------------------------------

function cleanHtml(t: string): string {
  return t
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function sentences(t: string): string[] {
  return t
    .split(/(?<=[.!?;])\s+(?=[A-Z0-9("])/g)
    .map((s) => s.trim())
    .filter((s) => s.length > 40 && s.length < 1200);
}

async function fetchText(url: string, timeoutMs = 25000): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

async function fetchPdfText(url: string): Promise<{ text: string; pages: number }> {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' }, signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > PDF_MAX_BYTES) throw new Error('PDF too large');
  const d = await pdfParse(buf);
  // normalize ligature/control artifacts from embedded subset fonts
  // ("beneﬁts", "Pro¤it") so keyword matchers see real words
  const raw = d.text
    .replace(/ﬁ/g, 'fi')
    .replace(/ﬂ/g, 'fl')
    .replace(/ﬀ/g, 'ff')
    .replace(/¤/g, 'fi')
    .replace(/[̀-ͯ]/g, '');
  return { text: raw.replace(/ +/g, ' ').replace(/\n{3,}/g, '\n\n').trim(), pages: d.numpages };
}

async function tryOnce<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    try {
      await new Promise((r) => setTimeout(r, 1500));
      return await fn();
    } catch {
      return null;
    }
  }
}

function parseShare(text: string): number | null {
  const m = text.match(/(\d{1,2}(?:\.\d+)?)\s*%/);
  if (!m) return null;
  const n = Number(m[1]);
  return n > 0 && n <= 100 ? n : null;
}

function parseAmount(text: string): number | null {
  const nums = (text.replace(/(?:[UL]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6})/g, ' ').match(/\d[\d,]*(?:\.\d+)?/g) ?? [])
    .map((n) => Number(n.replace(/,/g, '')))
    .filter((v) => Number.isFinite(v) && v >= 1);
  const vals = nums.filter((v) => {
    if (v >= 1900 && v <= 2100 && Number.isInteger(v)) return false;
    return true;
  });
  if (!vals.length) return null;
  return Math.max(...vals);
}

// ---- universe name index ------------------------------------------------------

const STOP = new Set(
  'ltd limited pvt private the and of co company corp corporation group holdings enterprises industry international global services service systems technologies technology solutions products'.split(' '),
);
const GENERIC = new Set(
  'passenger vehicles vehicle power energy oil gas steel bank banking insurance pharma pharmaceuticals cement telecom foods food consumer retail software consulting chemicals chemical metals mining paper textiles hotels airlines logistics ports housing realty auto motors electric electrical electronics engineering digital industrial commercial overseas offshore life health care rural urban aluminium aluminum copper zinc lead nickel rubber plastic glass sugar cotton crude green investment investments petroleum assurance communications consumer container dynamics consultancy properties persistent breweries granules financial capital portfolio milestone enterprise international global infrastructure governance education holdings holding ventures india indian'.split(' '),
);

const ALIAS: Record<string, string> = {
  IOC: 'IOC', IOCL: 'IOC', HPCL: 'HINDPETRO', BPCL: 'BPCL', GAIL: 'GAIL', SAIL: 'SAIL',
  NTPC: 'NTPC', BHEL: 'BHEL', HAL: 'HAL', BEL: 'BEL', SBIN: 'SBIN', SBI: 'SBIN',
  ONGC: 'ONGC', NHPC: 'NHPC', PFC: 'PFC', REC: 'RECLTD', IRFC: 'IRFC', LIC: 'LICI',
  CIL: 'COALINDIA', OIL: 'OIL', MRPL: 'MRPL', CPCL: 'CHENNPETRO',
  HUL: 'HINDUNILVR', ICICI: 'ICICIBANK', HDFC: 'HDFCBANK', AXIS: 'AXISBANK',
  ITC: 'ITC', BOB: 'BANKBARODA', PNB: 'PNB', 'M&M': 'M&M', 'BAJAJ AUTO': 'BAJAJ-AUTO',
  JSPL: 'JINDALSTEL', JSP: 'JINDALSTEL', HMCL: 'HEROMOTOCO', PLL: 'PETRONET',
  MINDA: 'UNOMINDA', 'UNO MINDA': 'UNOMINDA', BOSCH: 'BOSCHLTD',
  MARUTI: 'MARUTI', MSIL: 'MARUTI',
  'TATA MOTORS': 'TMCV', TATAMOTORS: 'TMCV', TMCV: 'TMCV', TMPV: 'TMPV',
  NMDC: 'NMDC', VEDANTA: 'VEDL', HZL: 'HINDZINC',
};

function coreTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9 &]/g, ' ')
    .split(/[\s&]+/)
    .filter((w) => w.length >= 3 && !STOP.has(w));
}

function normName(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(ltd|limited|pvt|private|plc|inc|llc|the|co|corp|corporation)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

let UNIVERSE: LiteCo[] = [];
const BY_SYM = new Map<string, LiteCo>();
const EXACT = new Map<string, LiteCo>();
const PHRASE_INDEX = new Map<string, LiteCo>();

function prefer(a: LiteCo, b: LiteCo): LiteCo {
  if (a.inAnalysis !== b.inAnalysis) return a.inAnalysis ? a : b;
  return a;
}

function buildIndexes(entries: { symbol: string; name: string }[], analysisSyms: Set<string>): void {
  UNIVERSE = entries.map((e) => ({
    symbol: e.symbol,
    name: e.name,
    core: coreTokens(e.name),
    norm: normName(e.name),
    inAnalysis: analysisSyms.has(e.symbol),
  }));
  BY_SYM.clear();
  EXACT.clear();
  PHRASE_INDEX.clear();
  const owners = new Map<string, Set<string>>();
  const phraseMap = new Map<string, LiteCo>();
  for (const u of UNIVERSE) {
    const prev = BY_SYM.get(u.symbol);
    BY_SYM.set(u.symbol, prev ? prefer(prev, u) : u);
    if (u.norm.length >= 6) {
      const ex = EXACT.get(u.norm);
      EXACT.set(u.norm, ex ? prefer(ex, u) : u);
    }
    // Sentence phrases are built only from the analysed / large-cap set.
    // Indexing all 5,000+ names matches "financial" / "infrastructure" to
    // tiny BSE listings. RPT rows still resolve via EXACT against the full list.
    if (!u.inAnalysis) continue;
    const distinctive = u.core.filter((t) => t.length >= 4 && !GENERIC.has(t));
    if (distinctive.length >= 2) {
      const phrase = distinctive.join(' ');
      const set = owners.get(phrase) ?? new Set();
      set.add(u.symbol);
      owners.set(phrase, set);
      const cur = phraseMap.get(phrase);
      phraseMap.set(phrase, cur ? prefer(cur, u) : u);
    }
  }
  for (const [phrase, set] of owners) {
    if (set.size === 1) {
      const co = phraseMap.get(phrase);
      if (co) PHRASE_INDEX.set(phrase, co);
    }
  }
}

function findListedInText(sent: string, selfSym: string): LiteCo[] {
  const hits: LiteCo[] = [];
  const seen = new Set<string>();
  const push = (co: LiteCo | undefined) => {
    if (!co || co.symbol === selfSym || seen.has(co.symbol)) return;
    seen.add(co.symbol);
    hits.push(co);
  };
  for (const [ab, sym] of Object.entries(ALIAS)) {
    if (sym === selfSym) continue;
    if (ab.length <= 3 && !new RegExp(`\\b${ab}\\b`).test(sent)) continue;
    if (new RegExp(`\\b${ab.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(sent)) {
      push(BY_SYM.get(sym));
    }
  }
  const words = sent.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').trim().split(/\s+/).filter(Boolean);
  for (const n of [3, 2, 1]) {
    for (let i = 0; i <= words.length - n; i++) {
      const phrase = words.slice(i, i + n).join(' ');
      push(PHRASE_INDEX.get(phrase));
    }
  }
  return hits;
}

function evidenceSupports(listed: LiteCo, evidence: string): boolean {
  const ev = ` ${evidence.toLowerCase().replace(/[^a-z0-9 ]/g, ' ')} `;
  if (listed.norm.length >= 8 && ev.includes(` ${listed.norm} `)) return true;
  const distinctive = listed.core.filter((t) => t.length >= 4 && !GENERIC.has(t));
  if (distinctive.length >= 2 && distinctive.every((t) => ev.includes(` ${t} `))) return true;
  if (ev.includes(` ${listed.symbol.toLowerCase()} `)) return true;
  for (const [ab, sym] of Object.entries(ALIAS)) {
    if (ab.length < 3) continue;
    if (sym === listed.symbol && new RegExp(`\\b${ab.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(evidence)) return true;
  }
  return false;
}

function resolveByName(name: string, selfSym: string, exactOnly = false): LiteCo | null {
  const n = normName(name);
  if (n.length >= 6) {
    const exact = EXACT.get(n);
    if (exact && exact.symbol !== selfSym) return exact;
  }
  if (exactOnly) return null;
  const hits = findListedInText(name, selfSym);
  return hits[0] ?? null;
}

// ---- display-name cleaning -------------------------------------------------------

const TXN_PREFIX =
  /^(?:purchase of goods?|sale of goods?|purchase of|sale of|sales to|includes sales to|rendering of services?-?|rendering of|storage income|commission income|other income[-a-z ]*|rental income|premium income|reimbursement of [a-z]+|rent income|other expenses[-a-z]*|expenses(?: reimbursed)?|services\/assets|assets|hiring of|service charges(?: paid)?|royalty received|vendor)\s*/i;

const GARBAGE_NAME =
  /^(?:limited|private|pte|proprietary|partner|four|services|plant|hospitals|lanka|fuels pvt|singapore)\)?/i;

function cleanDisplayName(raw: string): string | null {
  let n = raw.replace(/\s+/g, ' ').trim();
  n = n.replace(/^(?:includes sales to|includes)\s+/i, '');
  n = n.replace(TXN_PREFIX, '').trim();
  n = n.replace(/^(?:purchase of goods?|sale of goods?)\s*/i, '').trim();
  n = n.replace(/^Board is not applicable\.?\s*/i, '').trim();
  n = n.replace(/^(?:\d+\.\s*-?\s*)+/, '').trim();
  n = n.replace(/^(?:vendor|m\/s|ms\.?|shri|smt\.?)\s+/i, '').trim();
  n = n.replace(/\s+-\s+/g, '-');
  n = n.replace(/^[^A-Za-z]+/, '').trim();
  if (n.length < 8 || n.length > 90) return null;
  if (GARBAGE_NAME.test(n)) return null;
  if (/^[a-z]/.test(n)) return null;
  if (/\)\s*(?:pte|ltd|limited)\b/i.test(n) && n.includes(')')) return null;
  if (/^(?:operation|formerly|details|detail|statement|total|balance|amount|nature|particulars|name of)\b/i.test(n)) return null;
  if (/\b(dividend|interest|remuneration)\b/i.test(n) && !/limited|ltd|private/i.test(n)) return null;
  return n;
}

function isIntraGroupUnlisted(name: string, selfName: string, listed: LiteCo | null, selfSym?: string): boolean {
  if (listed) return false;
  if (selfSym && new RegExp(`\\b${selfSym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(name)) return true;
  const brand = coreTokens(selfName).find((t) => !GENERIC.has(t) && t.length >= 4);
  if (!brand) return false;
  return coreTokens(name).includes(brand);
}

function isGarbageName(name: string): boolean {
  const words = name.split(/\s+/);
  if (words.length < 2) return true;
  if (/^\d/.test(name)) return true;
  if (/\d/.test(name) && !/\b(3m|63)\b/i.test(name)) return true;
  if (words.length > 8) return true;
  return false;
}

// ---- sentence miner -----------------------------------------------------------

const CUST_WORDS = ['customer', 'client', 'offtake', 'order book', 'orderbook', 'buyer', 'offtaker'];
const SUP_WORDS = ['supplier', 'vendor', 'raw material', 'procurement', 'sourcing', 'sourced', 'procured'];
const REL_VERBS = [
  'customers include', 'clients include', 'customer includes', 'client includes',
  'supplies to', 'supply to', 'supplied to', 'supplying to',
  'order from', 'orders from', 'sourced from', 'procures from', 'procured from',
  'depends on', 'dependence on', 'dependent on', 'caters to', 'cater to',
  'sold to', 'sells to', 'purchased from', 'purchases from', 'buy from', 'buying from', 'sourcing from',
];
const REL_FRAMES = [
  /suppl\w*\s[^.?!]{0,50}\bto\b/i, /order\w*\s[^.?!]{0,50}\bfrom\b/i,
  /sourc\w*\s[^.?!]{0,50}\bfrom\b/i, /procur\w*\s[^.?!]{0,50}\bfrom\b/i,
  /depend\w*\s[^.?!]{0,50}\bon\b/i, /cater\w*\s[^.?!]{0,50}\bto\b/i,
  /sell\w*\s[^.?!]{0,50}\bto\b/i, /\bsold\b\s[^.?!]{0,50}\bto\b/i,
  /purchas\w*\s[^.?!]{0,50}\bfrom\b/i, /buy\w*\s[^.?!]{0,50}\bfrom\b/i,
];
const BOILER = [
  'does not create a client relationship', 'rating committee', 'analytical approach',
  'rating criteria', 'methodology', 'criteria/', 'analyst', 'disclaimer', 'register',
  'plausible', 'conference call', 'good morning', 'good afternoon', 'thank you',
  'page ', 'question-and-answer', 'ladies and gentlemen',
  'offer to sell', 'offer to purchase', 'not an offer', 'subscribe',
  'warranty', 'warranties', 'assurance-type', 'supply chain risk',
  'audit para', 'cag', 'comptroller',
];
const JV_BOILER = /\b(joint venture|jv with|was formed|set up in|subsidiary of|associate of|equity interest)\b/i;

function sideFromSentence(l: string, selfSym?: string): 'supplier' | 'customer' | null {
  if (/\b(supplier|vendor)s?\s+(to|for)\b/.test(l)) return 'customer';
  if (/\bmsil supplier\b|\boem supplier\b|\b\w+ supplier to\b/.test(l)) return 'customer';
  if (/suppl\w+.{0,60}\bto\b/.test(l) && !/(sourced from|procured from|purchased from)/.test(l)) return 'customer';
  const fromSup = /(sourced from|procured from|purchased from|purchases from|buy from|buying from|imported from|hiring of)/.test(l);
  const toCust = /(customers include|clients include|supplies to|supplied to|supplying to|sold to|sells to|caters to|offtake|major customers|supply to)\b/.test(l);
  if (fromSup && !toCust) return 'supplier';
  if (toCust && !fromSup) return 'customer';
  if (selfSym && new RegExp(`\\bto\\b.{0,40}\\b${selfSym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(l)) return 'supplier';
  if (/\bto\b.{0,50}(the company|the group|our refiner|our plant|the corporation)/i.test(l)) return 'supplier';
  const hasCust = CUST_WORDS.some((w) => l.includes(w));
  const hasSup = SUP_WORDS.some((w) => l.includes(w));
  if (hasCust && !hasSup) return 'customer';
  if (hasSup && !hasCust) return 'supplier';
  if (l.includes('suppl') && (!l.includes('custom') || l.indexOf('suppl') < l.indexOf('custom'))) return 'supplier';
  if (hasCust || hasSup) return hasCust ? 'customer' : 'supplier';
  return null;
}

function mineIncludeLists(text: string, source: string, selfSym: string): DepRow[] {
  const rows: DepRow[] = [];
  const re =
    /(?:major\s+)?(?:customers?|clients?|buyers?|offtakers?|suppliers?|vendors?)\s+(?:include|are|comprise|:)\s+(.{8,220}?)(?:\.|$)/gi;
  let m: RegExpExecArray | null;
  const flat = text.replace(/\s+/g, ' ');
  while ((m = re.exec(flat))) {
    const chunk = m[1];
    const l = (m[0] + ' ' + chunk).toLowerCase();
    const side: 'supplier' | 'customer' = /supplier|vendor/.test(l) ? 'supplier' : 'customer';
    const parts = chunk.split(/\s*(?:,|&| and |\band\b)\s*/).map((p) => p.trim()).filter((p) => p.length >= 3);
    const share = parseShare(m[0]);
    for (const part of parts.slice(0, 8)) {
      const co = resolveByName(part, selfSym) ?? findListedInText(part, selfSym)[0];
      if (!co) continue;
      rows.push({
        name: co.name,
        symbol: co.symbol,
        side,
        evidence: m[0].slice(0, 240),
        source,
        basis: 'disclosed-report',
        share,
        amount: null,
      });
    }
  }
  return rows;
}

function mineSentences(text: string, source: string, selfSym: string): DepRow[] {
  const rows: DepRow[] = [...mineIncludeLists(text, source, selfSym)];
  const flat = text.replace(/\s+/g, ' ');
  for (const sent of sentences(flat)) {
    const l = sent.toLowerCase();
    if (BOILER.some((b) => l.includes(b))) continue;
    if (JV_BOILER.test(l) && !/(sale of|purchase of|customers include|sourced from|supplies to)/.test(l)) continue;
    if (/no (single|customer).{0,80}more than \d+%|top \d+ customers? (account|contribute)|diversified customer|no single customer contributing/i.test(sent)) {
      rows.push({
        name: 'Diversified customer base (no single large customer)',
        symbol: null,
        side: 'customer',
        evidence: sent.slice(0, 220),
        source,
        basis: 'disclosed-fact',
      });
      continue;
    }
    const kws = [...CUST_WORDS, ...SUP_WORDS, 'supplies to', 'sourced from', 'sold to'].filter((w) => l.includes(w));
    if (!kws.length && !REL_VERBS.some((v) => l.includes(v)) && !REL_FRAMES.some((re) => re.test(sent))) continue;
    if (!REL_VERBS.some((v) => l.includes(v)) && !REL_FRAMES.some((re) => re.test(sent))) continue;
    const side = sideFromSentence(l, selfSym);
    if (!side) continue;
    const cos = findListedInText(sent, selfSym).filter((co) => evidenceSupports(co, sent));
    if (!cos.length) continue;
    const share = parseShare(sent);
    for (const co of cos.slice(0, 4)) {
      const probe = co.core.find((t) => t.length >= 4 && l.includes(t)) ?? co.core[0] ?? '';
      const idx = l.indexOf(probe);
      const ev = sent.slice(Math.max(0, idx - 100), idx + 140).trim();
      rows.push({
        name: co.name,
        symbol: co.symbol,
        side,
        evidence: ev || sent.slice(0, 220),
        source,
        basis: 'disclosed-report',
        share,
        amount: null,
      });
    }
  }
  return rows;
}

// ---- RPT note miner (annual report) -----------------------------------------------

const TOC_DENY = /overview|contents|performance|approach|value creation|report|annexure|notice|directors report|management discussion|corporate governance|business responsibility|joint ventures|subsidiaries|associates|key management|board of directors|related parties|amount paid|advances/i;
const ENTITY_RE = /([A-Z][A-Za-z0-9&.,'()\- ]{3,60}?(?:Ltd|Limited|Private|GmbH|LLC|Pte|B\.V\.|S\.A\.S\.|Sdn|Bhd|Pty|K\.K\.|SpA|Corp|Holdings|Ventures))\b/g;
const LEAD_STRIP = /^(?:vendor|m\/s|ms\.?|shri|smt\.?)\s+/i;

const EXACT_DENY = new Set([
  'joint ventures', 'joint venture', 'subsidiaries', 'subsidiary', 'associates', 'associate',
  'key management personnel', 'board of directors', 'related parties', 'related party',
]);

function cleanRPTName(raw: string): string | null {
  let n = raw.replace(/\s+/g, ' ').trim();
  n = n.split(/(?:^|\s)(?:[UL]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6})\s*\d*\.?\s*/).pop()!.trim();
  n = n.replace(/^(?:\d+\.\s*-?\s*)+/, '').trim();
  n = n.replace(/^Board is not applicable\.?\s*/i, '').trim();
  n = n.replace(LEAD_STRIP, '').trim();
  for (let k = 0; k < 3; k++) {
    const m = n.match(/^(\$|₹|€|£)\s*[\d,.]+\s*(Mn|Bn|crore|lakh|million|billion)?\.?\s*|^[\d,.]+\s*(Mn|Bn|crore|lakh|million|billion)\.?\s*/i);
    if (!m || !m[0].trim()) break;
    n = n.slice(m[0].length).trim();
  }
  n = n.replace(/^(Mn|Bn)\.\s*/i, '').trim();
  n = n.replace(/\s+-\s+/g, '-');
  n = cleanDisplayName(n) ?? n;
  if (n.length < 8 || n.length > 90) return null;
  if (/\d/.test(n) && !/\b(3m|63)\b/i.test(n)) return null;
  if (n.split(/\s+/).length > 6) return null;
  const first = n.split(/\s+/)[0].toLowerCase();
  if (['limited', 'ltd', 'private', 'pvt', 'corporation', 'company', 'enterprises'].includes(first)) return null;
  if (/ltd|limited|private|^pvt/i.test(first)) return null;
  if (/dividend|interest|remuneration/i.test(n)) return null;
  if (/^(operation|formerly|details|detail|statement|total|balance|amount|nature|particulars|name of|sr\.?|s\.?\s?no)\b/i.test(n)) return null;
  if (/-JV\b|\bJV of\b/i.test(n)) return null;
  if (TOC_DENY.test(n)) return null;
  if (EXACT_DENY.has(n.toLowerCase())) return null;
  return n;
}

const SECTION_HEAD = /^\s*(?:[A-Z]\.|\(?[a-z]\)|\(?[ivx]+\)|\d{1,2}\.)?\s*(purchase of|sale of|sales|services received|services rendered|rendering of services|purchase|sale)\b/i;
const FIN_SECTION = /interest|dividend|rent|royalty|remuneration|\bloans?\b|advances?|guarantees?|investments?|deposits?|reimbursement|contribution|donation|borrowings?|payables?|receivables?|balances?|outstanding/i;
const MNA_SKIP = /shar(e|es|holding)|stake|equity|acquisition|merger|amalgamation|invest(ment|ed)?\b|consideration|goodwill|joint venture|engaged in the business|principal activit|carrying (on|out) the business|\bloan\b|repayable|guarantee|security|charge on|pari passu|hypothecat|mortgage|\blien\b|pledge|disposal|divest|non-current|subsidiari[sz]ation/i;
const SAME_LINE_CUST = /sale of|sales|rendering of services|service income|supplied to|supplies to|supply to/;
const SAME_LINE_SUP = /purchase|hiring of|service charges paid/;

function headerSide(line: string | undefined): 'supplier' | 'customer' | 'veto' | null {
  if (!line || line.length > 150) return null;
  if (/subsidiar|joint venture|associate compan|related part/i.test(line)) return 'veto';
  if (FIN_SECTION.test(line)) return 'veto';
  const l = line.toLowerCase();
  if (SECTION_HEAD.test(line)) {
    if (/purchase|services received/.test(l)) return 'supplier';
    if (/sale|rendering/.test(l)) return 'customer';
  }
  return null;
}

function mineRPT(text: string, source: string, selfSym: string, selfName: string): DepRow[] {
  const rows: DepRow[] = [];
  const selfN = selfName.toLowerCase().replace(/[^a-z]/g, '').replace(/(ltd|limited|private|pvt)$/, '');
  const lines = text.split(/\n+/).map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => l.length > 0);
  const seen = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length > 600) continue;
    const short = line.length < 60;
    const window = short
      ? [line, lines[i + 1], lines[i + 2], lines[i + 3], lines[i + 4]].filter(Boolean).join(' ')
      : line;
    ENTITY_RE.lastIndex = 0;
    let em: RegExpExecArray | null;
    while ((em = ENTITY_RE.exec(window)) && rows.length < 24) {
      const name = cleanRPTName(em[1]);
      if (!name) continue;
      const own = name.toLowerCase().replace(/[^a-z]/g, '').replace(/(ltd|limited|private|pvt)$/, '');
      if (own.includes(selfN) || selfN.includes(own)) continue;
      const wide = `${lines[i - 1] ?? ''} ${window} ${lines[i + 1] ?? ''}`;
      if (MNA_SKIP.test(wide)) continue;
      const above = headerSide(lines[i - 1]);
      const above2 = headerSide(lines[i - 2]);
      if (above === 'veto' || above2 === 'veto') continue;
      let side: 'supplier' | 'customer' | null = null;
      if (above === 'supplier' || above === 'customer') side = above;
      else if (above2 === 'supplier' || above2 === 'customer') side = above2;
      else if (SAME_LINE_SUP.test(line)) side = 'supplier';
      else if (SAME_LINE_CUST.test(line)) side = 'customer';
      if (!side) continue;
      if (/dividend|interest|remuneration|\bguarantee\b/i.test(window)
        && !/purchase of|sale of|sales|rendering of services|service income|service charges|hiring of/i.test(window)) continue;
      const amount = parseAmount(window);
      if (amount == null) {
        const before = window.slice(0, Math.max(0, em.index)).slice(-80);
        if (!/(sale of|sales to|supplied to|supplies to|purchase of|purchases from)[^.]{0,60}$/i.test(before)) continue;
      }
      if (/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2},? \d{4}|\b\d{1,2}-\d{1,2}-\d{2,4}|\b\d{1,2}\/\d{1,2}\/\d{2,4}/.test(window)
        && !SAME_LINE_SUP.test(window) && !SAME_LINE_CUST.test(window)) continue;
      if (amount === 0) continue;
      const listed = resolveByName(name, selfSym, true);
      if (isIntraGroupUnlisted(name, selfName, listed, selfSym)) continue;
      if (!listed && isGarbageName(name)) continue;
      const display = listed ? listed.name : name;
      const k = `${side}|${(listed?.symbol ?? display).toLowerCase()}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const evidence = window
        .replace(/(?:[UL]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6})/g, '')
        .replace(/\s+/g, ' ').trim()
        .slice(Math.max(0, em.index - 100), em.index + 140);
      rows.push({
        name: display,
        symbol: listed ? listed.symbol : null,
        side,
        evidence,
        source,
        basis: 'disclosed-rpt',
        amount,
        share: parseShare(window),
      });
    }
  }
  return rows;
}

// ---- v2 miners: about, cost split, revenue geo split, price factors -------
// All disclosed-only: every emitted item carries verbatim evidence or comes
// from a self-validating table (parts sum to a stated total). Anything that
// fails validation is dropped, never estimated.

function deEnt(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&nbsp;|&#160;/g, ' ').replace(/&[a-z]+;/g, ' ');
}

/** Screener company-profile: about paragraph + key-point highlights. */
function mineAbout(html: string): { text: string; highlights: string[] } | null {
  const ci = html.indexOf('company-profile');
  if (ci < 0) return null;
  const sec = html.slice(ci, ci + 9000);
  const end = sec.search(/Read More/i);
  const scope = end > 0 ? sec.slice(0, end) : sec;
  const paras: string[] = [];
  for (const m of scope.matchAll(/<p[^>]*>([\s\S]{20,1500}?)<\/p>/gi)) {
    const t = deEnt(m[1].replace(/<[^>]+>/g, ' ')).replace(/\[\d+\]/g, '').replace(/\s+/g, ' ').trim();
    if (t.length >= 60) paras.push(t);
    if (paras.length >= 2) break;
  }
  if (!paras.length || paras[0].length < 80) return null;
  const highlights = paras.length > 1
    ? paras[1].split(/(?<=[.!?])\s+(?=[A-Z0-9("])/g).map((s) => s.trim()).filter((s) => s.length > 30 && s.length <= 200).slice(0, 4)
    : [];
  return { text: paras[0].slice(0, 600), highlights };
}

/** Clean standalone number token (international or Indian grouping). Null otherwise. */
function cleanNum(tok: string): number | null {
  const t = tok.replace(/[()]/g, '');
  if (/^\d{1,3}(,\d{3})*(\.\d+)?$/.test(t)) return Number(t.replace(/,/g, ''));
  if (/^\d{1,2}(,\d{2})*(,\d{3})(\.\d+)?$/.test(t)) return Number(t.replace(/,/g, ''));
  return null;
}

function signedNum(tok: string): number | null {
  const neg = /^\(.*\)$/.test(tok.trim());
  const v = cleanNum(tok);
  return v == null ? null : neg ? -v : v;
}

/**
 * Which number column is the current year? Notes tables print
 * "March 31, 2026 March 31, 2025" (current first); division tables print
 * "FY25 FY26" (current second). Detect from year headers ≤8 lines above.
 * Returns 0 (current = nums[0]) or 1 (current = nums[1]).
 */
function colOrder(lines: string[], blockStart: number): 0 | 1 {
  for (let i = Math.max(0, blockStart - 8); i < blockStart; i++) {
    const yrs: number[] = [];
    for (const m of lines[i].matchAll(/(?:FY\s?)?((?:19|20)\d{2})/gi)) {
      let y = Number(m[1]);
      if (m[0].toUpperCase().startsWith('FY') && y < 100) y += 2000;
      if (m[0].toUpperCase().startsWith('FY') && y < 2000) y += 2000;
      yrs.push(y);
    }
    // FY25 style (2-digit)
    for (const m of lines[i].matchAll(/FY\s?(\d{2})\b/gi)) yrs.push(2000 + Number(m[1]));
    if (yrs.length >= 2) return yrs[0] > yrs[1] ? 0 : 1;
    if (yrs.length === 1) return 0;
  }
  return 0;
}

/**
 * Revenue geography split from the Ind AS 108 disaggregation note
 * ("Within India X / Outside India Y" + Total). Picks the pairing whose
 * parts sum exactly to a stated total (largest total wins = consolidated).
 */
function mineRevenueGeo(text: string): { label: string; pct: number }[] | null {
  const lines = text.split(/\n+/).map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => l.length > 0);
  // Split a glued digit run ("89,98570,898") into current/previous-year pair
  // by trying every split where both sides are clean standalone numbers.
  const splitPair = (run: string): [number, number][] => {
    const out: [number, number][] = [];
    const s = run.replace(/\s+/g, '');
    for (let k = 1; k < s.length; k++) {
      const a = signedNum(s.slice(0, k));
      const b = signedNum(s.slice(k));
      if (a != null && b != null) out.push([a, b]);
    }
    return out;
  };
  const numRun = (line: string, label: RegExp): [number, number][] => {
    const m = line.match(label);
    if (!m) return [];
    const run = line.slice(m[0].length).match(/^[(),\d.\s]+/);
    if (!run) return [];
    return splitPair(run[0]);
  };
  // A total line is either labeled ("Total ...") or a bare number pair
  // ("121,00598,503") — disaggregated-revenue blocks often print the total
  // as bare numbers. Bare lines must yield exactly one valid pair.
  const totalPairs = (line: string): [number, number][] => {
    const labeled = numRun(line, /^Total\s*/i);
    if (labeled.length) return labeled;
    if (/[a-zA-Z]/.test(line)) return [];
    const run = line.match(/^[(),\d.\s]+/);
    if (!run) return [];
    const s = run[0].replace(/\s+/g, '');
    const out: [number, number][] = [];
    for (let k = 1; k < s.length; k++) {
      const a = signedNum(s.slice(0, k));
      const b = signedNum(s.slice(k));
      if (a != null && b != null) out.push([a, b]);
    }
    return out.length === 1 ? out : [];
  };
  interface Geo { a: number; b: number; total: number; la: string; lb: string }
  const cands: Geo[] = [];
  const DBG = process.env.DEPS_DEBUG_GEO === '1';
  // complementary geo label pairs (different companies word it differently)
  const PAIRS: { a: RegExp; b: RegExp; la: string; lb: string }[] = [
    { a: /^Within India\s*/i, b: /^Outside India\s*/i, la: 'Within India', lb: 'Outside India' },
    { a: /^Exports?\s*/i, b: /^Other than exports\s*/i, la: 'Exports', lb: 'Domestic (other than exports)' },
    { a: /^Domestic\s*/i, b: /^Exports?\s*/i, la: 'Domestic', lb: 'Exports' },
    { a: /^India\s*/i, b: /^Outside India\s*/i, la: 'India', lb: 'Outside India' },
  ];
  for (let i = 0; i < lines.length; i++) {
    if (!/disaggregation/i.test(lines[i])) continue;
    if (DBG) console.log(`GEO header L${i}: ${lines[i].slice(0, 80)}`);
    const c = colOrder(lines, i);
    if (DBG) console.log(`GEO colOrder=${c}`);
    for (const P of PAIRS) {
      for (let j = i + 1; j < Math.min(i + 25, lines.length); j++) {
        const wp = numRun(lines[j], P.a);
        if (!wp.length) continue;
        const op = j + 1 < lines.length ? numRun(lines[j + 1], P.b) : [];
        if (!op.length) continue;
        for (let k = j + 2; k < Math.min(j + 7, lines.length); k++) {
          const tp = totalPairs(lines[k]);
          if (!tp.length) continue;
          // anchor: find the (a, b, t) triple whose parts sum to the total
          let bestErr = Infinity;
          let best: Geo | null = null;
          for (const [wa, wb] of wp) {
            for (const [oa, ob] of op) {
              for (const [ta, tb] of tp) {
                const wv = c === 0 ? wa : wb;
                const ov = c === 0 ? oa : ob;
                const tv = c === 0 ? ta : tb;
                if (!(wv > 0) || !(ov >= 0) || !(tv > 0)) continue;
                const err = Math.abs(wv + ov - tv);
                if (err < bestErr) { bestErr = err; best = { a: wv, b: ov, total: tv, la: P.la, lb: P.lb }; }
              }
            }
          }
          if (best && bestErr <= Math.max(2, best.total * 0.005)) cands.push(best);
          break;
        }
      }
    }
  }
  if (!cands.length) return null;
  cands.sort((a, b) => b.total - a.total);
  const g = cands[0];
  return [
    { label: g.la, pct: Math.round((g.a / g.total) * 1000) / 10 },
    { label: g.lb, pct: Math.round((g.b / g.total) * 1000) / 10 },
  ];
}

const FACTOR_MAP: [RegExp, string][] = [
  [/crude|petroleum product|atf\b/i, 'Crude oil prices'],
  [/steel|iron ore|metal prices|aluminium|aluminum/i, 'Steel & metal prices'],
  [/forex|\bdollar\b|USD\b|\bINR\b|currency|exchange rate|\brupee\b/i, 'USD-INR / forex'],
  [/interest rate|borrowing cost|\brepo\b|rate hike|rate cut/i, 'Interest rates'],
  [/monsoon|rainfall/i, 'Monsoon'],
  [/tariff|customs duty|anti-dumping/i, 'Trade tariffs'],
  [/regulat|subsidy|government policy/i, 'Regulation & policy'],
  [/competit|market share|pricing pressure/i, 'Competition'],
  [/\bdemand\b|cyclical|slowdown|downturn/i, 'Demand cyclicality'],
  [/commodity|raw material|input cost/i, 'Input costs'],
  [/inflation|cost inflation|margin pressure/i, 'Cost inflation'],
  [/npa|default|delinquen|credit cost|provisioning/i, 'Asset quality'],
  [/claims? experience|underwriting|combined ratio/i, 'Claims experience'],
  [/freight|logistic|shipping/i, 'Freight & logistics'],
];
const RISK_MARKERS = /offset by|constrained by|exposed to|exposure to|sensitive to|sensitivity|volatile|volatility|vulnerable|susceptible|threat|at risk|headwind|monitorable|cyclical|downturn|slowdown|adverse|pressure|uncertain|depends on|dependence on/i;
const FACTOR_BOILER = /does not create|rating committee|analytical approach|methodology|criteria|chartered accountant|auditor|thank you|good morning|register|login|page \d+ of/i;

/**
 * Price factors: what can move the stock, stated in rating-rationale
 * offset clauses and AR risk narratives. Sentence must carry BOTH a risk
 * marker and a factor noun; every factor ships its verbatim evidence.
 */
function mineFactors(text: string, source: string): { label: string; evidence: string; source: string }[] {
  const out: { label: string; evidence: string; source: string }[] = [];
  const seen = new Set<string>();
  for (const sent of sentences(text.replace(/\s+/g, ' '))) {
    if (sent.length > 600 || FACTOR_BOILER.test(sent)) continue;
    const mk = RISK_MARKERS.exec(sent);
    if (!mk || mk.index == null) continue;
    for (const [re, label] of FACTOR_MAP) {
      const fm = re.exec(sent);
      // factor noun must sit near the risk marker — distant co-occurrence
      // in long sentences is how the false positives happened
      if (!fm || fm.index == null || Math.abs(fm.index - mk.index) > 200) continue;
      if (seen.has(label)) break;
      seen.add(label);
      const at = Math.max(0, Math.min(fm.index, mk.index) - 60);
      out.push({ label, evidence: sent.slice(at, at + 220).trim(), source });
      break;
    }
    if (out.length >= 6) break;
  }
  return out;
}

const SCHED_LABELS: [RegExp, string][] = [
  [/material cost/i, 'Raw materials'],
  [/manufacturing cost/i, 'Manufacturing'],
  [/employee cost/i, 'Employee costs'],
  [/other cost/i, 'Other costs'],
];

/**
 * Cost split from Screener's P&L expense schedules
 * (/api/company/{id}/schedules/?parent=Expenses&section=profit-loss):
 * clean "% of sales" buckets, consolidated preferred, standalone fallback.
 * One cheap JSON fetch — no PDF parsing, no glued-number hazards.
 */
async function fetchCostSchedule(companyId: string): Promise<{ label: string; pct: number }[] | null> {
  for (const scope of ['&consolidated=', '']) {
    try {
      const res = await fetch(
        `https://www.screener.in/api/company/${companyId}/schedules/?parent=Expenses&section=profit-loss${scope}`,
        {
          headers: { 'User-Agent': UA, Accept: '*/*', 'X-Requested-With': 'XMLHttpRequest' },
          signal: AbortSignal.timeout(20000),
        },
      );
      if (!res.ok) continue;
      const j = (await res.json()) as Record<string, Record<string, string>>;
      const years = Object.values(j)
        .flatMap((v) => Object.keys(v ?? {}))
        .filter((k) => /^Mar (19|20)\d\d$/.test(k))
        .sort();
      if (!years.length) continue;
      const latest = years[years.length - 1];
      const out: { label: string; pct: number }[] = [];
      for (const [rawLabel, vals] of Object.entries(j)) {
        const v = Number(String(vals?.[latest] ?? '').replace(/%/g, '').trim());
        if (!isFinite(v) || v < 0.5 || v > 100) continue;
        const mapped = SCHED_LABELS.find(([re]) => re.test(rawLabel));
        out.push({ label: mapped ? mapped[1] : rawLabel.replace(/\s*%\s*$/, '').trim().slice(0, 40), pct: Math.round(v * 10) / 10 });
        if (out.length >= 8) break;
      }
      if (out.length >= 2) return out;
    } catch { /* try next scope */ }
  }
  return null;
}

/**
 * Schedules endpoint with patient retries: it runs amid a burst of PDF
 * downloads per symbol, so transient rate-limits are retried with backoff
 * instead of silently dropping the cost split.
 */
async function fetchCostScheduleRetry(companyId: string, symbol: string): Promise<{ label: string; pct: number }[] | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 2000 * attempt));
    try {
      const out = await fetchCostSchedule(companyId);
      if (out) return out;
    } catch { /* retry */ }
  }
  console.log(`deps: ${symbol} cost-schedule unavailable after retries`);
  return null;
}

// ---- screener document discovery -----------------------------------------------------

interface Docs {
  ar: { url: string; label: string } | null;
  rationale: { url: string; label: string }[];
  transcript: { url: string; label: string } | null;
  ppt: { url: string; label: string } | null;
  about: { text: string; highlights: string[] } | null;
  companyId: string | null;
}

async function discoverDocs(symbol: string): Promise<Docs> {
  const html = await fetchText(`https://www.screener.in/company/${encodeURIComponent(symbol)}/`);
  const out: Docs = {
    ar: null, rationale: [], transcript: null, ppt: null,
    about: mineAbout(html),
    companyId: (html.match(/data-company-id="(\d+)"/) ?? [])[1] ?? null,
  };
  const arIdx = html.indexOf('documents annual-reports');
  if (arIdx >= 0) {
    const sec = html.slice(arIdx, arIdx + 6000);
    const arM = sec.match(/href="([^"]+\.pdf[^"]*)"[^>]*>\s*Annual Report (\d{4})/);
    if (arM) out.ar = { url: arM[1], label: `Annual Report ${arM[2]}` };
  }
  for (const mm of html.matchAll(/href="(https:\/\/(?:www\.crisil\.com|www\.icra\.in|www\.careratings\.com|www\.indiaratings\.co\.in)[^"]+?)(?:"|>)/g)) {
    const url = mm[1];
    if (/\.(pdf|html)/i.test(url) || /RatingDocs/i.test(url)) {
      const mon = (url.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*/i) ?? [])[1] ?? null;
      const yr = (url.match(/((?:19|20)\d{2})/) ?? [])[1] ?? null;
      const agency = url.includes('crisil') ? 'CRISIL' : url.includes('icra') ? 'ICRA' : url.includes('careratings') ? 'CARE' : 'India Ratings';
      out.rationale.push({ url, label: `${agency} rationale${mon ? ` ${mon.slice(0, 3)}-${yr ? yr.slice(-2) : ''}`.replace(/-$/, '') : ''}` });
      if (out.rationale.length >= 2) break;
    }
  }
  const ccIdx = html.indexOf('documents concalls');
  if (ccIdx >= 0) {
    const sec = html.slice(ccIdx, ccIdx + 9000);
    const period = (sec.match(/(\w{3} 20\d{2})<\/div>/) ?? [])[1] ?? null;
    const tr = sec.match(/href="([^"]+\.pdf[^"]*)"[^>]*>\s*Transcript/);
    if (tr) out.transcript = { url: tr[1], label: period ? `Concall transcript ${period}` : 'Concall transcript' };
    const ppt = sec.match(/href="([^"]+\.pdf[^"]*)"[^>]*>\s*PPT/);
    if (ppt) out.ppt = { url: ppt[1], label: period ? `Investor presentation ${period}` : 'Investor presentation' };
  }
  return out;
}

// ---- rank / sanitize / reverse graph -----------------------------------------

function rowScore(r: DepRow): number {
  let s = 0;
  if (r.share) s += 1000 + r.share;
  if (r.amount && r.amount > 0) s += Math.min(200, Math.log10(r.amount + 1) * 20);
  if (r.symbol) s += 80;
  if (r.basis === 'disclosed-report') s += 40;
  if (r.basis === 'disclosed-rpt') s += 25;
  if (r.basis === 'inferred-reverse') s += 20;
  return s;
}

function rankDedupe(rows: DepRow[], note: string | null): { suppliers: DepRow[]; customers: DepRow[]; note: string | null } {
  const facts = rows.filter((r) => r.basis === 'disclosed-fact');
  const pickedNote = note
    ?? (facts[0] ? 'No single customer contributes a material share of revenue — the book is diversified.' : null);
  const pick = (side: 'supplier' | 'customer'): DepRow[] => {
    const named = rows.filter((r) => r.side === side && r.basis !== 'disclosed-fact');
    named.sort((a, b) => rowScore(b) - rowScore(a));
    const seen = new Set<string>();
    const out: DepRow[] = [];
    for (const r of named) {
      const k = `${r.symbol ?? ''}|${normName(r.name)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(r);
      if (out.length >= 8) break;
    }
    return out;
  };
  return { suppliers: pick('supplier'), customers: pick('customer'), note: pickedNote };
}

function sanitizeRow(r: DepRow, selfSym: string, selfName: string): DepRow | null {
  if (r.basis === 'disclosed-fact' || /diversified customer/i.test(r.name)) {
    return {
      ...r,
      name: 'Diversified customer base (no single large customer)',
      symbol: null,
      side: 'customer',
      basis: 'disclosed-fact',
      via: null,
    };
  }
  if (r.basis === 'inferred-reverse') {
    if (!r.symbol || r.symbol === selfSym) return null;
    const co = BY_SYM.get(r.symbol);
    return {
      ...r,
      name: co?.name ?? r.name,
      symbol: r.symbol,
      amount: r.amount ?? parseAmount(r.evidence),
      share: r.share ?? parseShare(r.evidence),
    };
  }
  if (r.basis === 'disclosed-report' && r.evidence) {
    const inferred = sideFromSentence(r.evidence.toLowerCase(), selfSym);
    if (inferred) r = { ...r, side: inferred };
  }
  const name = cleanDisplayName(r.name);
  if (!name) return null;
  let listed = (r.basis === 'disclosed-rpt' ? resolveByName(name, selfSym, true) : resolveByName(name, selfSym))
    ?? (r.symbol && r.basis !== 'disclosed-report' ? BY_SYM.get(r.symbol) ?? null : null);
  if (listed && listed.symbol === selfSym) return null;
  if (listed && !evidenceSupports(listed, r.evidence)) {
    if (r.basis === 'disclosed-report') return null;
    listed = null;
  }
  if (isIntraGroupUnlisted(name, selfName, listed, selfSym)) return null;
  if (!listed && isGarbageName(name)) return null;
  const amount = r.amount ?? parseAmount(r.evidence);
  const share = r.share ?? parseShare(r.evidence);
  return {
    ...r,
    name: listed ? listed.name : name,
    symbol: listed ? listed.symbol : null,
    amount,
    share,
    via: r.via ?? null,
  };
}

function sanitizeEntry(entry: DepEntry, selfSym: string, selfName: string): DepEntry {
  const cleaned = [...entry.suppliers, ...entry.customers]
    .map((r) => sanitizeRow(r, selfSym, selfName))
    .filter((r): r is DepRow => r != null);
  const ranked = rankDedupe(cleaned, entry.note ?? null);
  return {
    ...entry,
    suppliers: ranked.suppliers,
    customers: ranked.customers,
    note: ranked.note,
    engineVersion: entry.engineVersion,
  };
}

function applyReverseGraph(data: Record<string, DepEntry>, names: Map<string, string>): void {
  const additions: { sym: string; row: DepRow }[] = [];
  for (const [sym, entry] of Object.entries(data)) {
    const selfName = names.get(sym) ?? entry.suppliers[0]?.via?.name ?? sym;
    for (const r of [...entry.suppliers, ...entry.customers]) {
      if (!r.symbol || r.symbol === sym) continue;
      if (r.basis === 'disclosed-fact' || r.basis === 'inferred-reverse') continue;
      const opposite: 'supplier' | 'customer' = r.side === 'customer' ? 'supplier' : 'customer';
      additions.push({
        sym: r.symbol,
        row: {
          name: selfName,
          symbol: sym,
          side: opposite,
          evidence: `Named as ${r.side} in ${sym}'s ${r.source}`,
          source: `${sym} · ${r.source}`,
          basis: 'inferred-reverse',
          amount: r.amount ?? null,
          share: r.share ?? null,
          via: { symbol: sym, name: selfName },
        },
      });
    }
  }
  for (const { sym, row } of additions) {
    const cur = data[sym] ?? {
      suppliers: [],
      customers: [],
      sources: [],
      checkedAt: '',
      note: null,
      engineVersion: ENGINE_VERSION,
      about: null,
      costSplit: null,
      revenueGeo: null,
      factors: [],
    };
    const bucket = row.side === 'supplier' ? cur.suppliers : cur.customers;
    const key = `${row.symbol}|${row.side}`;
    if (bucket.some((x) => x.symbol === row.symbol && x.side === row.side)) continue;
    if (bucket.some((x) => `${x.symbol}|${x.side}` === key)) continue;
    bucket.push(row);
    data[sym] = cur;
  }
  for (const [sym, entry] of Object.entries(data)) {
    const name = names.get(sym) ?? sym;
    data[sym] = sanitizeEntry(entry, sym, name);
  }
}

// ---- per-symbol pipeline ---------------------------------------------------------------

async function processSymbol(symbol: string, selfName: string): Promise<DepEntry> {
  const suppliers: DepRow[] = [];
  const customers: DepRow[] = [];
  const sources: { label: string; url: string }[] = [];
  const push = (rows: DepRow[]) => {
    for (const r of rows) (r.side === 'supplier' ? suppliers : customers).push(r);
  };

  let docs: Docs | null = null;
  try {
    docs = await discoverDocs(symbol);
  } catch {
    return { suppliers: [], customers: [], sources: [], checkedAt: new Date().toISOString(), note: null, engineVersion: ENGINE_VERSION, about: null, costSplit: null, revenueGeo: null, factors: [] };
  }
  const about = docs.about;
  const factors: { label: string; evidence: string; source: string }[] = [];
  // Cost split via Screener expense schedules (clean % of sales, no PDF glue)
  let costSplit: { label: string; pct: number }[] | null = null;
  if (docs.companyId) {
    costSplit = await fetchCostScheduleRetry(docs.companyId, symbol);
  }
  let revenueGeo: { label: string; pct: number }[] | null = null;

  for (const r of docs.rationale) {
    const html = await tryOnce(() => fetchText(r.url));
    if (!html) continue;
    sources.push({ label: r.label, url: r.url });
    const clean = cleanHtml(html);
    push(mineSentences(clean, r.label, symbol));
    factors.push(...mineFactors(clean, r.label));
  }
  if (docs.ar) {
    const pdf = await tryOnce(() => fetchPdfText(docs.ar!.url));
    if (pdf) {
      sources.push({ label: docs.ar.label, url: docs.ar.url });
      push(mineRPT(pdf.text, docs.ar.label, symbol, selfName));
      push(mineSentences(pdf.text, docs.ar.label, symbol));
      revenueGeo = mineRevenueGeo(pdf.text);
      factors.push(...mineFactors(pdf.text, docs.ar.label));
    }
  }
  for (const doc of [docs.transcript, docs.ppt]) {
    if (!doc) continue;
    const pdf = await tryOnce(() => fetchPdfText(doc.url));
    if (!pdf) continue;
    sources.push({ label: doc.label, url: doc.url });
    push(mineSentences(pdf.text, doc.label, symbol));
  }

  const ranked = rankDedupe([...suppliers, ...customers], null);
  // cross-source factor dedupe (same factor stated in rationale + AR):
  // keep the first occurrence, cap at six
  const seenFactors = new Set<string>();
  const uniqFactors = factors.filter((f) => {
    if (seenFactors.has(f.label)) return false;
    seenFactors.add(f.label);
    return true;
  }).slice(0, 6);
  return {
    suppliers: ranked.suppliers,
    customers: ranked.customers,
    sources,
    checkedAt: new Date().toISOString(),
    note: ranked.note,
    engineVersion: ENGINE_VERSION,
    about,
    costSplit,
    revenueGeo,
    factors: uniqFactors,
  };
}

// ---- main ----------------------------------------------------------------------------------

function loadStore(): StoreFile | null {
  if (!existsSync(OUT_FILE)) return null;
  try {
    const raw = JSON.parse(readFileSync(OUT_FILE, 'utf8')) as StoreFile;
    if (!raw || typeof raw !== 'object' || !raw.data) return null;
    return raw;
  } catch {
    return null;
  }
}

function loadUniverseFile(): { symbol: string; name: string }[] {
  if (!existsSync(UNIVERSE_FILE)) return [];
  try {
    const raw = JSON.parse(readFileSync(UNIVERSE_FILE, 'utf8')) as { stocks?: { symbol: string; name: string }[] };
    return (raw.stocks ?? []).filter((s) => s.symbol && s.name);
  } catch {
    return [];
  }
}

async function fillMissingMcaps(entries: { symbol: string; marketCap: number }[]): Promise<void> {
  const missing = entries.filter((e) => !(e.marketCap > 0));
  if (!missing.length) return;
  let cursor = 0;
  const worker = async () => {
    while (true) {
      const idx = cursor;
      cursor += 1;
      if (idx >= missing.length) return;
      const e = missing[idx];
      try {
        const html = await fetchText(`https://www.screener.in/company/${encodeURIComponent(e.symbol)}/`);
        const m = html.match(/Market Cap\s*<\/span>\s*<span[^>]*>\s*₹\s*<span class="number">([\d,]+)<\/span>\s*Cr/i);
        if (m) {
          const cr = Number(m[1].replace(/,/g, ''));
          if (cr > 0) {
            e.marketCap = cr * 1e7;
            console.log(`deps: mcap fill ${e.symbol} = ${cr.toLocaleString('en-IN')} cr`);
          }
        }
      } catch { /* stays 0 */ }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, missing.length) }, worker));
}

function listedCount(e: DepEntry): number {
  return [...e.suppliers, ...e.customers].filter((r) => r.symbol && r.basis !== 'disclosed-fact').length;
}

function saveStore(data: Record<string, DepEntry>, coveredLen: number): void {
  const coverage = Object.values(data).filter((d) => d.suppliers.length + d.customers.length > 0).length;
  mkdirSync(join(process.cwd(), 'frontend', 'public'), { recursive: true });
  const out: StoreFile = {
    generatedAt: new Date().toISOString(),
    thresholdCr: 5000,
    universe: coveredLen,
    coverage,
    engineVersion: ENGINE_VERSION,
    data,
  };
  writeFileSync(OUT_FILE, JSON.stringify(out));
}

async function main(): Promise<void> {
  const analysis = JSON.parse(readFileSync(ANALYSIS_FILE, 'utf8')) as {
    stocks: Record<string, { symbol: string; name: string | null; marketCap: number | null }>;
  };
  const analysisEntries = Object.values(analysis.stocks).map((s) => ({
    symbol: s.symbol, name: s.name ?? s.symbol, marketCap: s.marketCap ?? 0,
  }));
  if (PER_RUN > 0 || ONLY.length) await fillMissingMcaps(analysisEntries);

  const analysisSyms = new Set(analysisEntries.map((e) => e.symbol));
  const uni = loadUniverseFile();
  const merged = new Map<string, { symbol: string; name: string }>();
  for (const u of uni) merged.set(u.symbol, u);
  for (const e of analysisEntries) merged.set(e.symbol, { symbol: e.symbol, name: e.name });
  buildIndexes([...merged.values()], analysisSyms);

  const names = new Map<string, string>();
  for (const e of merged.values()) names.set(e.symbol, e.name);

  const covered = analysisEntries.filter((e) => e.marketCap > THRESHOLD);
  console.log(`deps: universe ${analysisEntries.length} · listed-index ${UNIVERSE.length} · covered(mcap>5000cr) ${covered.length}`);

  const prev = loadStore();
  const data: Record<string, DepEntry> = { ...(prev?.data ?? {}) };

  // Drop previous reverse edges and rebuild from cleaned disclosed rows so
  // a side-correction never compounds an inverted link.
  for (const entry of Object.values(data)) {
    entry.suppliers = entry.suppliers.filter((r) => r.basis !== 'inferred-reverse');
    entry.customers = entry.customers.filter((r) => r.basis !== 'inferred-reverse');
  }
  for (const [sym, entry] of Object.entries(data)) {
    data[sym] = sanitizeEntry(entry, sym, names.get(sym) ?? sym);
  }

  const staleCutoff = Date.now() - STALE_DAYS * 86_400_000;

  const needsFetch = (c: { symbol: string; marketCap: number }): boolean => {
    const old = data[c.symbol];
    if (!old || !old.checkedAt) return true;
    if (new Date(old.checkedAt).getTime() < staleCutoff) return true;
    if ((old.engineVersion ?? 0) < ENGINE_VERSION) return true;
    return false;
  };

  let todo = covered.filter(needsFetch);
  todo.sort((a, b) => {
    const ea = data[a.symbol];
    const eb = data[b.symbol];
    const emptyA = listedCount(ea ?? { suppliers: [], customers: [], sources: [], checkedAt: '' }) === 0 ? 0 : 1;
    const emptyB = listedCount(eb ?? { suppliers: [], customers: [], sources: [], checkedAt: '' }) === 0 ? 0 : 1;
    if (emptyA !== emptyB) return emptyA - emptyB;
    const ta = ea?.checkedAt ? new Date(ea.checkedAt).getTime() : 0;
    const tb = eb?.checkedAt ? new Date(eb.checkedAt).getTime() : 0;
    if (ta !== tb) return ta - tb;
    return b.marketCap - a.marketCap;
  });
  if (ONLY.length) todo = covered.filter((c) => ONLY.includes(c.symbol));
  else todo = todo.slice(0, PER_RUN);
  console.log(`deps: fetching ${todo.length} symbols (${ONLY.length ? 'targeted' : `oldest-first, empty first, cap ${PER_RUN}`})`);

  let cursor = 0;
  let withRows = 0;
  let savedAt = 0;
  const worker = async () => {
    while (true) {
      const idx = cursor;
      cursor += 1;
      if (idx >= todo.length) return;
      const c = todo[idx];
      try {
        const entry = await processSymbol(c.symbol, c.name);
        const n = entry.suppliers.length + entry.customers.length;
        if (entry.sources.length === 0) {
          const kept = data[c.symbol];
          console.log(`deps: ${c.symbol} ALL FETCHES FAILED — ${kept ? 'keeping previous entry' : 'no previous entry'}`);
          continue;
        }
        data[c.symbol] = sanitizeEntry(entry, c.symbol, c.name);
        if (n > 0) withRows += 1;
        console.log(`deps: ${c.symbol} ${entry.suppliers.length}S/${entry.customers.length}C src=[${entry.sources.map((s) => s.label).join(', ')}]`);
        if (cursor - savedAt >= 25) {
          savedAt = cursor;
          saveStore(data, covered.length);
          console.log(`deps: checkpoint saved (${cursor}/${todo.length})`);
        }
      } catch (e) {
        console.log(`deps: ${c.symbol} FAILED ${e instanceof Error ? e.message.slice(0, 80) : e}`);
      }
    }
  };
  if (todo.length) {
    await Promise.all(Array.from({ length: Math.min(POOL_SIZE, Math.max(todo.length, 1)) }, worker));
  }

  applyReverseGraph(data, names);
  for (const [sym, entry] of Object.entries(data)) {
    if (!entry.checkedAt && entry.suppliers.length + entry.customers.length === 0) delete data[sym];
  }
  saveStore(data, covered.length);
  const coverage = Object.values(data).filter((d) => d.suppliers.length + d.customers.length > 0).length;
  const listed = Object.values(data).filter((d) => listedCount(d) > 0).length;
  console.log(`deps: done · ${todo.length} fetched · ${withRows} with rows this run · coverage ${coverage}/${covered.length} · listed-links ${listed}`);
}

main().catch((e) => {
  console.error('deps failed:', e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
