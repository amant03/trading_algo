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