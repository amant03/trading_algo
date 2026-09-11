// Shared fundamentals + analyst model engine.
//
// Pure, dependency-free TS used by THREE runtimes:
//   - scripts/ci/fundamentals.ts  (nightly batch, DB-rich)
//   - frontend/api/funda.ts       (on-demand relay, any symbol)
//   - (built into the static bundle nowhere — this file has no DOM/Vite deps)
//
// It captures the exact Yahoo quoteSummary -> metric -> screen -> verdict ->
// opinion pipeline and writes/returns the same shape that `analysis.json`
// exposes to the UI, so on-demand entries are drop-in compatible with the
// nightly batch entries.

export interface Metrics {
  symbol: string;
  name: string | null;
  sector: string | null;
  industry: string | null;
  price: number;
  marketCap: number | null;
  pe: number | null;
  pb: number | null;
  ps: number | null;
  peg: number | null;
  roe: number | null;
  roce: number | null;
  roa: number | null;
  netMargin: number | null;
  operatingMargin: number | null;
  grossMargin: number | null;
  revenueGrowth: number | null;
  earningsGrowth: number | null;
  growth: number | null;
  debtToEquity: number | null;
  currentRatio: number | null;
  quickRatio: number | null;
  dividendYield: number | null;
  eps: number | null;
  bookValue: number | null;
  beta: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  avgVolume: number | null;
  promoterHolding: number | null;
  fiiHolding: number | null;
  targetLow: number | null;
  targetMean: number | null;
  targetHigh: number | null;
  analysts: number | null;
  description: string | null;
}

export interface Screen {
  score: number;
  grade: string;
  thesis: string;
  flags: string[];
}

export interface Opinion {
  horizon: 'lt';
  stance: 'BUY' | 'HOLD' | 'SELL';
  conviction: number;
  thesis: string;
  risks: string[];
}

export interface Verdict {
  score: number;
  grade: string;
  rating: 'Strong Buy' | 'Buy' | 'Hold' | 'Sell' | 'Strong Sell';
  fairValueMid: number;
  fairValueLow: number;
  fairValueHigh: number;
  marginOfSafety: number;
  targetMean: number | null;
  analysts: number | null;
  summary: string;
}

export interface EntryPeer {
  symbol: string;
  name: string | null;
  industry: string | null;
  sector: string | null;
}

export interface EntryReportLink {
  label: string;
  url: string;
  kind: 'financials' | 'search';
}

export interface EntryReportGroup {
  label: string;
  period: string | null;
  links: EntryReportLink[];
}

export interface EntryReports {
  quarterly: EntryReportGroup;
  annual: EntryReportGroup;
}

export interface AnalysisEntry {
  symbol: string;
  name: string | null;
  sector: string | null;
  industry: string | null;
  description: string | null;
  price: number;
  marketCap: number | null;
  metrics: Record<string, number | null>;
  financials?: ScreenerFundamentals | null;
  screens: { buffett: Screen; lynch: Screen; graham: Screen };
  management: null;
  peers: EntryPeer[];
  reports: EntryReports | null;
  opinion: Opinion;
  verdict: Verdict;
}

// ---- shared helpers ------------------------------------------------------

const num = (v: unknown): number | null => {
  if (typeof v === 'number' && isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && isFinite(Number(v))) return Number(v);
  return null;
};

export function gradeFor(score: number): string {
  if (score >= 80) return 'A+';
  if (score >= 72) return 'A';
  if (score >= 64) return 'A-';
  if (score >= 56) return 'B+';
  if (score >= 48) return 'B';
  if (score >= 40) return 'B-';
  if (score >= 32) return 'C+';
  return 'C';
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

// ---- Yahoo quoteSummary (crumb cookie dance) -----------------------------

export interface YahooClient {
  quoteSummary: (symbol: string) => Promise<Record<string, any> | null>;
  ok: boolean;
}

export async function makeYahoo(): Promise<YahooClient> {
  try {
    const cookieRes = await fetch('https://fc.yahoo.com', {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(12_000),
    });
    const cookies = (cookieRes.headers.get('set-cookie') ?? '')
      .split(/,(?=\s*\w+=\w)/)
      .map((c) => c.split(';')[0].trim())
      .filter(Boolean);
    const jar = cookies.join('; ');
    const crumbRes = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
      headers: { 'User-Agent': UA, Cookie: jar },
      signal: AbortSignal.timeout(12_000),
    });
    if (!crumbRes.ok) return { quoteSummary: async () => null, ok: false };
    const crumb = (await crumbRes.text()).trim();
    if (!crumb || crumb.length > 64) return { quoteSummary: async () => null, ok: false };
    const quoteSummary = async (symbol: string): Promise<Record<string, any> | null> => {
      try {
        const url =
          `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}` +
          `?modules=price,summaryDetail,defaultKeyStatistics,financialData,summaryProfile,earnings,esgScores&crumb=${encodeURIComponent(crumb)}&formatted=false`;
        const res = await fetch(url, {
          headers: { 'User-Agent': UA, Cookie: jar },
          signal: AbortSignal.timeout(12_000),
        });
        if (!res.ok) return null;
        return (await res.json()) as Record<string, any>;
      } catch {
        return null;
      }
    };
    return { quoteSummary, ok: true };
  } catch {
    return { quoteSummary: async () => null, ok: false };
  }
}

export function emptyMetrics(symbol: string, meta?: Partial<Pick<Metrics, 'name' | 'sector' | 'industry' | 'price'>>): Metrics {
  const price = Number(meta?.price ?? 0);
  return {
    symbol,
    name: meta?.name ?? null,
    sector: meta?.sector ?? null,
    industry: meta?.industry ?? null,
    price,
    marketCap: null,
    pe: null,
    pb: null,
    ps: null,
    peg: null,
    roe: null,
    roce: null,
    roa: null,
    netMargin: null,
    operatingMargin: null,
    grossMargin: null,
    revenueGrowth: null,
    earningsGrowth: null,
    growth: null,
    debtToEquity: null,
    currentRatio: null,
    quickRatio: null,
    dividendYield: null,
    eps: null,
    bookValue: null,
    beta: null,
    fiftyTwoWeekHigh: null,
    fiftyTwoWeekLow: null,
    avgVolume: null,
    promoterHolding: null,
    fiiHolding: null,
    targetLow: null,
    targetMean: null,
    targetHigh: null,
    analysts: null,
    description: null,
  };
}

/** Apply Yahoo quoteSummary fields onto a Metrics object (in place). */
export function applyYahoo(m: Metrics, y: Record<string, any> | null): { updated: string[] } {
  const touched: string[] = [];
  if (!y?.quoteSummary?.result?.[0]) return { updated: touched };
  const r = y.quoteSummary.result[0];
  const sd = r.summaryDetail ?? {};
  const ks = r.defaultKeyStatistics ?? {};
  const fd = r.financialData ?? {};
  const sp = r.summaryProfile ?? {};
  const price = r.price ?? {};
  const pct = (v: unknown) => (num(v) == null ? null : num(v)! * 100);
  const pctRaw = (v: unknown) => (num(v) == null ? null : num(v)); // some fields already in %
  const set = (k: keyof Metrics, v: number | string | null) => {
    if (v != null && v !== '') {
      (m[k] as number | string | null) = v;
      touched.push(k);
    }
  };

  const livePrice = num(price.regularMarketPrice);
  if (livePrice != null && livePrice > 0) {
    m.price = livePrice;
    touched.push('price');
  }
  set('marketCap', num(price.marketCap ?? sd.marketCap));
  set('pe', sd.trailingPE != null ? num(sd.trailingPE) : null);
  set('ps', num(sd.priceToSalesTrailing12Months));
  const pb = num(sd.priceToBook);
  set('pb', pb);
  set('beta', num(sd.beta));
  set('fiftyTwoWeekHigh', num(sd.fiftyTwoWeekHigh));
  set('fiftyTwoWeekLow', num(sd.fiftyTwoWeekLow));
  if (num(sd.averageVolume) != null) set('avgVolume', num(sd.averageVolume)!);
  set('dividendYield', pct(sd.dividendYield));
  set('roe', pct(ks.returnOnEquity ?? fd.returnOnEquity));
  set('roa', pct(ks.returnOnAssets ?? fd.returnOnAssets));
  set('netMargin', pct(ks.profitMargins));
  set('eps', num(ks.trailingEps));
  set('bookValue', num(ks.bookValue));
  set('debtToEquity', num(ks.debtToEquity));
  set('currentRatio', num(ks.currentRatio));
  set('quickRatio', num(ks.quickRatio));
  set('revenueGrowth', pct(fd.revenueGrowth ?? ks.revenueGrowth));
  set('earningsGrowth', pct(fd.earningsGrowth ?? ks.earningsGrowth));
  set('grossMargin', pct(fd.grossMargins));
  set('operatingMargin', pct(fd.operatingMargins));
  set('peg', num(fd.pegRatio ?? ks.trailingPegRatio));
  set('targetLow', num(fd.targetLowPrice));
  set('targetMean', num(fd.targetMeanPrice));
  set('targetHigh', num(fd.targetHighPrice));
  set('analysts', num(fd.numberOfAnalystOpinions));
  set('description', sp.longBusinessSummary ?? null);
  if (typeof sp.sector === 'string') set('sector', sp.sector);
  if (typeof sp.industry === 'string') set('industry', sp.industry);
  set('promoterHolding', pctRaw(ks.heldPercentInsiders));
  set('fiiHolding', pctRaw(ks.heldPercentInstitutions));

  // fill gaps with derived values
  if (m.bookValue != null && m.bookValue > 0 && m.price > 0 && m.pb == null) {
    set('pb', m.price / m.bookValue);
    touched.push('pb(derived)');
  }
  if (m.growth == null) m.growth = m.revenueGrowth;
  return { updated: touched };
}

/** Quarter-end of the latest reported quarter + Yahoo ESG peers, if present. */
export function extractCompanion(
  yahooData: Record<string, any> | null,
): { peers: string[]; quarterEnd: string | null } {
  const peers: string[] = [];
  let quarterEnd: string | null = null;
  if (!yahooData?.quoteSummary?.result?.[0]) return { peers, quarterEnd };
  const res = yahooData.quoteSummary.result[0] as Record<string, any>;
  const list = res.esgScores?.peers;
  if (Array.isArray(list)) {
    for (const p of list) if (typeof p === 'string') peers.push(p);
  }
  const quarterly = res.earnings?.earningsChart?.quarterly;
  if (Array.isArray(quarterly) && quarterly.length) {
    const d = quarterly[quarterly.length - 1]?.date;
    if (typeof d === 'string') quarterEnd = d;
  }
  return { peers, quarterEnd };
}

// ---- Screener.in real competitor listings -----------------------------------
//
// Yahoo's `esgScores.peers` is unreliable, so the REAL peers come from
// Screener.in. Its company page (static HTML) carries a `warehouse-id`, and the
// peer-comparison table is served from /api/company/{warehouseId}/peers/ — the
// rows list the genuine comparable listed companies (TCS, HCLTECH, WIPRO, ...).
// Used by the nightly batch AND the on-demand relay; falls back to industry /
// sector peers when Screener is unreachable.

const SCREENER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

async function screenerGet(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': SCREENER_UA, Accept: 'text/html,application/xhtml+xml' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

export async function screenerWarehouseId(symbol: string): Promise<string | null> {
  const html = await screenerGet(`https://www.screener.in/company/${encodeURIComponent(symbol)}/`);
  if (!html) return null;
  const m = html.match(/warehouse-id="(\d+)"/);
  return m ? m[1] : null;
}

/** Real competitor symbols for a company, from Screener.in's peer table. */
export async function screenerPeers(symbol: string): Promise<string[]> {
  const warehouseId = await screenerWarehouseId(symbol);
  if (!warehouseId) return [];
  const html = await screenerGet(`https://www.screener.in/api/company/${warehouseId}/peers/`);
  if (!html) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of html.matchAll(/\/company\/([A-Z][A-Z0-9_\-]{0,19})\//g)) {
    const p = m[1].toUpperCase();
    if (p === symbol || seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

// ---- Screener.in real ratio & financials engine ----------------------------
//
// Screener is the authoritative public source for Indian fundamentals.
// URLs: consolidated = /company/SYM/consolidated/ ; standalone = /company/SYM/
// (the /standalone/ path 404s). Row labels are taken from Company.showSchedule
// anchors when present, else button/td text. Units (% / days / x) are parsed
// from the cell and the label. Sparse ratio tables (Lodha publishes Debtor
// Days + ROCE %, not ROE) are filled from the same page's P&L + Balance Sheet.

export type ConsolidationView = 'consolidated' | 'standalone';
export type RatioUnit = 'pct' | 'days' | 'x' | 'cr' | 'rs' | 'number';
export type SectorKind = 'bank' | 'nbfc' | 'insurance' | 'realty' | 'amc' | 'generic';

/** PEG = P/E ÷ earnings-growth %. Screener does not publish a PEG field — we derive it from their PE + profit growth. */
export function pegFromPeAndGrowth(pe: number | null | undefined, growthPct: number | null | undefined): number | null {
  if (pe == null || !Number.isFinite(pe) || pe <= 0) return null;
  if (growthPct == null || !Number.isFinite(growthPct) || growthPct <= 0) return null;
  return Math.round((pe / growthPct) * 100) / 100;
}

export interface ScreenerRange {
  label: string;
  y10: number | null;
  y5: number | null;
  y3: number | null;
  y1: number | null;
}

export interface ScreenerRow {
  label: string;
  key: string;
  unit: RatioUnit;
  values: (number | null)[];
}

export interface ScreenerTable {
  years: string[];
  rows: ScreenerRow[];
}

export interface ScreenerYearMetrics {
  year: string;
  sales: number | null;
  netProfit: number | null;
  netWorth: number | null;
  totalDebt: number | null;
  totalAssets: number | null;
  roe: number | null;
  roce: number | null;
  roa: number | null;
  netMargin: number | null;
  operatingMargin: number | null;
  eps: number | null;
}

export interface ScreenerDerived {
  latestYear: string | null;
  roe: number | null;
  roce: number | null;
  roa: number | null;
  netMargin: number | null;
  operatingMargin: number | null;
  revenueGrowth: number | null;
  earningsGrowth: number | null;
  debtToEquity: number | null;
  currentRatio: number | null;
  quickRatio: number | null;
  interestCoverage: number | null;
  eps: number | null;
  sales: number | null;
  netProfit: number | null;
  netWorth: number | null;
  totalDebt: number | null;
  debtorDays: number | null;
  inventoryDays: number | null;
  workingCapitalDays: number | null;
  peg: number | null;
  byYear: ScreenerYearMetrics[];
}

export interface ScreenerSnapshot {
  price: number | null;
  marketCap: number | null;
  pe: number | null;
  pb: number | null;
  bookValue: number | null;
  dividendYield: number | null;
  roce: number | null;
  roe: number | null;
  faceValue: number | null;
  high: number | null;
  low: number | null;
  peg: number | null;
}

export interface ScreenerView {
  kind: ConsolidationView;
  exists: boolean;
  snapshot: ScreenerSnapshot;
  pl: ScreenerTable | null;
  bs: ScreenerTable | null;
  cf: ScreenerTable | null;
  ratios: ScreenerTable | null;
  ranges: ScreenerRange[];
  derived: ScreenerDerived | null;
}

export interface ScreenerBankRatios {
  grossNpa: number | null;
  netNpa: number | null;
  roa: number | null;
  npm: number | null;
  source: string;
}

/** One Finology ticker.finology.in ratio tile (Company Essentials or the Ratios section). */
export interface SectorRatioCard {
  key: string;
  label: string;
  value: number | null;
  unit: RatioUnit;
  y1: number | null;
  y3: number | null;
  y5: number | null;
}

export interface FinologySnapshot {
  peg: number | null;
  essentials: SectorRatioCard[];
  ratios: SectorRatioCard[];
  bank: ScreenerBankRatios | null;
}

export interface ScreenerFundamentals {
  symbol: string;
  name: string | null;
  broadSector: string | null;
  sector: string | null;
  industry: string | null;
  sectorKind: SectorKind;
  defaultView: ConsolidationView;
  views: Partial<Record<ConsolidationView, ScreenerView>>;
  bank: ScreenerBankRatios | null;
  finology: FinologySnapshot | null;
}

const deEnt = (s: string): string =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');

/** Pull the number out of a Screener or Finology cell (Indian commas, %, ₹, blanks, NA). */
function scrNum(text: string): number | null {
  const span = text.match(/<span class=["']number["']>([^<]*)<\/span>/i);
  let raw = deEnt(span ? span[1] : text.replace(/<[^>]+>/g, ''));
  raw = raw.replace(/[₹]/g, '').replace(/%/g, '').replace(/[,\s\u00a0]/g, '').trim();
  if (!raw || raw === '-' || raw === '—' || /^n\/?a$/i.test(raw)) return null;
  const m = raw.match(/^-?\d+(\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

export function normRatioKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/\+$/g, '')
    .replace(/%/g, '')
    .replace(/in rs\.?/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function unitFromLabel(label: string): RatioUnit {
  const k = label.toLowerCase();
  if (/%/.test(k) || /\b(roce|roe|roa|opm|npm|margin|yield|growth|npa|casa|tax|payout|nim|car)\b/.test(k)) return 'pct';
  if (/\bdays\b/.test(k) || /conversion cycle/.test(k)) return 'days';
  if (/coverage|current ratio|quick ratio|debt to equity|peg|debt\/equity/.test(k)) return 'x';
  if (/\beps\b/.test(k) || /book value|face value|current price/.test(k)) return 'rs';
  return 'number';
}

function tableCells(rowHtml: string): { tag: string; attrs: string; content: string }[] {
  const out: { tag: string; attrs: string; content: string }[] = [];
  const re = /<(td|th)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rowHtml))) {
    out.push({ tag: m[1].toLowerCase(), attrs: m[2], content: m[3] });
  }
  return out;
}

function labelFromCell(content: string): string {
  const sched = content.match(/showSchedule\(\s*'([^']+)'/);
  if (sched) return deEnt(sched[1]).replace(/\+$/, '').replace(/\s+/g, ' ').trim();
  const btn = content.match(/<button[^>]*>([\s\S]*?)<\/button>/i);
  const raw = btn ? btn[1] : content;
  return deEnt(raw.replace(/<[^>]+>/g, ''))
    .replace(/\+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function sliceSection(html: string, sectionId: string): string | null {
  const needle = `id="${sectionId}"`;
  const start = html.indexOf(needle);
  if (start < 0) return null;
  const tableStart = html.indexOf('<table', start);
  if (tableStart < 0) return null;
  const tableEnd = html.indexOf('</table>', tableStart);
  if (tableEnd < 0) return null;
  return html.slice(tableStart, tableEnd + 8);
}

function parseScreenerTable(html: string, sectionId: string): ScreenerTable | null {
  const seg = sliceSection(html, sectionId);
  if (!seg) return null;

  const theadM = seg.match(/<thead>([\s\S]*?)<\/thead>/i);
  const years: string[] = [];
  if (theadM) {
    const headerCells = tableCells(theadM[1]);
    for (let i = 1; i < headerCells.length; i += 1) {
      const dk = headerCells[i].attrs.match(/data-date-key="([^"]+)"/);
      const txt = deEnt(headerCells[i].content.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
      years.push(dk ? dk[1] : txt);
    }
  }

  const bodyM = seg.match(/<tbody>([\s\S]*?)<\/tbody>/i);
  if (!bodyM) return null;
  const rows: ScreenerRow[] = [];
  const seen = new Set<string>();
  for (const rm of bodyM[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = tableCells(rm[1]);
    if (!cells.length) continue;
    const label = labelFromCell(cells[0].content);
    if (!label) continue;
    const key = normRatioKey(label);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const values: (number | null)[] = [];
    for (let i = 1; i < cells.length; i += 1) values.push(scrNum(cells[i].content));
    while (values.length < years.length) values.push(null);
    if (values.length > years.length) values.length = years.length;
    rows.push({ label, key, unit: unitFromLabel(label), values });
  }
  return { years, rows };
}

function parseScreenerStrip(html: string): ScreenerSnapshot {
  const out: ScreenerSnapshot = {
    price: null, marketCap: null, pe: null, pb: null, bookValue: null,
    dividendYield: null, roce: null, roe: null, faceValue: null, high: null, low: null, peg: null,
  };
  const start = html.indexOf('<ul id="top-ratios">');
  if (start < 0) return out;
  const end = html.indexOf('</ul>', start);
  if (end < 0) return out;
  const seg = html.slice(start, end);
  for (const li of seg.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)) {
    const block = li[1];
    const nameM = block.match(/<span class="name">([\s\S]*?)<\/span>/);
    if (!nameM) continue;
    const nameTxt = deEnt(nameM[1]).replace(/\s+/g, ' ').trim();
    const nums = [...block.matchAll(/<span class="number">([^<]*)<\/span>/g)]
      .map((m) => Number(String(m[1]).replace(/[,\s]/g, '')))
      .filter((n) => Number.isFinite(n));
    const key = nameTxt.toLowerCase();
    const nn = (i: number) => (nums.length > i ? nums[i] : null);
    if (key.includes('market cap')) out.marketCap = nn(0);
    else if (key.includes('current price')) out.price = nn(0);
    else if (key.includes('high / low') || key.includes('high/low')) {
      out.high = nn(0);
      out.low = nn(1);
    } else if (key.includes('stock p/e') || key === 'p/e') out.pe = nn(0);
    else if (key.includes('stock p/b') || key.includes('p/b')) out.pb = nn(0);
    else if (key.includes('book value')) out.bookValue = nn(0);
    else if (key.includes('dividend yield')) out.dividendYield = nn(0);
    else if (key.trim() === 'roce') out.roce = nn(0);
    else if (key.trim() === 'roe') out.roe = nn(0);
    else if (key.includes('peg')) out.peg = nn(0);
    else if (key.includes('face value')) out.faceValue = nn(0);
  }
  if (out.pb == null && out.bookValue != null && out.bookValue > 0 && out.price != null && out.price > 0) {
    out.pb = Math.round((out.price / out.bookValue) * 100) / 100;
  }
  return out;
}

function parseRanges(html: string): ScreenerRange[] {
  const out: ScreenerRange[] = [];
  for (const m of html.matchAll(/<table class="ranges-table">([\s\S]*?)<\/table>/g)) {
    const b = m[1];
    const th = b.match(/<th[^>]*>([\s\S]*?)<\/th>/);
    const label = th ? deEnt(th[1].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim() : '';
    if (!label || label.toLowerCase().includes('price cagr')) continue;
    const val = (key: string): number | null => {
      const rm = b.match(new RegExp(`<td>\\s*${key}\\s*</td>\\s*<td[^>]*>([\\s\\S]*?)<\\/td>`));
      return rm ? scrNum(rm[1]) : null;
    };
    out.push({
      label,
      y10: val('10 Years:'),
      y5: val('5 Years:'),
      y3: val('3 Years:'),
      y1: val('Last Year:') ?? val('1 Year:') ?? val('TTM:'),
    });
  }
  return out;
}

function rigFromTable(t: ScreenerTable | null): Map<string, ScreenerRow> {
  const map = new Map<string, ScreenerRow>();
  if (!t) return map;
  for (const r of t.rows) map.set(r.key, r);
  return map;
}

const SALES_KEYS = ['sales', 'revenue', 'net sales', 'interest earned'];
const OP_KEYS = ['operating profit'];
const OPM_KEYS = ['opm'];
const NP_KEYS = ['net profit'];
const NPM_KEYS = ['npm'];
const EPS_KEYS = ['eps'];
const EQ_KEYS = ['equity capital'];
const RES_KEYS = ['reserves'];
const BOR_KEYS = ['borrowings', 'total debt'];
const NW_KEYS = ['net worth'];
const TA_KEYS = ['total assets'];
const CA_KEYS = ['current assets'];
const CL_KEYS = ['current liabilities'];
const INT_KEYS = ['interest'];
const ROE_KEYS = ['roe'];
const ROCE_KEYS = ['roce'];
const ROA_KEYS = ['roa'];
const DE_KEYS = ['debt to equity'];
const CR_KEYS = ['current ratio'];
const QR_KEYS = ['quick ratio'];
const IC_KEYS = ['interest coverage'];
const DD_KEYS = ['debtor days'];
const ID_KEYS = ['inventory days'];
const WC_KEYS = ['working capital days'];
const PEG_KEYS = ['peg', 'peg ratio'];

function atRow(map: Map<string, ScreenerRow>, aliases: string[], i: number): number | null {
  for (const a of aliases) {
    const row = map.get(normRatioKey(a));
    if (!row) continue;
    if (i >= 0 && i < row.values.length && row.values[i] != null) return row.values[i];
  }
  return null;
}

function latestRow(map: Map<string, ScreenerRow>, aliases: string[], preferIdx?: number): number | null {
  if (preferIdx != null && preferIdx >= 0) {
    const v = atRow(map, aliases, preferIdx);
    if (v != null) return v;
  }
  for (const a of aliases) {
    const row = map.get(normRatioKey(a));
    if (!row) continue;
    for (let i = row.values.length - 1; i >= 0; i -= 1) if (row.values[i] != null) return row.values[i];
  }
  return null;
}

function lastPopulatedIndex(years: string[], maps: Map<string, ScreenerRow>[]): number {
  const n = years.length;
  if (!n) return -1;
  const fiscal = years
    .map((y, i) => ({ y, i }))
    .filter(({ y }) => /^\d{4}-\d{2}-\d{2}$/.test(y));
  const order = fiscal.length ? fiscal : years.map((y, i) => ({ y, i }));
  for (let k = order.length - 1; k >= 0; k -= 1) {
    const i = order[k].i;
    const has = maps.some((m) => {
      for (const r of m.values()) if (r.values[i] != null) return true;
      return false;
    });
    if (has) return i;
  }
  return order[order.length - 1]?.i ?? n - 1;
}

function deriveScreener(
  pl: ScreenerTable | null,
  bs: ScreenerTable | null,
  ratios: ScreenerTable | null,
  strip: ScreenerSnapshot,
): ScreenerDerived | null {
  const plMap = rigFromTable(pl);
  const bsMap = rigFromTable(bs);
  const rtMap = rigFromTable(ratios);
  const years = pl?.years ?? bs?.years ?? ratios?.years ?? [];
  const n = years.length;
  if (!n) return null;

  const byYear: ScreenerYearMetrics[] = [];
  for (let i = 0; i < n; i += 1) {
    const sales = atRow(plMap, SALES_KEYS, i);
    const opProfit = atRow(plMap, OP_KEYS, i);
    const opmRow = atRow(plMap, OPM_KEYS, i);
    const netProfit = atRow(plMap, NP_KEYS, i);
    const npmRow = atRow(plMap, NPM_KEYS, i);
    const eps = atRow(plMap, EPS_KEYS, i);
    const eqCap = atRow(bsMap, EQ_KEYS, i);
    const reserves = atRow(bsMap, RES_KEYS, i);
    const borrowings = atRow(bsMap, BOR_KEYS, i);
    const totalAssets = atRow(bsMap, TA_KEYS, i);
    const netWorth =
      eqCap != null && reserves != null ? eqCap + reserves : atRow(bsMap, NW_KEYS, i);
    const totalDebt = borrowings;
    const tableRoe = atRow(rtMap, ROE_KEYS, i);
    const tableRoce = atRow(rtMap, ROCE_KEYS, i);
    const tableRoa = atRow(rtMap, ROA_KEYS, i);
    const roe =
      tableRoe ??
      (netProfit != null && netWorth != null && netWorth !== 0 ? (netProfit / netWorth) * 100 : null);
    const roce =
      tableRoce ??
      (opProfit != null && netWorth != null && totalDebt != null && netWorth + totalDebt !== 0
        ? (opProfit / (netWorth + totalDebt)) * 100
        : null);
    const roa =
      tableRoa ??
      (netProfit != null && totalAssets != null && totalAssets !== 0 ? (netProfit / totalAssets) * 100 : null);
    const netMargin =
      npmRow ?? (netProfit != null && sales != null && sales !== 0 ? (netProfit / sales) * 100 : null);
    const operatingMargin =
      opmRow ?? (opProfit != null && sales != null && sales !== 0 ? (opProfit / sales) * 100 : null);
    byYear.push({
      year: years[i],
      sales,
      netProfit,
      netWorth,
      totalDebt,
      totalAssets,
      roe,
      roce,
      roa,
      netMargin,
      operatingMargin,
      eps,
    });
  }

  const li = lastPopulatedIndex(years, [plMap, bsMap, rtMap]);
  const l = li >= 0 ? byYear[li] : byYear[byYear.length - 1];
  const prevFiscal = (() => {
    if (li <= 0) return undefined;
    const y = years[li];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(y)) return byYear[li - 1];
    const prevKey = `${Number(y.slice(0, 4)) - 1}${y.slice(4)}`;
    const pi = years.indexOf(prevKey);
    return pi >= 0 ? byYear[pi] : byYear[li - 1];
  })();
  const g = (cur: number | null, prv: number | null): number | null =>
    cur != null && prv != null && prv !== 0 ? ((cur - prv) / Math.abs(prv)) * 100 : null;

  const rnd = (v: number | null, d = 1): number | null =>
    v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d;

  const tableRoe = latestRow(rtMap, ROE_KEYS, li);
  const tableRoce = latestRow(rtMap, ROCE_KEYS, li);
  const tableRoa = latestRow(rtMap, ROA_KEYS, li);

  const ca = atRow(bsMap, CA_KEYS, li);
  const cl = atRow(bsMap, CL_KEYS, li);
  const op = atRow(plMap, OP_KEYS, li);
  const intr = atRow(plMap, INT_KEYS, li);

  return {
    latestYear: l?.year ?? years[li] ?? null,
    // Prefer Screener's published ratio / top-strip (TTM) over a reconstructed formula.
    roe: rnd(tableRoe ?? strip.roe ?? l?.roe ?? null),
    roce: rnd(tableRoce ?? strip.roce ?? l?.roce ?? null),
    roa: rnd(tableRoa ?? l?.roa ?? null),
    netMargin: rnd(l?.netMargin ?? null),
    operatingMargin: rnd(l?.operatingMargin ?? null),
    revenueGrowth: rnd(g(l?.sales ?? null, prevFiscal?.sales ?? null)),
    earningsGrowth: rnd(g(l?.netProfit ?? null, prevFiscal?.netProfit ?? null)),
    debtToEquity: rnd(
      latestRow(rtMap, DE_KEYS, li) ??
        (l?.netWorth != null && l.netWorth !== 0 && l.totalDebt != null ? l.totalDebt / l.netWorth : null),
      2,
    ),
    currentRatio: rnd(
      latestRow(rtMap, CR_KEYS, li) ?? (ca != null && cl != null && cl !== 0 ? ca / cl : null),
      2,
    ),
    quickRatio: rnd(latestRow(rtMap, QR_KEYS, li), 2),
    interestCoverage: rnd(
      latestRow(rtMap, IC_KEYS, li) ?? (op != null && intr != null && intr !== 0 ? op / intr : null),
      2,
    ),
    eps: rnd(atRow(plMap, EPS_KEYS, li), 2),
    sales: l?.sales ?? null,
    netProfit: l?.netProfit ?? null,
    netWorth: l?.netWorth ?? null,
    totalDebt: l?.totalDebt ?? null,
    debtorDays: rnd(latestRow(rtMap, DD_KEYS, li), 0),
    inventoryDays: rnd(latestRow(rtMap, ID_KEYS, li), 0),
    workingCapitalDays: rnd(latestRow(rtMap, WC_KEYS, li), 0),
    peg: rnd(
      latestRow(rtMap, PEG_KEYS, li) ??
        strip.peg ??
        pegFromPeAndGrowth(strip.pe, g(l?.netProfit ?? null, prevFiscal?.netProfit ?? null)),
      2,
    ),
    byYear,
  };
}

export function classifyScreenerPage(html: string): ConsolidationView | null {
  if (/data-consolidated="true"/.test(html) || /Consolidated Figures/i.test(html)) return 'consolidated';
  if (/data-consolidated="false"/.test(html) || /Standalone Figures/i.test(html)) return 'standalone';
  return null;
}

export function parseScreenerViewFromHtml(html: string, kind: ConsolidationView): ScreenerView {
  const snapshot = parseScreenerStrip(html);
  const ratios = parseScreenerTable(html, 'ratios');
  const pl = parseScreenerTable(html, 'profit-loss');
  const bs = parseScreenerTable(html, 'balance-sheet');
  const cf = parseScreenerTable(html, 'cash-flow');
  const ranges = parseRanges(html);
  const derived = deriveScreener(pl, bs, ratios, snapshot);
  return { kind, exists: true, snapshot, pl, bs, cf, ratios, ranges, derived };
}

function parseScreenerView(html: string, kind: ConsolidationView): ScreenerView {
  return parseScreenerViewFromHtml(html, kind);
}

async function screenerViewFetch(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': SCREENER_UA, Accept: 'text/html,application/xhtml+xml' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

export function sectorKindOf(sector: string | null, industry: string | null): SectorKind {
  const s = `${sector ?? ''} ${industry ?? ''}`.toLowerCase();
  if (/\binsurance\b/.test(s)) return 'insurance';
  if (/\bbank\b/.test(s)) return 'bank';
  if (/\bnbfc\b/.test(s) || /housing finance/.test(s) || /non.?banking/.test(s)) return 'nbfc';
  if (/asset management|mutual fund|\bamc\b/.test(s)) return 'amc';
  if (/real estate|realty|construction|developer/.test(s)) return 'realty';
  return 'generic';
}

function bankFromScreenerRows(view: ScreenerView | undefined): ScreenerBankRatios | null {
  if (!view?.ratios) return null;
  const map = rigFromTable(view.ratios);
  const pick = (keys: string[]) => latestRow(map, keys);
  const grossNpa = pick(['gross npa', 'gross npa percent']);
  const netNpa = pick(['net npa', 'net npa percent']);
  if (grossNpa == null && netNpa == null) return null;
  return {
    grossNpa,
    netNpa,
    roa: pick(['roa']),
    npm: pick(['npm']),
    source: 'screener',
  };
}

/** Full Screener fundamentals — consolidated (`/consolidated/`) + standalone (bare `/company/SYM/`). */
export async function fetchScreenerFundamentals(symbol: string): Promise<ScreenerFundamentals | null> {
  const page = `https://www.screener.in/company/${encodeURIComponent(symbol)}/`;
  const [consH, bareH] = await Promise.all([
    screenerViewFetch(`${page}consolidated/`),
    screenerViewFetch(page),
  ]);

  const views: Partial<Record<ConsolidationView, ScreenerView>> = {};
  const ingest = (html: string | null, hint: ConsolidationView) => {
    if (!html) return;
    const kind = classifyScreenerPage(html) ?? hint;
    if (views[kind]) return;
    views[kind] = parseScreenerView(html, kind);
  };
  ingest(consH, 'consolidated');
  ingest(bareH, 'standalone');
  if (!views.consolidated && !views.standalone) return null;

  const src = (views.consolidated ? consH : bareH) ?? consH ?? bareH ?? '';
  const sector = src.match(/title="Sector">([^<]+)<\/a>/)?.[1]?.trim() ?? null;
  const industry = src.match(/title="Industry">([^<]+)<\/a>/)?.[1]?.trim() ?? null;
  const broad =
    src.match(/title="Broad Sector">([^<]+)<\/a>/)?.[1]?.trim() ??
    src.match(/title="Broad Industry">([^<]+)<\/a>/)?.[1]?.trim() ??
    null;
  const brand =
    src.match(/<span class="min-width-0 overflow-wrap-anywhere">([\s\S]*?)<\/span>/)?.[1]?.replace(/<[^>]+>/g, '').trim() ??
    null;
  const defaultView: ConsolidationView = views.consolidated ? 'consolidated' : 'standalone';
  const kind = sectorKindOf([broad, sector, industry, brand].filter(Boolean).join(' '), null);

  return {
    symbol,
    name: brand ?? null,
    broadSector: broad,
    sector,
    industry,
    sectorKind: kind,
    defaultView,
    views,
    bank: kind === 'bank' || kind === 'nbfc' ? bankFromScreenerRows(views[defaultView]) : null,
    finology: null,
  };
}

const FINOLOGY_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function finoStripLabel(html: string): string {
  return deEnt(
    html
      .replace(/<span class=['"]infolink[\s\S]*?<\/span>/gi, '')
      .replace(/<small>[\s\S]*?<\/small>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function finoCard(label: string, value: number | null, y1: number | null = null, y3: number | null = null, y5: number | null = null): SectorRatioCard {
  return { key: normRatioKey(label), label, value, unit: unitFromLabel(label), y1, y3, y5 };
}

function parseFinologyEssentials(html: string): SectorRatioCard[] {
  const start = html.indexOf('id="mainContent_updAddRatios"');
  if (start < 0) return [];
  const end = html.indexOf('class="noteremarks"', start);
  const seg = html.slice(start, end > 0 ? end : start + 25000);
  const out: SectorRatioCard[] = [];
  for (const m of seg.matchAll(/<div class="col-6 col-md-4 compess">([\s\S]*?)<\/div>/g)) {
    const block = m[1];
    const small = block.match(/<small>([\s\S]*?)<\/small>/);
    if (!small) continue;
    const label = finoStripLabel(small[1]);
    if (!label || /add your ratio/i.test(label)) continue;
    const p = block.match(/<p>([\s\S]*?)<\/p>/);
    out.push(finoCard(label, p ? scrNum(p[1]) : null));
  }
  return out;
}

function parseFinologyRatioCards(html: string): SectorRatioCard[] {
  const start = html.indexOf('id="ratios"');
  if (start < 0) return [];
  const ends = ['id="mainContent_ShareHolding"', 'id="mainContent_ProsAndCons"']
    .map((n) => html.indexOf(n, start))
    .filter((i) => i > start);
  const seg = html.slice(start, ends.length ? Math.min(...ends) : start + 80000);
  const out: SectorRatioCard[] = [];
  for (const m of seg.matchAll(/<h4[^>]*>([\s\S]*?)<\/h4>/g)) {
    const label = finoStripLabel(m[1]);
    if (!label || label.length > 80) continue;
    const after = m.index + m[0].length;
    const nextH4 = seg.indexOf('<h4', after);
    const body = seg.slice(after, nextH4 > after ? nextH4 : after + 1800);
    const periods: { y1: number | null; y3: number | null; y5: number | null } = { y1: null, y3: null, y5: null };
    for (const p of body.matchAll(/<span class="duration">([^<]+)<\/span>\s*<span class="durationvalue">([^<]+)<\/span>/g)) {
      const dur = p[1].trim().toLowerCase();
      const val = scrNum(p[2]);
      if (dur.startsWith('1')) periods.y1 = val;
      else if (dur.startsWith('3')) periods.y3 = val;
      else if (dur.startsWith('5')) periods.y5 = val;
    }
    let value: number | null = periods.y1;
    if (value == null) {
      const h2 = body.match(/<(?:span class="h2"|h2)[^>]*>([\s\S]*?)<\/(?:span|h2)>/i);
      if (h2 && !/\bNA\b/i.test(finoStripLabel(h2[1]))) value = scrNum(h2[1]);
    }
    out.push(finoCard(label, value, periods.y1, periods.y3, periods.y5));
  }
  return out;
}

function parseFinologyBankTable(html: string): ScreenerBankRatios | null {
  const anchor = html.indexOf('Gross NPA');
  if (anchor < 0) return null;
  const tableStart = html.lastIndexOf('<table', anchor);
  const tableEnd = html.indexOf('</table>', anchor);
  if (tableStart < 0 || tableEnd < 0) return null;
  const seg = html.slice(tableStart, tableEnd);
  const out: ScreenerBankRatios = { grossNpa: null, netNpa: null, roa: null, npm: null, source: 'finology' };
  for (const rm of seg.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const row = rm[1];
    const th = row.match(/<th scope="row">([\s\S]*?)<\/th>/);
    if (!th) continue;
    const label = deEnt(th[1].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim().toLowerCase();
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1]);
    let value: number | null = null;
    for (let i = cells.length - 1; i >= 0; i -= 1) {
      const v = scrNum(cells[i]);
      if (v != null) {
        value = v;
        break;
      }
    }
    if (label === 'gross npa %' || label === 'gross npa') out.grossNpa = value;
    else if (label === 'net npa %' || label === 'net npa') out.netNpa = value;
    else if (label === 'return on assets %' || label === 'roa %') out.roa = value;
    else if (label === 'npm %' || label === 'npm') out.npm = value;
  }
  return out.grossNpa == null && out.netNpa == null ? null : out;
}

function finoFind(cards: SectorRatioCard[], aliases: string[]): number | null {
  const keys = aliases.map(normRatioKey);
  for (const c of cards) {
    if (c.value == null) continue;
    if (keys.includes(c.key)) return c.value;
  }
  for (const k of keys) {
    const hit = cards.find(
      (c) => c.value != null && (c.key.startsWith(`${k} `) || c.key.endsWith(` ${k}`)),
    );
    if (hit) return hit.value;
  }
  return null;
}

function fillRatioGapsFromEssentials(ratios: SectorRatioCard[], essentials: SectorRatioCard[]): void {
  for (const r of ratios) {
    if (r.value != null) continue;
    const hit = finoFind(essentials, [r.label, r.key, r.label.replace(/%/g, '')]);
    if (hit != null) r.value = hit;
  }
}

/** Parse ticker.finology.in company HTML — essentials + sector ratio cards + bank NPA table. */
export function parseFinologyHtml(html: string): FinologySnapshot {
  const essentials = parseFinologyEssentials(html);
  const ratios = parseFinologyRatioCards(html);
  fillRatioGapsFromEssentials(ratios, essentials);
  const bank = parseFinologyBankTable(html);
  const peg = finoFind(ratios, ['peg', 'peg ratio']) ?? finoFind(essentials, ['peg', 'peg ratio']);
  return { peg, essentials, ratios, bank };
}

export async function fetchFinologySnapshot(symbol: string): Promise<FinologySnapshot | null> {
  try {
    const res = await fetch(`https://ticker.finology.in/company/${encodeURIComponent(symbol)}`, {
      headers: { 'User-Agent': FINOLOGY_UA, Accept: 'text/html,application/xhtml+xml' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    return parseFinologyHtml(await res.text());
  } catch {
    return null;
  }
}

/** Pull quarterly Gross NPA / Net NPA / ROA / NPM for a bank from Finology. */
export async function fetchFinologyBankRatios(symbol: string): Promise<ScreenerBankRatios | null> {
  const snap = await fetchFinologySnapshot(symbol);
  return snap?.bank ?? null;
}

/** Best-effort full fundamentals (Screener + Finology sector ratios). */
export async function fetchRealFundamentals(symbol: string): Promise<ScreenerFundamentals | null> {
  const [sf, fino] = await Promise.all([fetchScreenerFundamentals(symbol), fetchFinologySnapshot(symbol)]);
  if (!sf) return null;
  if (fino) {
    sf.finology = fino;
    if (fino.bank && (sf.sectorKind === 'bank' || sf.sectorKind === 'nbfc')) sf.bank = fino.bank;
  }
  return sf;
}

function preferFilled(current: number | null, next: number | null): number | null {
  if (next == null) return current;
  if (current == null) return next;
  if (current === 0 && next !== 0) return next;
  return current;
}

/** Fill legacy Metrics with Screener values. Top-strip (current TTM) wins over reconstructed annuals. */
export function applyScreener(m: Metrics, sf: ScreenerFundamentals | null): void {
  if (!sf) return;
  const v = sf.views[sf.defaultView];
  if (!v) return;
  const s = v.snapshot;
  const d = v.derived;
  if (sf.name && (!m.name || m.name === m.symbol)) m.name = sf.name;
  if (sf.broadSector) m.sector = sf.broadSector;
  if (sf.sector) m.industry = sf.industry ?? sf.sector;
  if (m.price == null || m.price <= 0) m.price = s.price ?? m.price;
  if ((m.marketCap == null || m.marketCap <= 0) && s.marketCap != null) m.marketCap = s.marketCap * 1e7;
  if (s.pe != null) m.pe = s.pe;
  if (s.pb != null) m.pb = s.pb;
  if (s.bookValue != null) m.bookValue = s.bookValue;
  if (m.pb == null && s.bookValue != null && s.bookValue > 0 && (m.price ?? 0) > 0) {
    m.pb = Math.round((m.price / s.bookValue) * 100) / 100;
  }
  if (s.dividendYield != null) m.dividendYield = s.dividendYield;
  if (s.roce != null) m.roce = s.roce;
  if (s.roe != null) m.roe = s.roe;
  if (s.high != null) m.fiftyTwoWeekHigh = s.high;
  if (s.low != null) m.fiftyTwoWeekLow = s.low;
  if (d) {
    if (m.roe == null && d.roe != null) m.roe = d.roe;
    if (m.roce == null && d.roce != null) m.roce = d.roce;
    if (d.roa != null) m.roa = d.roa;
    if (d.netMargin != null) m.netMargin = d.netMargin;
    if (d.operatingMargin != null) m.operatingMargin = d.operatingMargin;
    if (d.revenueGrowth != null) m.revenueGrowth = d.revenueGrowth;
    if (d.earningsGrowth != null) m.earningsGrowth = d.earningsGrowth;
    if (d.debtToEquity != null) m.debtToEquity = d.debtToEquity;
    if (d.currentRatio != null) m.currentRatio = d.currentRatio;
    if (d.quickRatio != null) m.quickRatio = d.quickRatio;
    if (d.eps != null) m.eps = d.eps;
    m.growth = d.earningsGrowth ?? m.growth ?? d.revenueGrowth;
    if (d.peg != null) m.peg = d.peg;
  }

  const fino = sf.finology;
  if (fino) {
    const pool = [...fino.essentials, ...fino.ratios];
    m.roe = preferFilled(m.roe, finoFind(pool, ['roe', 'roe%']));
    m.roce = preferFilled(m.roce, finoFind(pool, ['roce', 'roce%']));
    m.roa = preferFilled(m.roa, finoFind(pool, ['roa', 'roa%']));
    const fBv = finoFind(pool, ['book value ttm', 'book value']);
    const fPb = finoFind(pool, ['p b']);
    if (m.bookValue == null || m.bookValue === 0) {
      if (fBv != null && fBv !== 0) {
        m.bookValue = fBv;
        if (fPb != null && fPb > 0) m.pb = fPb;
        else if ((m.price ?? 0) > 0) m.pb = Math.round((m.price / fBv) * 100) / 100;
      }
    }
    m.debtToEquity = preferFilled(m.debtToEquity, finoFind(pool, ['debt equity', 'debt to equity']));
    m.netMargin = preferFilled(m.netMargin, finoFind(pool, ['pat margin', 'npm', 'net margin']));
  }

  m.growth = m.earningsGrowth ?? m.growth ?? m.revenueGrowth;
  // PEG must agree with the DISPLAYED pe and growth: recompute whenever both
  // are positive (overrides stale/Screener pegs that used other inputs).
  // When growth is missing, a Screener/Finology peg is better than nothing.
  const strict = pegFromPeAndGrowth(m.pe, m.growth);
  m.peg = strict ?? m.peg ?? fino?.peg ?? null;
  // Bank P&L has no meaningful operating/gross margin (interest is both raw
  // material and product) — Yahoo's versions are artifacts like -887%.
  if (sf.sectorKind === 'bank') {
    m.operatingMargin = null;
    m.grossMargin = null;
  }
}

// ---- Screens -------------------------------------------------------------

export function buffettScreen(m: Metrics): Screen {
  const flags: string[] = [];
  let score = 40;
  const roe = m.roe;
  if (roe == null) flags.push('ROE data missing');
  else if (roe >= 20) { score += 20; flags.push(`ROE ${roe.toFixed(1)}% — exceptional`) }
  else if (roe >= 15) { score += 15; flags.push(`ROE ${roe.toFixed(1)}% — strong`) }
  else if (roe >= 10) { score += 8; flags.push(`ROE ${roe.toFixed(1)}% — adequate`) }
  else if (roe < 10) { score -= 12; flags.push(`ROE ${roe.toFixed(1)}% — weak`) }

  const margin = m.netMargin;
  if (margin == null) flags.push('margin data missing');
  else {
    if (margin >= 15) { score += 15; flags.push(`Net margin ${margin.toFixed(1)}% — pricing power / moat`) }
    else if (margin >= 10) { score += 10 }
    else if (margin >= 5) { score += 5 }
    else { score -= 8; flags.push(`Net margin ${margin.toFixed(1)}% — thin`) }
  }

  const de = m.debtToEquity;
  if (de == null) flags.push('debt data missing');
  else {
    if (de <= 0.5) { score += 15; flags.push(`D/E ${de.toFixed(2)} — low leverage`) }
    else if (de <= 1) { score += 10 }
    else if (de <= 2) { score += 4 }
    else { score -= 8; flags.push(`D/E ${de.toFixed(2)} — high leverage`) }
  }

  if ((m.revenueGrowth ?? 0) > 0) score += 5;
  if ((m.earningsGrowth ?? 0) > 0) score += 5;
  if ((m.dividendYield ?? 0) > 0) flags.push(`Pays dividend (${m.dividendYield!.toFixed(2)}%)`);

  score = Math.max(0, Math.min(100, Math.round(score)));
  const thesis =
    score >= 72
      ? 'Classic Buffett compounder: high returns on equity, fat margins, low debt.'
      : score >= 48
        ? 'Decent quality — capable of compounding, but not the full Buffett checklist.'
        : 'Fails Buffett quality tests: weak returns, thin margins, or heavy leverage.';
  return { score, grade: gradeFor(score), thesis, flags };
}

export function lynchScreen(m: Metrics): Screen {
  const flags: string[] = [];
  const pe = m.pe;
  const growth = m.growth ?? 0;
  if (pe == null || pe <= 0) {
    return {
      score: 30,
      grade: 'C+',
      thesis: 'Not classifiable — loss-making or no earnings, a turnaround/asset play risk.',
      flags: ['Negative or no earnings'],
    };
  }
  const cls = (g: number): string => {
    if (m.netMargin != null && m.netMargin < 6 && ['Metals', 'Energy', 'Cement', 'Auto'].includes(m.sector ?? '')) return 'Cyclical';
    if (g < 5) return 'Slow grower';
    if (g < 12) return 'Stalwart';
    if (g < 20) return 'Fast grower';
    return 'Super-fast grower';
  };
  const classification = cls(growth);
  flags.push(`${classification}, growth ≈ ${growth.toFixed(1)}%`);
  const safeG = Math.max(growth, 1);
  const peg = pe / safeG;
  flags.push(peg <= 1 ? `PEG ${peg.toFixed(2)} — cheapest vs growth` : peg <= 2 ? `PEG ${peg.toFixed(2)} — fairly priced` : `PEG ${peg.toFixed(2)} — pricey vs growth`);

  let score = 90;
  if (peg <= 0.5) score = 92;
  else if (peg <= 1) score = 80;
  else if (peg <= 1.5) score = 64;
  else if (peg <= 2) score = 48;
  else score = 30;
  if (classification === 'Slow grower') score -= 6;
  score = Math.max(0, Math.min(100, Math.round(score)));

  const thesis =
    score >= 72
      ? `Lynch would like this: a ${classification.toLowerCase()} trading at PEG ${peg.toFixed(2)}.`
      : score >= 48
        ? `Fairly valued ${classification.toLowerCase()} — adequate but no bargain.`
        : `${capitalize(classification)} priced beyond its growth. Lynch waits for a better entry.`;
  return { score, grade: gradeFor(score), thesis, flags };
}

export function grahamScreen(m: Metrics, price: number): Screen {
  const flags: string[] = [];
  let score = 30;
  const eps = m.eps;
  const bv = m.bookValue;
  let grahamValue: number | null = null;
  if (eps != null && bv != null && eps > 0 && bv > 0) grahamValue = Math.sqrt(22.5 * eps * bv);

  if (m.pe != null && m.pe <= 15 && m.pe > 0) { score += 14; flags.push('P/E ≤ 15 (defensive)') }
  else if (m.pe != null && m.pe > 0) flags.push(`P/E ${m.pe.toFixed(1)} — above defensive ceiling`);
  if (m.pb != null && m.pb <= 1.5) { score += 14; flags.push('P/B ≤ 1.5 (defensive)') }
  else if (m.pb != null) flags.push(`P/B ${m.pb.toFixed(1)} — not bargain territory`);
  if (m.currentRatio != null && m.currentRatio >= 2) { score += 14; flags.push('Current ratio ≥ 2') }
  if (m.debtToEquity != null && m.debtToEquity <= 1) { score += 14; flags.push('Leverage within Graham limits') }
  if (grahamValue != null && price > 0) {
    const mos = (grahamValue - price) / price;
    if (mos >= 0.15) { score += 14; flags.push(`~${Math.round(mos * 100)}% margin of safety vs Graham number`) }
    else if (mos >= 0) { score += 6; flags.push(`Near Graham value (₹${grahamValue.toFixed(0)})`) }
    else flags.push(`Above Graham number ₹${grahamValue.toFixed(0)}`);
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const thesis =
    grahamValue != null
      ? score >= 72
        ? 'Graham defensive buy — cheap on earnings and assets with a margin of safety.'
        : score >= 48
          ? 'Approximately fairly valued on Graham metrics.'
          : 'Too expensive on Graham numbers; wait for a wider margin of safety.'
      : 'Insufficient book/EPS data to compute the Graham number.';
  return { score, grade: gradeFor(score), thesis, flags };
}

// ---- Verdict + opinion ---------------------------------------------------

export function computeVerdict(
  m: Metrics,
  price: number,
  symbol: string,
  name?: string | null,
): Verdict {
  const buffett = buffettScreen(m);
  const lynch = lynchScreen(m);
  const graham = grahamScreen(m, price);

  const parts: { s: number; w: number }[] = [
    { s: buffett.score, w: 0.45 },
    { s: lynch.score, w: 0.35 },
    { s: graham.score, w: 0.2 },
  ];
  const wsum = parts.reduce((a, p) => a + p.s * p.w, 0);
  const score = Math.round(wsum);
  const grade = gradeFor(score);
  const rating = score >= 72 ? 'Strong Buy' : score >= 58 ? 'Buy' : score >= 44 ? 'Hold' : score >= 32 ? 'Sell' : 'Strong Sell';

  const estimates = [
    m.targetMean != null && m.targetMean > 0 ? m.targetMean : null,
    m.eps != null && m.eps > 0 && m.growth != null ? m.eps * Math.max(m.growth, 5) * 1.0 : null,
    m.eps != null && m.bookValue != null && m.eps > 0 && m.bookValue > 0 ? Math.sqrt(22.5 * m.eps * m.bookValue) : null,
  ].filter((v): v is number => v != null && v > 0);
  const fairMid = estimates.length ? estimates.reduce((a, b) => a + b, 0) / estimates.length : price;
  const fairLow = estimates.length ? Math.min(...estimates) : fairMid * 0.88;
  const fairHigh = estimates.length ? Math.max(...estimates) : fairMid * 1.12;
  const mos = price > 0 ? (fairMid - price) / price : 0;
  const moS = Math.round(mos * 100);

  const summary =
    `${symbol}: ${rating.toLowerCase()} (${score}/100, ${grade}). ` +
    `Fair value ₹${Math.round(fairMid).toLocaleString('en-IN')} vs ₹${Math.round(price).toLocaleString('en-IN')} ` +
    `(${moS >= 0 ? '+' : ''}${moS}% margin of safety). ` +
    `Buffett ${buffett.grade} · Lynch ${lynch.grade} · Graham ${graham.grade}.`;

  return {
    score,
    grade,
    rating,
    fairValueMid: Math.round(fairMid * 100) / 100,
    fairValueLow: Math.round(fairLow * 100) / 100,
    fairValueHigh: Math.round(fairHigh * 100) / 100,
    marginOfSafety: moS,
    targetMean: m.targetMean,
    analysts: m.analysts,
    summary: name ? `${name} — ${summary}` : summary,
  };
}

export function buildOpinion(
  m: Metrics,
  verdict: Verdict,
  screens: { buffett: Screen; lynch: Screen; graham: Screen },
  price: number,
): Opinion {
  const { score, marginOfSafety: mos, fairValueMid, rating } = verdict;
  const strong = score >= 72;
  const good = score >= 56;
  const bad = score < 44;

  let stance: Opinion['stance'] = 'HOLD';
  if (strong && mos >= -5) stance = 'BUY';
  else if (good && mos >= 8) stance = 'BUY';
  else if (mos >= 20) stance = 'BUY';
  else if (bad && mos <= -8) stance = 'SELL';
  else if (mos <= -25) stance = 'SELL';

  const conviction = Math.round(Math.max(5, Math.min(95, score * 0.6 + ((mos + 30) / 60) * 40)));

  const bits: string[] = [];
  bits.push(`Long-term stance: ${stance} (${conviction}% conviction, horizon 3-5 yrs).`);
  bits.push(`Blended valuation score ${score}/100 ("${rating}") with fair value ≈ ₹${Math.round(fairValueMid).toLocaleString('en-IN')} vs price ₹${Math.round(price).toLocaleString('en-IN')} — ${mos >= 0 ? '+' : ''}${mos}% margin of safety.`);
  const drv: string[] = [];
  if (m.roe != null) drv.push(`ROE ${m.roe.toFixed(1)}%`);
  if (m.netMargin != null) drv.push(`net margin ${m.netMargin.toFixed(1)}%`);
  if (m.debtToEquity != null) drv.push(`D/E ${m.debtToEquity.toFixed(2)}`);
  if (m.earningsGrowth != null) drv.push(`earnings growth ${m.earningsGrowth.toFixed(1)}%`);
  if (m.revenueGrowth != null) drv.push(`revenue growth ${m.revenueGrowth.toFixed(1)}%`);
  if (m.dividendYield != null) drv.push(`yield ${m.dividendYield.toFixed(2)}%`);
  if (drv.length) bits.push(`Key inputs: ${drv.join(', ')}.`);
  bits.push(`Screens — Buffett ${screens.buffett.grade} · Lynch ${screens.lynch.grade} · Graham ${screens.graham.grade}.`);

  const risks: string[] = [];
  if (m.debtToEquity != null && m.debtToEquity > 1.5) risks.push(`Elevated leverage (D/E ${m.debtToEquity.toFixed(2)})`);
  if (m.netMargin != null && m.netMargin < 5) risks.push(`Thin net margin (${m.netMargin.toFixed(1)}%)`);
  if (m.roe != null && m.roe < 10) risks.push(`Low return on equity (${m.roe.toFixed(1)}%)`);
  if ((m.revenueGrowth ?? 0) < 0) risks.push('Revenue contracting');
  if ((m.earningsGrowth ?? 0) < 0) risks.push('Earnings declining');
  if (m.promoterHolding != null && m.promoterHolding < 40) risks.push(`Promoter holding only ${m.promoterHolding.toFixed(0)}%`);
  if (m.beta != null && m.beta > 1.5) risks.push(`High beta ${m.beta.toFixed(2)}`);
  if (m.peg != null && m.peg > 2.5) risks.push(`Expensive growth (PEG ${m.peg.toFixed(2)})`);
  if (!risks.length) risks.push('No material red flags in the current fundamentals.');

  return { horizon: 'lt', stance, conviction, thesis: bits.join(' '), risks };
}

export function reportLinks(symbol: string, name: string, quarterEnd: string | null): EntryReports {
  const qSearch = `https://www.google.com/search?q=${encodeURIComponent(`${name} quarterly results`)}`;
  const aSearch = `https://www.google.com/search?q=${encodeURIComponent(`${name} annual report pdf`)}`;
  return {
    quarterly: {
      label: 'Latest quarterly',
      period: quarterEnd
        ? new Date(`${quarterEnd}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
        : null,
      links: [
        { label: 'Screener — quarterly financials', url: `https://www.screener.in/company/${symbol}/#quarters`, kind: 'financials' },
        { label: 'Search latest quarter results', url: qSearch, kind: 'search' },
      ],
    },
    annual: {
      label: 'Latest annual',
      period: null,
      links: [
        { label: 'Screener — annual financials', url: `https://www.screener.in/company/${symbol}/`, kind: 'financials' },
        { label: 'Search annual report PDF', url: aSearch, kind: 'search' },
      ],
    },
  };
}

// ---- Entry assembly ------------------------------------------------------

export function buildEntry(opts: {
  symbol: string;
  name?: string | null;
  m: Metrics;
  price: number;
  peers?: EntryPeer[];
  reports?: EntryReports | null;
  quarterEnd?: string | null;
  financials?: ScreenerFundamentals | null;
}): AnalysisEntry {
  const { symbol, name, m, price } = opts;
  // Yahoo uses exactly 0 as a "P/E unavailable" sentinel (e.g. IDEA) — a
  // P/E of zero is never meaningful, so normalize it to null. Genuine
  // negative P/Es (loss-makers) are kept.
  if (m.pe === 0) m.pe = null;
  m.growth = m.earningsGrowth ?? m.revenueGrowth ?? m.growth;
  // Final funnel: displayed peg must equal displayed pe/growth whenever both
  // are positive (heals stale pegs carried from older runs). Otherwise keep
  // any Screener-sourced peg.
  const strict = pegFromPeAndGrowth(m.pe, m.growth);
  m.peg = strict ?? m.peg ?? null;
  const verdict = computeVerdict(m, price, symbol, name);
  const screens = {
    buffett: buffettScreen(m),
    lynch: lynchScreen(m),
    graham: grahamScreen(m, price),
  };
  return {
    symbol,
    name: name ?? m.name ?? symbol,
    sector: m.sector,
    industry: m.industry,
    description: m.description,
    price: Math.round(price * 100) / 100,
    marketCap: m.marketCap,
    metrics: {
      pe: m.pe == null ? null : Math.round(m.pe * 100) / 100,
      pb: m.pb == null ? null : Math.round(m.pb * 100) / 100,
      ps: m.ps == null ? null : Math.round(m.ps * 100) / 100,
      peg: m.peg == null ? null : Math.round(m.peg * 100) / 100,
      roe: m.roe == null ? null : Math.round(m.roe * 10) / 10,
      roce: m.roce == null ? null : Math.round(m.roce * 10) / 10,
      roa: m.roa == null ? null : Math.round(m.roa * 10) / 10,
      netMargin: m.netMargin == null ? null : Math.round(m.netMargin * 10) / 10,
      operatingMargin: m.operatingMargin == null ? null : Math.round(m.operatingMargin * 10) / 10,
      grossMargin: m.grossMargin == null ? null : Math.round(m.grossMargin * 10) / 10,
      revenueGrowth: m.revenueGrowth == null ? null : Math.round(m.revenueGrowth * 10) / 10,
      earningsGrowth: m.earningsGrowth == null ? null : Math.round(m.earningsGrowth * 10) / 10,
      growth: m.growth == null ? null : Math.round(m.growth * 10) / 10,
      debtToEquity: m.debtToEquity == null ? null : Math.round(m.debtToEquity * 100) / 100,
      currentRatio: m.currentRatio == null ? null : Math.round(m.currentRatio * 100) / 100,
      quickRatio: m.quickRatio == null ? null : Math.round(m.quickRatio * 100) / 100,
      dividendYield: m.dividendYield == null ? null : Math.round(m.dividendYield * 100) / 100,
      eps: m.eps == null ? null : Math.round(m.eps * 100) / 100,
      bookValue: m.bookValue == null ? null : Math.round(m.bookValue * 100) / 100,
      beta: m.beta == null ? null : Math.round(m.beta * 100) / 100,
      fiftyTwoWeekHigh: m.fiftyTwoWeekHigh == null ? null : Math.round(m.fiftyTwoWeekHigh * 100) / 100,
      fiftyTwoWeekLow: m.fiftyTwoWeekLow == null ? null : Math.round(m.fiftyTwoWeekLow * 100) / 100,
      avgVolume: m.avgVolume,
      promoterHolding: m.promoterHolding == null ? null : Math.round(m.promoterHolding),
      fiiHolding: m.fiiHolding == null ? null : Math.round(m.fiiHolding),
    },
    screens,
    financials: opts.financials ?? null,
    management: null,
    peers: opts.peers ?? [],
    reports: opts.reports ?? (opts.quarterEnd == null ? null : reportLinks(symbol, name ?? symbol, opts.quarterEnd)),
    opinion: buildOpinion(m, verdict, screens, price),
    verdict,
  };
}