// Shared fundamentals + analyst model engine.
//
// Pure, dependency-free TS used by THREE runtimes:
//   - scripts/ci/fundamentals.ts  (nightly batch, DB-rich)
//   - frontend/api/funda.ts       (on-demand relay, any symbol)
//   - (built into the static bundle nowhere â€” this file has no DOM/Vite deps)
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
// peer-comparison table is served from /api/company/{warehouseId}/peers/ â€” the
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

// ---- Screens -------------------------------------------------------------

export function buffettScreen(m: Metrics): Screen {
  const flags: string[] = [];
  let score = 40;
  const roe = m.roe;
  if (roe == null) flags.push('ROE data missing');
  else if (roe >= 20) { score += 20; flags.push(`ROE ${roe.toFixed(1)}% â€” exceptional`) }
  else if (roe >= 15) { score += 15; flags.push(`ROE ${roe.toFixed(1)}% â€” strong`) }
  else if (roe >= 10) { score += 8; flags.push(`ROE ${roe.toFixed(1)}% â€” adequate`) }
  else if (roe < 10) { score -= 12; flags.push(`ROE ${roe.toFixed(1)}% â€” weak`) }

  const margin = m.netMargin;
  if (margin == null) flags.push('margin data missing');
  else {
    if (margin >= 15) { score += 15; flags.push(`Net margin ${margin.toFixed(1)}% â€” pricing power / moat`) }
    else if (margin >= 10) { score += 10 }
    else if (margin >= 5) { score += 5 }
    else { score -= 8; flags.push(`Net margin ${margin.toFixed(1)}% â€” thin`) }
  }

  const de = m.debtToEquity;
  if (de == null) flags.push('debt data missing');
  else {
    if (de <= 0.5) { score += 15; flags.push(`D/E ${de.toFixed(2)} â€” low leverage`) }
    else if (de <= 1) { score += 10 }
    else if (de <= 2) { score += 4 }
    else { score -= 8; flags.push(`D/E ${de.toFixed(2)} â€” high leverage`) }
  }

  if ((m.revenueGrowth ?? 0) > 0) score += 5;
  if ((m.earningsGrowth ?? 0) > 0) score += 5;
  if ((m.dividendYield ?? 0) > 0) flags.push(`Pays dividend (${m.dividendYield!.toFixed(2)}%)`);

  score = Math.max(0, Math.min(100, Math.round(score)));
  const thesis =
    score >= 72
      ? 'Classic Buffett compounder: high returns on equity, fat margins, low debt.'
      : score >= 48
        ? 'Decent quality â€” capable of compounding, but not the full Buffett checklist.'
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
      thesis: 'Not classifiable â€” loss-making or no earnings, a turnaround/asset play risk.',
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
  flags.push(`${classification}, growth â‰ˆ ${growth.toFixed(1)}%`);
  const safeG = Math.max(growth, 1);
  const peg = pe / safeG;
  flags.push(peg <= 1 ? `PEG ${peg.toFixed(2)} â€” cheapest vs growth` : peg <= 2 ? `PEG ${peg.toFixed(2)} â€” fairly priced` : `PEG ${peg.toFixed(2)} â€” pricey vs growth`);

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
        ? `Fairly valued ${classification.toLowerCase()} â€” adequate but no bargain.`
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

  if (m.pe != null && m.pe <= 15 && m.pe > 0) { score += 14; flags.push('P/E â‰¤ 15 (defensive)') }
  else if (m.pe != null && m.pe > 0) flags.push(`P/E ${m.pe.toFixed(1)} â€” above defensive ceiling`);
  if (m.pb != null && m.pb <= 1.5) { score += 14; flags.push('P/B â‰¤ 1.5 (defensive)') }
  else if (m.pb != null) flags.push(`P/B ${m.pb.toFixed(1)} â€” not bargain territory`);
  if (m.currentRatio != null && m.currentRatio >= 2) { score += 14; flags.push('Current ratio â‰¥ 2') }
  if (m.debtToEquity != null && m.debtToEquity <= 1) { score += 14; flags.push('Leverage within Graham limits') }
  if (grahamValue != null && price > 0) {
    const mos = (grahamValue - price) / price;
    if (mos >= 0.15) { score += 14; flags.push(`~${Math.round(mos * 100)}% margin of safety vs Graham number`) }
    else if (mos >= 0) { score += 6; flags.push(`Near Graham value (â‚¹${grahamValue.toFixed(0)})`) }
    else flags.push(`Above Graham number â‚¹${grahamValue.toFixed(0)}`);
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const thesis =
    grahamValue != null
      ? score >= 72
        ? 'Graham defensive buy â€” cheap on earnings and assets with a margin of safety.'
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
    `Fair value â‚¹${Math.round(fairMid).toLocaleString('en-IN')} vs â‚¹${Math.round(price).toLocaleString('en-IN')} ` +
    `(${moS >= 0 ? '+' : ''}${moS}% margin of safety). ` +
    `Buffett ${buffett.grade} Â· Lynch ${lynch.grade} Â· Graham ${graham.grade}.`;

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
    summary: name ? `${name} â€” ${summary}` : summary,
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
  bits.push(`Blended valuation score ${score}/100 ("${rating}") with fair value â‰ˆ â‚¹${Math.round(fairValueMid).toLocaleString('en-IN')} vs price â‚¹${Math.round(price).toLocaleString('en-IN')} â€” ${mos >= 0 ? '+' : ''}${mos}% margin of safety.`);
  const drv: string[] = [];
  if (m.roe != null) drv.push(`ROE ${m.roe.toFixed(1)}%`);
  if (m.netMargin != null) drv.push(`net margin ${m.netMargin.toFixed(1)}%`);
  if (m.debtToEquity != null) drv.push(`D/E ${m.debtToEquity.toFixed(2)}`);
  if (m.earningsGrowth != null) drv.push(`earnings growth ${m.earningsGrowth.toFixed(1)}%`);
  if (m.revenueGrowth != null) drv.push(`revenue growth ${m.revenueGrowth.toFixed(1)}%`);
  if (m.dividendYield != null) drv.push(`yield ${m.dividendYield.toFixed(2)}%`);
  if (drv.length) bits.push(`Key inputs: ${drv.join(', ')}.`);
  bits.push(`Screens â€” Buffett ${screens.buffett.grade} Â· Lynch ${screens.lynch.grade} Â· Graham ${screens.graham.grade}.`);

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
        { label: 'Screener â€” quarterly financials', url: `https://www.screener.in/company/${symbol}/#quarters`, kind: 'financials' },
        { label: 'Search latest quarter results', url: qSearch, kind: 'search' },
      ],
    },
    annual: {
      label: 'Latest annual',
      period: null,
      links: [
        { label: 'Screener â€” annual financials', url: `https://www.screener.in/company/${symbol}/`, kind: 'financials' },
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
    management: null,
    peers: opts.peers ?? [],
    reports: opts.reports ?? (opts.quarterEnd == null ? null : reportLinks(symbol, name ?? symbol, opts.quarterEnd)),
    opinion: buildOpinion(m, verdict, screens, price),
    verdict,
  };
}
// ----------------------------------------------------------------------
// NOTE: this handler is self-contained on purpose. Vercel compiles each api/*.ts
// as its OWN function and does NOT bundle relative imports, so any
// import ... from './x' (or from '../src/...') makes the emitted lambda crash
// with an instant empty 500. The full fundamentals engine from
// src/lib/funda.ts is inlined below; keep the two in sync.
// ----------------------------------------------------------------------
// On-demand fundamentals + analyst model relay.
//
// Computes the same analysis that the nightly batch produces
// (`scripts/ci/fundamentals.ts` -> analysis.json) for ANY symbol, live, using
// free Yahoo quoteSummary data. Results are cached in-memory for 6h (~once a
// day, matching the "ratios refresh daily, prices keep streaming" model) and
// merged into the frontend store, so watchlisted/viewed stocks get full
// fundamentals/AI-data without waiting for the nightly run â€” while prices keep
// updating through /api/live and /api/chart as usual.
//
// GET /api/funda?symbols=RELIANCE,TCS   (comma list, max 8)

interface UniverseRow {
  symbol: string;
  name: string;
  cap: string | null;
  mktCap: number | null;
}

// NOTE: kept self-contained (no `import ... from './chart'`) â€” Vercel builds
// every api/*.ts as its own function, and cross-function imports break the
// emitted lambdas at runtime (instant 500).
const NSE_UNIVERSE: { symbol: string; name: string; sector: string }[] = [
  { symbol: 'RELIANCE', name: 'Reliance Industries Ltd', sector: 'Energy' },
  { symbol: 'TCS', name: 'Tata Consultancy Services Ltd', sector: 'IT' },
  { symbol: 'HDFCBANK', name: 'HDFC Bank Ltd', sector: 'Banking' },
  { symbol: 'ICICIBANK', name: 'ICICI Bank Ltd', sector: 'Banking' },
  { symbol: 'INFY', name: 'Infosys Ltd', sector: 'IT' },
  { symbol: 'ITC', name: 'ITC Ltd', sector: 'FMCG' },
  { symbol: 'BHARTIARTL', name: 'Bharti Airtel Ltd', sector: 'Telecom' },
  { symbol: 'SBIN', name: 'State Bank of India', sector: 'Banking' },
  { symbol: 'KOTAKBANK', name: 'Kotak Mahindra Bank Ltd', sector: 'Banking' },
  { symbol: 'AXISBANK', name: 'Axis Bank Ltd', sector: 'Banking' },
  { symbol: 'LT', name: 'Larsen & Toubro Ltd', sector: 'Capital Goods' },
  { symbol: 'HINDUNILVR', name: 'Hindustan Unilever Ltd', sector: 'FMCG' },
  { symbol: 'SUNPHARMA', name: 'Sun Pharmaceutical Industries', sector: 'Pharma' },
  { symbol: 'BAJFINANCE', name: 'Bajaj Finance Ltd', sector: 'Financials' },
  { symbol: 'MARUTI', name: 'Maruti Suzuki India Ltd', sector: 'Auto' },
  { symbol: 'TITAN', name: 'Titan Company Ltd', sector: 'Consumer' },
  { symbol: 'ASIANPAINT', name: 'Asian Paints Ltd', sector: 'Consumer' },
  { symbol: 'ULTRACEMCO', name: 'UltraTech Cement Ltd', sector: 'Cement' },
  { symbol: 'NTPC', name: 'NTPC Ltd', sector: 'Power' },
  { symbol: 'ADANIENT', name: 'Adani Enterprises Ltd', sector: 'Conglomerate' },
  { symbol: 'ADANIPORTS', name: 'Adani Ports & SEZ Ltd', sector: 'Infrastructure' },
  { symbol: 'POWERGRID', name: 'Power Grid Corp of India', sector: 'Power' },
  { symbol: 'ONGC', name: 'Oil & Natural Gas Corp Ltd', sector: 'Energy' },
  { symbol: 'TATAMOTORS', name: 'Tata Motors Ltd', sector: 'Auto' },
  { symbol: 'TATASTEEL', name: 'Tata Steel Ltd', sector: 'Metals' },
  { symbol: 'JSWSTEEL', name: 'JSW Steel Ltd', sector: 'Metals' },
  { symbol: 'WIPRO', name: 'Wipro Ltd', sector: 'IT' },
  { symbol: 'TECHM', name: 'Tech Mahindra Ltd', sector: 'IT' },
  { symbol: 'HCLTECH', name: 'HCL Technologies Ltd', sector: 'IT' },
  { symbol: 'NESTLEIND', name: 'Nestle India Ltd', sector: 'FMCG' },
  { symbol: 'M&M', name: 'Mahindra & Mahindra Ltd', sector: 'Auto' },
  { symbol: 'TATACONSUM', name: 'Tata Consumer Products Ltd', sector: 'FMCG' },
  { symbol: 'BAJAJFINSV', name: 'Bajaj Finserv Ltd', sector: 'Financials' },
  { symbol: 'HDFCLIFE', name: 'HDFC Life Insurance Co', sector: 'Insurance' },
  { symbol: 'SBILIFE', name: 'SBI Life Insurance Co', sector: 'Insurance' },
  { symbol: 'DRREDDY', name: "Dr. Reddy's Laboratories Ltd", sector: 'Pharma' },
  { symbol: 'CIPLA', name: 'Cipla Ltd', sector: 'Pharma' },
  { symbol: 'APOLLOHOSP', name: 'Apollo Hospitals Enterprise', sector: 'Healthcare' },
  { symbol: 'GRASIM', name: 'Grasim Industries Ltd', sector: 'Cement' },
  { symbol: 'HINDALCO', name: 'Hindalco Industries Ltd', sector: 'Metals' },
  { symbol: 'BPCL', name: 'Bharat Petroleum Corp Ltd', sector: 'Energy' },
  { symbol: 'COALINDIA', name: 'Coal India Ltd', sector: 'Energy' },
  { symbol: 'EICHERMOT', name: 'Eicher Motors Ltd', sector: 'Auto' },
  { symbol: 'HEROMOTOCO', name: 'Hero MotoCorp Ltd', sector: 'Auto' },
  { symbol: 'INDUSINDBK', name: 'IndusInd Bank Ltd', sector: 'Banking' },
  { symbol: 'BRITANNIA', name: 'Britannia Industries Ltd', sector: 'FMCG' },
  { symbol: 'DIVISLAB', name: "Divi's Laboratories Ltd", sector: 'Pharma' },
  { symbol: 'BAJAJ-AUTO', name: 'Bajaj Auto Ltd', sector: 'Auto' },
  { symbol: 'TATAPOWER', name: 'Tata Power Co Ltd', sector: 'Power' },
  { symbol: 'IRCTC', name: 'Indian Railway Catering & Tourism Corp', sector: 'Travel' },
  { symbol: 'IDEA', name: 'Vodafone Idea Ltd', sector: 'Telecom' },
  { symbol: 'HAL', name: 'Hindustan Aeronautics Ltd', sector: 'Defence' },
];

function jsonHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store, max-age=0',
    'Access-Control-Allow-Origin': '*',
  };
}

const TTL_MS = 6 * 3600 * 1000;
const cache = new Map<string, { at: number; hash: string }>();

const SYM_RE = /^[A-Z0-9&-]{1,20}$/;

function lastHash(entries: string[]): string {
  return [...entries].sort().join(',');
}

async function loadUniverse(base: string): Promise<Map<string, UniverseRow>> {
  const map = new Map<string, UniverseRow>();
  try {
    const res = await fetch(`${base}/universe.json`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return map;
    const data = (await res.json()) as { stocks?: UniverseRow[] };
    for (const u of data.stocks ?? []) {
      if (u?.symbol) map.set(u.symbol, u);
    }
  } catch {
    // universe unavailable â€” peers fall back to the NSE seed
  }
  return map;
}

async function peersFor(
  symbol: string,
  universe: Map<string, UniverseRow>,
): Promise<{ symbol: string; name: string | null; industry: null; sector: string | null }[]> {
  // Real competitors from Screener.in's peer table first.
  try {
    const scr = await screenerPeers(symbol);
    if (scr.length) {
      return scr.slice(0, 8).map((p) => {
        const u = universe.get(p);
        return { symbol: p, name: u?.name ?? null, industry: null as null, sector: u?.cap ?? null };
      });
    }
  } catch {
    // fall through to market-cap proximity
  }
  const me = universe.get(symbol);
  if (!me) {
    return NSE_UNIVERSE.filter((s) => s.symbol !== symbol)
      .slice(0, 6)
      .map((s) => ({ symbol: s.symbol, name: s.name, industry: null as null, sector: s.sector }));
  }
  const sameCap = [...universe.values()]
    .filter((u) => u.symbol !== symbol && (u.cap ?? '') === (me.cap ?? ''))
    .sort((a, b) => Math.abs((a.mktCap ?? 0) - (me.mktCap ?? 0)) - Math.abs((b.mktCap ?? 0) - (me.mktCap ?? 0)));
  return (sameCap.length ? sameCap : [...universe.values()].filter((u) => u.symbol !== symbol))
    .slice(0, 6)
    .map((u) => ({ symbol: u.symbol, name: u.name, industry: null as null, sector: u.cap ?? null }));
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const raw = (url.searchParams.get('symbols') ?? url.searchParams.get('symbol') ?? '')
    .toUpperCase()
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => SYM_RE.test(s));
  const uniq: string[] = [...new Set(raw)].slice(0, 8);

  if (!uniq.length) {
    return new Response(JSON.stringify({ error: 'missing or invalid symbols' }), {
      status: 400,
      headers: jsonHeaders(),
    });
  }

  const need = uniq.filter((s) => !cache.has(s));
  if (need.length) {
    const yahoo = await makeYahoo();
    const base = url.origin;
    const universe = await loadUniverse(base);
    await Promise.all(
      need.map(async (sym) => {
        const m = emptyMetrics(sym, { name: NSE_UNIVERSE.find((s) => s.symbol === sym)?.name ?? sym });
        const yahooData = await yahoo.quoteSummary(`${sym}.NS`);
        applyYahoo(m, yahooData);
        const entry = buildEntry({
          symbol: sym,
          name: m.name ?? sym,
          m,
          price: m.price,
          peers: await peersFor(sym, universe),
          quarterEnd: extractCompanion(yahooData).quarterEnd,
        });
        cache.set(sym, { at: Date.now(), hash: JSON.stringify(entry) });
      }),
    );
  }

  const stocks: Record<string, unknown> = {};
  let stale = 0;
  for (const sym of uniq) {
    const hit = cache.get(sym);
    if (!hit) continue;
    if (Date.now() - hit.at > TTL_MS) {
      stale += 1;
      cache.delete(sym);
      continue;
    }
    try {
      stocks[sym] = JSON.parse(hit.hash);
    } catch {
      // skip corrupt cache entry
    }
  }

  if (!Object.keys(stocks).length) {
    return new Response(JSON.stringify({ error: 'fundamentals unavailable for symbols' }), {
      status: 404,
      headers: jsonHeaders(),
    });
  }

  return new Response(
    JSON.stringify({ generatedAt: new Date().toISOString(), staleSkipped: stale, stocks }),
    { status: 200, headers: jsonHeaders() },
  );
}