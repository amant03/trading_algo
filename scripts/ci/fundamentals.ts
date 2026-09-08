// Deep fundamentals + analyst model.
//
// Pulls real company data from Yahoo Finance quoteSummary for every NSE symbol
// (crumb-authenticated), overlays it on the DB fundamentals, then scores each
// stock with three classic discipline screens:
//   - Warren Buffett: quality compounder (high ROE, fat margins, low debt)
//   - Peter Lynch:  growth-at-a-reasonable-price (PEG, fair P/E ~ growth rate)
//   - Benjamin Graham: value + margin of safety (defensive criteria, Graham
//     number = sqrt(22.5 * EPS * BVPS))
// Blends them into an overall rating + fair-value band and writes
// `frontend/public/analysis.json` (bundled into the UI snapshot).
//
// Best-effort: if Yahoo is unreachable the screens still run on the DB
// fundamentals and the file is marked source='db'.

import { pool } from '@trading/shared';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { INSTRUMENTS as SEED } from '../../services/shared/src/instruments-data.js';

const num = (v: unknown): number | null => {
  if (typeof v === 'number' && isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && isFinite(Number(v))) return Number(v);
  return null;
};

// ---- Yahoo quoteSummary (needs crumb cookie dance) ---------------------

interface YahooClient {
  quoteSummary: (symbol: string) => Promise<Record<string, any> | null>;
  ok: boolean;
}

async function makeYahoo(): Promise<YahooClient> {
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
          `?modules=summaryDetail,defaultKeyStatistics,financialData,summaryProfile,earnings,esgScores&crumb=${encodeURIComponent(crumb)}&formatted=false`;
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

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

// ---- Screen implementations ------------------------------------------

type Screen = { score: number; grade: string; thesis: string; flags: string[] };

function gradeFor(score: number): string {
  if (score >= 80) return 'A+';
  if (score >= 72) return 'A';
  if (score >= 64) return 'A-';
  if (score >= 56) return 'B+';
  if (score >= 48) return 'B';
  if (score >= 40) return 'B-';
  if (score >= 32) return 'C+';
  return 'C';
}

// ---- long-term opinion, competition and report links --------------------

type Opinion = {
  horizon: 'lt';
  stance: 'BUY' | 'HOLD' | 'SELL';
  conviction: number;
  thesis: string;
  risks: string[];
};

function buildOpinion(
  m: Metrics,
  verdict: { score: number; marginOfSafety: number; rating: string; fairValueMid: number },
  screens: Record<string, Screen>,
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

function reportLinks(symbol: string, name: string, quarterEnd: string | null): unknown {
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

function buffettScreen(m: Metrics): Screen {
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

function lynchScreen(m: Metrics): Screen {
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

function grahamScreen(m: Metrics, price: number): Screen {
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

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---- Model ------------------------------------------------------------

interface Metrics {
  symbol: string;
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

interface Row {
  symbol: string;
  name: string;
  sector: string | null;
  industry: string | null;
  base_price: number;
  pe: number | null;
  pb: number | null;
  ps: number | null;
  peg: number | null;
  roe: number | null;
  roce: number | null;
  roa: number | null;
  debt_to_equity: number | null;
  current_ratio: number | null;
  quick_ratio: number | null;
  gross_margin: number | null;
  operating_margin: number | null;
  net_margin: number | null;
  revenue_growth: number | null;
  net_income_growth: number | null;
  dividend_yield: number | null;
  eps: number | null;
  book_value: number | null;
  beta: number | null;
  fifty_two_week_high: number | null;
  fifty_two_week_low: number | null;
  avg_volume: number | null;
  promoter_holding: number | null;
  fii_holding: number | null;
}

function applyYahoo(m: Metrics, y: Record<string, any> | null): { updated: string[] } {
  const touched: string[] = [];
  if (!y?.quoteSummary?.result?.[0]) return { updated: touched };
  const r = y.quoteSummary.result[0];
  const sd = r.summaryDetail ?? {};
  const ks = r.defaultKeyStatistics ?? {};
  const fd = r.financialData ?? {};
  const sp = r.summaryProfile ?? {};
  const pct = (v: unknown) => (num(v) == null ? null : num(v)! * 100);
  const pctRaw = (v: unknown) => (num(v) == null ? null : num(v)); // some fields already in %
  const set = (k: 'pe' | 'pb' | 'ps' | 'roe' | 'roa' | 'netMargin' | 'operatingMargin' | 'grossMargin' | 'revenueGrowth' | 'earningsGrowth' | 'debtToEquity' | 'currentRatio' | 'quickRatio' | 'dividendYield' | 'eps' | 'bookValue' | 'beta' | 'fiftyTwoWeekHigh' | 'fiftyTwoWeekLow' | 'avgVolume' | 'marketCap' | 'peg' | 'promoterHolding' | 'fiiHolding' | 'targetLow' | 'targetMean' | 'targetHigh' | 'analysts' | 'description' | 'sector' | 'industry', v: number | string | null) => {
    if (v != null && v !== '') {
      (m[k] as number | string | null) = v;
      touched.push(k);
    }
  };

  set('marketCap', num(sd.marketCap));
  set('pe', sd.trailingPE != null ? num(sd.trailingPE) : null);
  set('ps', num(sd.priceToSalesTrailing12Months));
  const pb = num(sd.priceToBook);
  set('pb', pb);
  set('beta', num(sd.beta));
  set('fiftyTwoWeekHigh', num(sd.fiftyTwoWeekHigh));
  set('fiftyTwoWeekLow', num(sd.fiftyTwoWeekLow));
  if (num(sd.averageVolume) != null) set('avgVolume', num(sd.averageVolume)!);
  set('dividendYield', pct(sd.dividendYield));
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
  if (num(sd.fiftyTwoWeekHigh) != null) set('fiftyTwoWeekHigh', num(sd.fiftyTwoWeekHigh)!);
  if (num(sd.fiftyTwoWeekLow) != null) set('fiftyTwoWeekLow', num(sd.fiftyTwoWeekLow)!);

  // fill gaps with derived values
  if (m.bookValue != null && m.bookValue > 0 && m.price > 0 && m.pb == null) {
    set('pb', m.price / m.bookValue);
    touched.push('pb(derived)');
  }
  if (m.growth == null) m.growth = m.revenueGrowth;
  return { updated: touched };
}

async function main(): Promise<void> {
  const rowsRes = await pool.query<Row>(
    `SELECT i.symbol, i.name, i.sector, i.industry, i.base_price,
            f.pe, f.pb, f.ps, f.peg, f.roe, f.roce, f.roa, f.debt_to_equity,
            f.current_ratio, f.quick_ratio, f.gross_margin, f.operating_margin,
            f.net_margin, f.revenue_growth, f.net_income_growth, f.dividend_yield,
            f.eps, f.book_value, f.beta, f.fifty_two_week_high, f.fifty_two_week_low,
            f.avg_volume, f.promoter_holding, f.fii_holding
     FROM instruments i
     LEFT JOIN fundamentals f ON f.instrument_id = i.id
     WHERE i.status = 'ACTIVE'
     ORDER BY i.symbol`,
  );
  const rows = rowsRes.rows as Row[];

  // latest daily close per symbol (real NSE data when present)
  const sparkRes = await pool.query<{ symbol: string; ts: Date; close: number }>(
    `SELECT t.symbol, t.ts, t.close FROM (
        SELECT i.symbol, c.ts, c.close,
               ROW_NUMBER() OVER (PARTITION BY c.instrument_id ORDER BY c.ts DESC) rn
        FROM candles c JOIN instruments i ON i.id = c.instrument_id
        WHERE c.timeframe = '1d'
       ) t WHERE t.rn <= 40 ORDER BY t.symbol, t.ts`,
  );
  const spark: Record<string, [number, number][]> = {};
  for (const s of sparkRes.rows) {
    (spark[s.symbol] ??= []).push([new Date(s.ts).getTime(), Number(s.close)]);
  }

  const yahoo = await makeYahoo();
  const yahooPeersPer: Record<string, string[]> = {};
  const quarterEndPer: Record<string, string | null> = {};
  const stocks: Record<string, unknown> = {};
  let yahooTouched = 0;

  for (const r of rows) {
    const price =
      spark[r.symbol]?.length
        ? Number(spark[r.symbol][spark[r.symbol].length - 1][1])
        : Number(r.base_price);
    const m: Metrics = {
      symbol: r.symbol,
      sector: r.sector ?? SEED.find((s) => s.symbol === r.symbol)?.sector ?? null,
      industry: r.industry ?? null,
      price,
      marketCap: r.pe != null ? null : null,
      pe: r.pe == null ? null : Number(r.pe),
      pb: r.pb == null ? null : Number(r.pb),
      ps: r.ps == null ? null : Number(r.ps),
      peg: r.peg == null ? null : Number(r.peg),
      roe: r.roe == null ? null : Number(r.roe),
      roa: r.roa == null ? null : Number(r.roa),
      netMargin: r.net_margin == null ? null : Number(r.net_margin),
      operatingMargin: r.operating_margin == null ? null : Number(r.operating_margin),
      grossMargin: r.gross_margin == null ? null : Number(r.gross_margin),
      revenueGrowth: r.revenue_growth == null ? null : Number(r.revenue_growth),
      earningsGrowth: r.net_income_growth == null ? null : Number(r.net_income_growth),
      growth: null,
      debtToEquity: r.debt_to_equity == null ? null : Number(r.debt_to_equity),
      currentRatio: r.current_ratio == null ? null : Number(r.current_ratio),
      quickRatio: r.quick_ratio == null ? null : Number(r.quick_ratio),
      dividendYield: r.dividend_yield == null ? null : Number(r.dividend_yield),
      eps: r.eps == null ? null : Number(r.eps),
      bookValue: r.book_value == null ? null : Number(r.book_value),
      beta: r.beta == null ? null : Number(r.beta),
      fiftyTwoWeekHigh: r.fifty_two_week_high == null ? null : Number(r.fifty_two_week_high),
      fiftyTwoWeekLow: r.fifty_two_week_low == null ? null : Number(r.fifty_two_week_low),
      avgVolume: r.avg_volume == null ? null : Number(r.avg_volume),
      promoterHolding: r.promoter_holding == null ? null : Number(r.promoter_holding),
      fiiHolding: r.fii_holding == null ? null : Number(r.fii_holding),
      targetLow: null,
      targetMean: null,
      targetHigh: null,
      analysts: null,
      description: null,
    };
    m.growth = m.earningsGrowth ?? m.revenueGrowth;

    let yahooData: Record<string, any> | null = null;
    let yahooPeers: string[] = [];
    let quarterEnd: string | null = null;
    if (yahoo.ok) {
      try {
        yahooData = await yahoo.quoteSummary(`${r.symbol}.NS`);
        const { updated } = applyYahoo(m, yahooData);
        if (updated.length) yahooTouched += 1;
        const res =
          (yahooData?.quoteSummary?.result as Record<string, any>[] | undefined)?.[0] ??
          (yahooData?.quoteSummary?.result as any);
        const list = res?.esgScores?.peers;
        if (Array.isArray(list)) yahooPeers = list.filter((p): p is string => typeof p === 'string');
        const quarterly = res?.earnings?.earningsChart?.quarterly;
        if (Array.isArray(quarterly) && quarterly.length) {
          const d = quarterly[quarterly.length - 1]?.date;
          if (typeof d === 'string') quarterEnd = d;
        }
      } catch {
        yahooData = null;
      }
    }
    yahooPeersPer[r.symbol] = yahooPeers;
    quarterEndPer[r.symbol] = quarterEnd;

    m.growth = m.earningsGrowth ?? m.revenueGrowth;
    const buffett = buffettScreen(m);
    const lynch = lynchScreen(m);
    const graham = grahamScreen(m, price);

    // blended verdict
    const parts: { s: number; w: number }[] = [
      { s: buffett.score, w: 0.45 },
      { s: lynch.score, w: 0.35 },
      { s: graham.score, w: 0.2 },
    ];
    const wsum = parts.reduce((a, p) => a + p.s * p.w, 0);
    const score = Math.round(wsum);
    const grade = gradeFor(score);
    const rating = score >= 72 ? 'Strong Buy' : score >= 58 ? 'Buy' : score >= 44 ? 'Hold' : score >= 32 ? 'Sell' : 'Strong Sell';

    // fair value band
    const estimates = [
      m.targetMean != null && m.targetMean > 0 ? m.targetMean : null,
      m.eps != null && m.eps > 0 && m.growth != null ? m.eps * Math.max(m.growth, 5) * 1.0 : null, // Lynch fair = eps * growth
      m.eps != null && m.bookValue != null && m.eps > 0 && m.bookValue > 0 ? Math.sqrt(22.5 * m.eps * m.bookValue) : null, // Graham number
    ].filter((v): v is number => v != null && v > 0);
    const fairMid = estimates.length ? estimates.reduce((a, b) => a + b, 0) / estimates.length : price;
    const fairLow = estimates.length ? Math.min(...estimates) : fairMid * 0.88;
    const fairHigh = estimates.length ? Math.max(...estimates) : fairMid * 1.12;
    const mos = price > 0 ? (fairMid - price) / price : 0;
    const moS = Math.round(mos * 100);

    stocks[r.symbol] = {
      symbol: r.symbol,
      name: r.symbol, // replaced with real name below from seed
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
      screens: {
        buffett,
        lynch,
        graham,
      },
      verdict: {
        score,
        grade,
        rating,
        fairValueMid: Math.round(fairMid * 100) / 100,
        fairValueLow: Math.round(fairLow * 100) / 100,
        fairValueHigh: Math.round(fairHigh * 100) / 100,
        marginOfSafety: moS,
        targetMean: m.targetMean,
        analysts: m.analysts,
        summary:
          `${r.symbol}: ${rating.toLowerCase()} (${score}/100, ${grade}). ` +
          `Fair value ₹${Math.round(fairMid).toLocaleString('en-IN')} vs ₹${Math.round(price).toLocaleString('en-IN')} ` +
          `(${moS >= 0 ? '+' : ''}${moS}% margin of safety). ` +
          `Buffett ${buffett.grade} · Lynch ${lynch.grade} · Graham ${graham.grade}.`,
      },
      opinion: buildOpinion(
        m,
        { score, marginOfSafety: moS, rating, fairValueMid: fairMid },
        { buffett, lynch, graham },
        price,
      ),
    };
  }

  // enrich with seed metadata (real company names / sectors)
  for (const s of SEED) {
    const entry = stocks[s.symbol] as { name?: string; sector?: string | null } | undefined;
    if (entry) entry.name = s.name;
  }

  // ---- competition (peers) + disclosure reports -------------------------
  const allSyms = new Set(Object.keys(stocks));
  const byIndustry = new Map<string, string[]>();
  const bySector = new Map<string, string[]>();
  const seedName = new Map(SEED.map((s) => [s.symbol, s.name]));
  const seedIndustry = new Map(SEED.map((s) => [s.symbol, s.industry ?? null]));
  const seedSector = new Map(SEED.map((s) => [s.symbol, s.sector]));
  for (const sym of allSyms) {
    const e = stocks[sym] as { industry?: string | null; sector?: string | null };
    const ind = e.industry ?? seedIndustry.get(sym);
    const sec = e.sector ?? seedSector.get(sym);
    if (ind) (byIndustry.get(ind) ?? byIndustry.set(ind, []).get(ind)!).push(sym);
    if (sec) (bySector.get(sec) ?? bySector.set(sec, []).get(sec)!).push(sym);
  }

  for (const sym of allSyms) {
    const e = stocks[sym] as {
      industry?: string | null;
      sector?: string | null;
      name?: string;
      peers?: unknown;
      reports?: unknown;
    };
    const peers = new Set<string>();
    for (const p of yahooPeersPer[sym] ?? []) {
      const clean = p.replace(/\.(NS|NSE|BO)$/i, '').toUpperCase();
      if (allSyms.has(clean)) peers.add(clean);
    }
    const ind = e.industry ?? seedIndustry.get(sym);
    const sec = e.sector ?? seedSector.get(sym);
    for (const ext of [ind ? byIndustry.get(ind) : [], sec ? bySector.get(sec) : []]) {
      for (const s of ext ?? []) if (s !== sym) peers.add(s);
    }
    e.peers = [...peers]
      .sort((a, b) => a.localeCompare(b))
      .slice(0, 9)
      .map((s) => ({
        symbol: s,
        name: seedName.get(s) ?? s,
        industry: seedIndustry.get(s) ?? null,
        sector: seedSector.get(s) ?? null,
      }));
    e.reports = reportLinks(sym, seedName.get(sym) ?? e.name ?? sym, quarterEndPer[sym] ?? null);
  }

  const out = {
    generatedAt: new Date().toISOString(),
    source: yahoo.ok && yahooTouched > 0 ? 'yahoo' : 'db',
    universe: rows.length,
    stocks,
    sparklines: spark,
  };

  mkdirSync(join(process.cwd(), 'frontend', 'public'), { recursive: true });
  writeFileSync(join(process.cwd(), 'frontend', 'public', 'analysis.json'), JSON.stringify(out));

  console.log(`fundamentals: ${rows.length} stocks analysed (source=${out.source}, yahooFields=${yahooTouched})`);
  await pool.end();
}

main().catch(async (e) => {
  console.error('fundamentals failed:', e instanceof Error ? e.message : e);
  await pool.end().catch(() => {});
  process.exitCode = 1;
});