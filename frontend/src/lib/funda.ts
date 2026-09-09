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
// Screener is the authoritative public source for Indian fundamentals. Its
// company pages expose per-year P&L, Balance Sheet and ratio tables plus a top
// ratio strip (Market Cap, P/E, Book Value, Dividend Yield, ROCE, ROE, ...).
// Not every ratio has its own row for every company — Lodha shows only ROCE in
// the ratios table — so the missing critical ratios (ROE, ROA, net margin,
// growth, D/E, ...) are COMPUTED from the same Screener P&L / Balance Sheet,
// guaranteeing they are present and correct even when Yahoo has no data.
// Bank NPA is gated behind premium on Screener, so for banks/NBFCs we pull the
// quarterly NPA block from Finology (ticker.finology.in), which is public.

export type ConsolidationView = 'consolidated' | 'standalone';

export interface ScreenerRange {
  label: string;
  y10: number | null;
  y5: number | null;
  y3: number | null;
  y1: number | null;
}

export interface ScreenerTable {
  years: string[];
  rows: { label: string; values: (number | null)[] }[];
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
  interestCoverage: number | null;
  eps: number | null;
  sales: number | null;
  netProfit: number | null;
  netWorth: number | null;
  totalDebt: number | null;
  byYear: ScreenerYearMetrics[];
}

export interface ScreenerView {
  kind: ConsolidationView;
  exists: boolean;
  snapshot: {
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
  };
  pl: ScreenerTable | null;
  bs: ScreenerTable | null;
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

export interface ScreenerFundamentals {
  symbol: string;
  name: string | null;
  broadSector: string | null;
  sector: string | null;
  industry: string | null;
  defaultView: ConsolidationView;
  views: Partial<Record<ConsolidationView, ScreenerView>>;
  bank: ScreenerBankRatios | null;
}

const deEnt = (s: string): string =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');

/** Pull the number out of a Screener cell (Indian comma grouping, % signs, rupee glyphs). */
function scrNum(text: string): number | null {
  const span = text.match(/<span class="number">([^<]*)<\/span>/);
  const raw = deEnt(span ? span[1] : text.replace(/<[^>]+>/g, ''));
  const m = raw.replace(/[,\s\u00a0]/g, '').match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

function parseScreenerTable(html: string, sectionId: string): ScreenerTable | null {
  const start = html.indexOf(`id="${sectionId}"`);
  if (start < 0) return null;
  const tableStart = html.indexOf('<table', start);
  if (tableStart < 0) return null;
  const tableEnd = html.indexOf('</table>', tableStart);
  if (tableEnd < 0) return null;
  const seg = html.slice(tableStart, tableEnd);

  // capture open-tag attrs (data-date-key) AND content
  const cellRe = /<t[dh]((?:"[^"]*"|[^"'>])*)>([\s\S]*?)<\/t[dh]>/g;
  const theadM = seg.match(/<thead>([\s\S]*?)<\/thead>/);
  const headers = theadM ? [...theadM[1].matchAll(cellRe)].map((c) => ({ attrs: c[1], content: c[2] })) : [];
  const years: string[] = [];
  for (let i = 1; i < headers.length; i += 1) {
    const dk = headers[i].attrs.match(/data-date-key="([^"]+)"/);
    const txt = deEnt(headers[i].content.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
    years.push(dk ? dk[1] : txt);
  }

  const bodyM = seg.match(/<tbody>([\s\S]*?)<\/tbody>/);
  if (!bodyM) return null;
  const rows: ScreenerTable['rows'] = [];
  for (const rm of bodyM[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells2 = [...rm[1].matchAll(cellRe)].map((c) => ({ attrs: c[1], content: c[2] }));
    if (!cells2.length) continue;
    const label = deEnt(cells2[0].content.replace(/<[^>]+>/g, '')).replace(/\+$/, '').replace(/\s+/g, ' ').trim();
    if (!label) continue;
    const values: (number | null)[] = [];
    for (let i = 1; i < cells2.length; i += 1) values.push(scrNum(cells2[i].content));
    rows.push({ label, values });
  }
  return { years, rows };
}

function parseScreenerStrip(html: string): ScreenerView['snapshot'] {
  const out: ScreenerView['snapshot'] = {
    price: null, marketCap: null, pe: null, pb: null, bookValue: null,
    dividendYield: null, roce: null, roe: null, faceValue: null, high: null, low: null,
  };
  const start = html.indexOf('<ul id="top-ratios">');
  if (start < 0) return out;
  const end = html.indexOf('</ul>', start);
  if (end < 0) return out;
  const seg = html.slice(start, end);
  for (const li of seg.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)) {
    const block = li[1];
    const nameM = block.match(/<span class="name">([\s\S]*?)<\/span>/);
    const valueM = block.match(/<span class="nowrap value">([\s\S]*)$/);
    if (!nameM) continue;
    const nameTxt = deEnt(nameM[1]).replace(/\s+/g, ' ').trim();
    const valueBlock = valueM ? valueM[1] : block;
    const nums = [...valueBlock.matchAll(/<span class="number">([^<]*)<\/span>/g)].map((m) => Number(m[1].replace(/[,\s]/g, '')));
    const key = nameTxt.toLowerCase();
    const nn = (i: number) => (nums.length > i ? nums[i] : null);
    if (key.includes('market cap')) out.marketCap = nn(0);
    else if (key.includes('current price')) out.price = nn(0);
    else if (key.includes('high / low')) { out.high = nn(0); out.low = nn(1); }
    else if (key.includes('stock p/e') || key.startsWith('p/e')) out.pe = nn(0);
    else if (key.includes('stock p/b') || key.includes('p/b')) out.pb = nn(0);
    else if (key.includes('book value')) out.bookValue = nn(0);
    else if (key.includes('dividend yield')) out.dividendYield = nn(0);
    else if (key.trim().toLowerCase() === 'roce') out.roce = nn(0);
    else if (key.trim().toLowerCase() === 'roe') out.roe = nn(0);
    else if (key.includes('face value')) out.faceValue = nn(0);
  }
  if (out.pe == null && out.bookValue != null && out.bookValue > 0 && out.price != null && out.price > 0) {
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
    if (!label || label.toLowerCase().startsWith('compounded')) continue; // sales/profit CAGR handled elsewhere
    const val = (key: string): number | null => {
      const rm = b.match(new RegExp(`<td>\\s*${key}\\s*</td>\\s*<td[^>]*>([\\s\\S]*?)<\\/td>`));
      return rm ? scrNum(rm[1]) : null;
    };
    if (label.toLowerCase().includes('price cagr')) continue;
    out.push({
      label,
      y10: val('10 Years:'),
      y5: val('5 Years:'),
      y3: val('3 Years:'),
      y1: val('Last Year:') ?? val('1 Year:'),
    });
  }
  return out;
}

function rigFromTable(t: ScreenerTable | null): Map<string, (number | null)[]> {
  const map = new Map<string, (number | null)[]>();
  if (!t) return map;
  for (const r of t.rows) map.set(r.label.toLowerCase().replace(/\+$/, '').trim(), r.values);
  return map;
}

function deriveScreener(view: (ScreenerTable | null)[]): ScreenerDerived | null {
  const [pl, bs, ratios] = view;
  const plMap = rigFromTable(pl);
  const bsMap = rigFromTable(bs);
  const rtMap = rigFromTable(ratios);
  const years = pl?.years ?? bs?.years ?? [];
  const fiscal = years.filter((y) => /^\d{4}-\d{2}-\d{2}$/.test(y));
  const n = years.length;
  if (!n) return null;

  const at = (map: Map<string, (number | null)[]>, key: string, i: number): number | null => {
    const v = map.get(key);
    return v && i < v.length ? v[i] : null;
  };
  const atc = (map: Map<string, (number | null)[]>, needle: string, i: number): number | null => {
    for (const [k, v] of map) if (k.includes(needle) && i < v.length) return v[i];
    return null;
  };

  const byYear: ScreenerYearMetrics[] = [];
  for (let i = 0; i < n; i += 1) {
    const sales = atc(plMap, 'sales', i);
    const opProfit = atc(plMap, 'operating profit', i);
    const opmRow = atc(plMap, 'opm %', i);
    const netProfit = atc(plMap, 'net profit', i);
    const npmRow = atc(plMap, 'npm %', i);
    const eps = atc(plMap, 'eps in rs', i);
    const eqCap = atc(bsMap, 'equity capital', i);
    const reserves = atc(bsMap, 'reserves', i);
    const borrowings = atc(bsMap, 'borrowings', i);
    const totalAssets = atc(bsMap, 'total assets', i);
    const netWorth = eqCap != null && reserves != null ? eqCap + reserves : (atc(bsMap, 'net worth', i) ?? null);
    const totalDebt = borrowings ?? atc(bsMap, 'total debt', i) ?? null;
    const roe = netProfit != null && netWorth != null && netWorth !== 0 ? (netProfit / netWorth) * 100 : null;
    const roce =
      opProfit != null && netWorth != null && totalDebt != null && netWorth + totalDebt !== 0
        ? (opProfit / (netWorth + totalDebt)) * 100
        : null;
    const roa = netProfit != null && totalAssets != null && totalAssets !== 0 ? (netProfit / totalAssets) * 100 : null;
    const netMargin = npmRow ?? (netProfit != null && sales != null && sales !== 0 ? (netProfit / sales) * 100 : null);
    const operatingMargin = opmRow ?? (opProfit != null && sales != null && sales !== 0 ? (opProfit / sales) * 100 : null);
    byYear.push({ year: years[i], sales, netProfit, netWorth, totalDebt, totalAssets, roe, roce, roa, netMargin, operatingMargin, eps });
  }

  const lastF = fiscal[fiscal.length - 1];
  const prevF = fiscal[fiscal.length - 2];
  const li = lastF != null ? years.indexOf(lastF) : n - 1;
  const pi = prevF != null ? years.indexOf(prevF) : li - 1;
  const l = byYear[li] ?? byYear[byYear.length - 1];
  const p = pi >= 0 ? byYear[pi] : undefined;
  const g = (cur: number | null, prv: number | null): number | null =>
    cur != null && prv != null && prv !== 0 ? ((cur - prv) / Math.abs(prv)) * 100 : null;

  const latest = (key: string): number | null => {
    const v = rtMap.get(key);
    if (v) {
      for (let i = v.length - 1; i >= 0; i -= 1) if (v[i] != null) return v[i];
    }
    return null;
  };

  const overdue = (key: string): number | null => {
    const v = rtMap.get(key);
    if (!v) return null;
    const fi = fiscal.length ? years.indexOf(fiscal[fiscal.length - 1]) : v.length - 1;
    return v[fi] ?? null;
  };

  return {
    latestYear: lastF ?? years[li],
    roe: l?.roe ?? overdue('roe %'),
    roce: l?.roce ?? overdue('roce %'),
    roa: l?.roa ?? overdue('roa %'),
    netMargin: l?.netMargin ?? null,
    operatingMargin: l?.operatingMargin ?? null,
    revenueGrowth: g(l?.sales ?? null, p?.sales ?? null),
    earningsGrowth: g(l?.netProfit ?? null, p?.netProfit ?? null),
    debtToEquity: (() => {
      const d = latest('debt to equity');
      if (d != null) return d;
      const de = l?.netWorth != null && l?.netWorth !== 0 && l?.totalDebt != null ? l.totalDebt / l.netWorth : null;
      return de != null ? de : null;
    })(),
    currentRatio: (() => {
      const crRow = latest('current ratio');
      if (crRow != null) return crRow;
      const ca = atc(bsMap, 'current assets', li);
      const cl = atc(bsMap, 'current liabilities', li);
      return ca != null && cl != null && cl !== 0 ? ca / cl : null;
    })(),
    interestCoverage: (() => {
      const ic = latest('interest coverage');
      if (ic != null) return ic;
      const op = at(plMap, 'operating profit', li);
      const intr = at(plMap, 'interest', li);
      return op != null && intr != null && intr !== 0 ? op / intr : null;
    })(),
    eps: at(plMap, 'eps in rs', li) ?? null,
    sales: l?.sales ?? null,
    netProfit: l?.netProfit ?? null,
    netWorth: l?.netWorth ?? null,
    totalDebt: l?.totalDebt ?? null,
    byYear,
  };
}

function parseScreenerView(html: string, kind: ConsolidationView): ScreenerView | null {
  const strip = parseScreenerStrip(html);
  const ratios = parseScreenerTable(html, 'ratios');
  const pl = parseScreenerTable(html, 'profit-loss');
  const bs = parseScreenerTable(html, 'balance-sheet');
  const ranges = parseRanges(html);
  const derived = deriveScreener([pl, bs, ratios]);
  const view: ScreenerView = { kind, exists: true, snapshot: strip, pl, bs, ratios, ranges, derived };
  return view;
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

/** Full Screener fundamentals for a symbol — consolidated + standalone views. */
export async function fetchScreenerFundamentals(symbol: string): Promise<ScreenerFundamentals | null> {
  const page = `https://www.screener.in/company/${encodeURIComponent(symbol)}/`;
  const [consH, stdH] = await Promise.all([
    screenerViewFetch(`${page}consolidated/`),
    screenerViewFetch(`${page}standalone/`),
  ]);
  const consolidated = consH ? parseScreenerView(consH, 'consolidated') : null;
  const standalone = stdH ? parseScreenerView(stdH, 'standalone') : null;
  if (!consolidated && !standalone) return null;

  const src = consH ?? stdH ?? '';
  const sector = src.match(/title="Sector">([^<]+)<\/a>/)?.[1]?.trim() ?? null;
  const industry = src.match(/title="Industry">([^<]+)<\/a>/)?.[1]?.trim() ?? null;
  const broad =
    src.match(/title="Broad Sector">([^<]+)<\/a>/)?.[1]?.trim() ??
    src.match(/title="Broad Industry">([^<]+)<\/a>/)?.[1]?.trim() ??
    null;
  const brand = src.match(/<span class="min-width-0 overflow-wrap-anywhere">([\s\S]*?)<\/span>/)?.[1]?.replace(/<[^>]+>/g, '').trim() ?? null;
  const name = brand ?? null;
  const defaultView: ConsolidationView = consolidated ? 'consolidated' : 'standalone';

  return {
    symbol,
    name,
    broadSector: broad,
    sector,
    industry,
    defaultView,
    views: {
      ...(consolidated ? { consolidated } : {}),
      ...(standalone ? { standalone } : {}),
    },
    bank: null,
  };
}

// ---- Bank / NBFC NPA from Finology (public), Screener gates it behind premium --

const FINOLOGY_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function isBankingSector(sector: string | null, industry: string | null): boolean {
  const s = `${sector ?? ''} ${industry ?? ''}`.toLowerCase();
  return s.includes('bank') || s.includes('nbfc') || s.includes('housing finance') || s.includes('financial services');
}

/** Pull quarterly Gross NPA / Net NPA / ROA / NPM for a bank from Finology. */
export async function fetchFinologyBankRatios(symbol: string): Promise<ScreenerBankRatios | null> {
  try {
    const res = await fetch(`https://ticker.finology.in/company/${encodeURIComponent(symbol)}`, {
      headers: { 'User-Agent': FINOLOGY_UA, Accept: 'text/html,application/xhtml+xml' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const html = await res.text();
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
        if (v != null) { value = v; break; }
      }
      if (label === 'gross npa %') out.grossNpa = value;
      else if (label === 'net npa %') out.netNpa = value;
      else if (label === 'return on assets %') out.roa = value;
      else if (label === 'npm %') out.npm = value;
    }
    return out.grossNpa == null && out.netNpa == null ? null : out;
  } catch {
    return null;
  }
}

/** Best-effort full fundamentals (Screener ratios + Finology bank NPA). */
export async function fetchRealFundamentals(symbol: string): Promise<ScreenerFundamentals | null> {
  const sf = await fetchScreenerFundamentals(symbol);
  if (sf && isBankingSector(sf.sector, sf.industry)) {
    sf.bank = await fetchFinologyBankRatios(symbol);
  }
  return sf;
}

/** Fill legacy Metrics with authoritative Screener-derived values (in place). */
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
  if (s.marketCap != null) m.marketCap = s.marketCap;
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
    if (d.roe != null) m.roe = d.roe;
    if (d.roce != null) m.roce = d.roce;
    if (d.roa != null) m.roa = d.roa;
    if (d.netMargin != null) m.netMargin = d.netMargin;
    if (d.operatingMargin != null) m.operatingMargin = d.operatingMargin;
    if (d.revenueGrowth != null) m.revenueGrowth = d.revenueGrowth;
    if (d.earningsGrowth != null) m.earningsGrowth = d.earningsGrowth;
    if (d.debtToEquity != null) m.debtToEquity = d.debtToEquity;
    if (d.currentRatio != null) m.currentRatio = d.currentRatio;
    if (d.eps != null) m.eps = d.eps;
    m.growth = d.earningsGrowth ?? m.growth ?? d.revenueGrowth;
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
  m.growth = m.earningsGrowth ?? m.revenueGrowth;
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