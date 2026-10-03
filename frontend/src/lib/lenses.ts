// Three stock lenses.
//
// Technical points follow the rules on TradingView's technicals page
// (the same gauges as in.tradingview.com). Each oscillator is +1 / 0 / −1
// and averaged with equal weight; each moving average is the same.
// Oscillators and moving averages then count 50/50 — that is Recommend.All.
//
// Fundamental is the existing stock-page blend: Buffett 45, Lynch 35, Graham 20.
// Techno + fundamental is 50% of the technical 0–100 score and 50% of that blend.

export type PointSignal = 'Buy' | 'Neutral' | 'Sell';
export type TvRating = 'Strong Buy' | 'Buy' | 'Neutral' | 'Sell' | 'Strong Sell';

export interface TechPoint {
  group: 'oscillator' | 'ma';
  label: string;
  value: string;
  signal: PointSignal | null;
}

export interface TechRow {
  symbol: string;
  tv: string;
  name: string;
  sector: string;
  exchange: string;
  price: number | null;
  changePct: number | null;
  marketCap: number | null;
  /** Recommend.Other, −1..1. Equal-weight mean of the 11 oscillators. */
  osc: number | null;
  /** Recommend.MA, −1..1. Equal-weight mean of the 15 moving averages. */
  ma: number | null;
  /** Recommend.All, −1..1. Mean of osc and ma (50/50). */
  all: number | null;
  /** Recommend.All mapped onto 0–100. */
  techScore: number | null;
  rating: TvRating | null;
  buy: number;
  neutral: number;
  sell: number;
  points: TechPoint[];
}

export interface FundaPoint {
  screen: 'Buffett' | 'Lynch' | 'Graham';
  label: string;
  value: string;
  signal: PointSignal | null;
}

export interface FundaInput {
  price: number;
  metrics: {
    pe: number | null;
    pb: number | null;
    roe: number | null;
    netMargin: number | null;
    revenueGrowth: number | null;
    earningsGrowth: number | null;
    growth: number | null;
    debtToEquity: number | null;
    currentRatio: number | null;
    eps: number | null;
    bookValue: number | null;
  };
  screens: {
    buffett: { score: number; grade: string };
    lynch: { score: number; grade: string; flags: string[] };
    graham: { score: number; grade: string };
  };
  verdict: { score: number; marginOfSafety: number };
}

/** Scanner columns, daily. Order is the contract with parseScanRows. */
export const TECH_COLUMNS = [
  'name',
  'description',
  'close',
  'change',
  'market_cap_basic',
  'sector',
  'exchange',
  'Recommend.Other',
  'Recommend.All',
  'Recommend.MA',
  'RSI',
  'RSI[1]',
  'Stoch.K',
  'Stoch.D',
  'Stoch.K[1]',
  'Stoch.D[1]',
  'CCI20',
  'CCI20[1]',
  'ADX',
  'ADX+DI',
  'ADX-DI',
  'ADX+DI[1]',
  'ADX-DI[1]',
  'AO',
  'AO[1]',
  'AO[2]',
  'Mom',
  'Mom[1]',
  'MACD.macd',
  'MACD.signal',
  'Rec.Stoch.RSI',
  'Stoch.RSI.K',
  'Rec.WR',
  'W.R',
  'Rec.BBPower',
  'BBPower',
  'Rec.UO',
  'UO',
  'EMA10',
  'SMA10',
  'EMA20',
  'SMA20',
  'EMA30',
  'SMA30',
  'EMA50',
  'SMA50',
  'EMA100',
  'SMA100',
  'EMA200',
  'SMA200',
  'Rec.Ichimoku',
  'Ichimoku.BLine',
  'Rec.VWMA',
  'VWMA',
  'Rec.HullMA9',
  'HullMA9',
] as const;

export const FUNDA_WEIGHTS = { buffett: 0.45, lynch: 0.35, graham: 0.2 } as const;
export const COMBINED_HALF = 0.5;

const num = (v: unknown): number | null => (typeof v === 'number' && isFinite(v) ? v : null);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

function nfmt(v: number | null, digits = 2): string {
  if (v == null || !isFinite(v)) return '—';
  return v.toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function tvRating(v: number | null): TvRating | null {
  if (v == null || !isFinite(v)) return null;
  if (v > 0.5) return 'Strong Buy';
  if (v > 0.1) return 'Buy';
  if (v >= -0.1) return 'Neutral';
  if (v >= -0.5) return 'Sell';
  return 'Strong Sell';
}

/** Map a TradingView −1..1 rating onto 0–100. */
export function techToScore(v: number | null): number | null {
  if (v == null || !isFinite(v)) return null;
  const c = Math.max(-1, Math.min(1, v));
  return Math.round(((c + 1) / 2) * 100);
}

/** 50% technical + 50% fundamental, both already on 0–100. */
export function combineScores(tech: number | null, funda: number | null): number | null {
  if (tech == null || funda == null || !isFinite(tech) || !isFinite(funda)) return null;
  return Math.round(tech * COMBINED_HALF + funda * COMBINED_HALF);
}

export function techBuy(score: number | null): boolean {
  return score != null && score > 55;
}

export function fundaBuy(score: number | null, rating?: string | null): boolean {
  if (rating === 'Strong Buy' || rating === 'Buy') return true;
  return score != null && score >= 58;
}

function fromRec(v: number | null): PointSignal | null {
  if (v == null) return null;
  if (v >= 0.5) return 'Buy';
  if (v <= -0.5) return 'Sell';
  return 'Neutral';
}

function fromMa(ma: number | null, close: number | null): PointSignal | null {
  if (ma == null || close == null) return null;
  if (ma < close) return 'Buy';
  if (ma > close) return 'Sell';
  return 'Neutral';
}

function rsiSignal(rsi: number | null, prev: number | null): PointSignal | null {
  if (rsi == null || prev == null) return null;
  if (rsi < 30 && prev < rsi) return 'Buy';
  if (rsi > 70 && prev > rsi) return 'Sell';
  return 'Neutral';
}

function stochSignal(k: number | null, d: number | null, k1: number | null, d1: number | null): PointSignal | null {
  if (k == null || d == null || k1 == null || d1 == null) return null;
  if (k < 20 && d < 20 && k > d && k1 < d1) return 'Buy';
  if (k > 80 && d > 80 && k < d && k1 > d1) return 'Sell';
  return 'Neutral';
}

function cciSignal(cci: number | null, prev: number | null): PointSignal | null {
  if (cci == null || prev == null) return null;
  if (cci < -100 && cci > prev) return 'Buy';
  if (cci > 100 && cci < prev) return 'Sell';
  return 'Neutral';
}

function adxSignal(
  adx: number | null,
  pdi: number | null,
  ndi: number | null,
  pdi1: number | null,
  ndi1: number | null,
): PointSignal | null {
  if (adx == null || pdi == null || ndi == null || pdi1 == null || ndi1 == null) return null;
  if (adx > 20 && pdi1 < ndi1 && pdi > ndi) return 'Buy';
  if (adx > 20 && pdi1 > ndi1 && pdi < ndi) return 'Sell';
  return 'Neutral';
}

function aoSignal(ao: number | null, ao1: number | null, ao2: number | null): PointSignal | null {
  if (ao == null || ao1 == null || ao2 == null) return null;
  if ((ao > 0 && ao1 < 0) || (ao > 0 && ao1 > 0 && ao > ao1 && ao2 > ao1)) return 'Buy';
  if ((ao < 0 && ao1 > 0) || (ao < 0 && ao1 < 0 && ao < ao1 && ao2 > ao1)) return 'Sell';
  return 'Neutral';
}

function momSignal(mom: number | null, prev: number | null): PointSignal | null {
  if (mom == null || prev == null) return null;
  if (mom > prev) return 'Buy';
  if (mom < prev) return 'Sell';
  return 'Neutral';
}

function macdSignal(macd: number | null, signal: number | null): PointSignal | null {
  if (macd == null || signal == null) return null;
  if (macd > signal) return 'Buy';
  if (macd < signal) return 'Sell';
  return 'Neutral';
}

function band(v: number | null, buyAt: (n: number) => boolean, sellAt: (n: number) => boolean, neutralAt?: (n: number) => boolean): PointSignal | null {
  if (v == null) return null;
  if (buyAt(v)) return 'Buy';
  if (sellAt(v)) return 'Sell';
  if (neutralAt && !neutralAt(v)) return 'Sell';
  return 'Neutral';
}

export function fundamentalPoints(f: FundaInput): FundaPoint[] {
  const m = f.metrics;
  const growth = m.growth ?? m.earningsGrowth;
  const eps = m.eps;
  const bv = m.bookValue;
  const graham = eps != null && bv != null && eps > 0 && bv > 0 ? Math.sqrt(22.5 * eps * bv) : null;
  const lynchClass = f.screens.lynch.flags[0] ?? '—';
  const pe = m.pe;
  const peg = pe != null && pe > 0 && growth != null ? pe / Math.max(growth, 1) : null;

  return [
    { screen: 'Buffett', label: 'ROE', value: m.roe == null ? '—' : `${nfmt(m.roe, 1)}%`, signal: band(m.roe, (n) => n >= 15, (n) => n < 10) },
    { screen: 'Buffett', label: 'Net margin', value: m.netMargin == null ? '—' : `${nfmt(m.netMargin, 1)}%`, signal: band(m.netMargin, (n) => n >= 15, (n) => n < 5) },
    { screen: 'Buffett', label: 'Debt / equity', value: m.debtToEquity == null ? '—' : nfmt(m.debtToEquity, 2), signal: band(m.debtToEquity, (n) => n <= 0.5, (n) => n > 2) },
    { screen: 'Buffett', label: 'Revenue growth', value: m.revenueGrowth == null ? '—' : `${nfmt(m.revenueGrowth, 1)}%`, signal: band(m.revenueGrowth, (n) => n > 0, (n) => n < 0) },
    { screen: 'Buffett', label: 'Earnings growth', value: m.earningsGrowth == null ? '—' : `${nfmt(m.earningsGrowth, 1)}%`, signal: band(m.earningsGrowth, (n) => n > 0, (n) => n < 0) },
    { screen: 'Lynch', label: 'Class', value: lynchClass, signal: lynchClass.startsWith('Slow') ? 'Sell' : lynchClass === '—' ? null : 'Neutral' },
    { screen: 'Lynch', label: 'PEG', value: peg == null ? '—' : nfmt(peg, 2), signal: pe == null || pe <= 0 ? 'Sell' : band(peg, (n) => n <= 1, (n) => n > 2) },
    { screen: 'Lynch', label: 'P/E', value: pe == null ? '—' : nfmt(pe, 1), signal: pe == null || pe <= 0 ? 'Sell' : 'Neutral' },
    { screen: 'Graham', label: 'P/E ≤ 15', value: pe == null ? '—' : nfmt(pe, 1), signal: pe == null ? null : pe > 0 && pe <= 15 ? 'Buy' : 'Sell' },
    { screen: 'Graham', label: 'P/B ≤ 1.5', value: m.pb == null ? '—' : nfmt(m.pb, 2), signal: m.pb == null ? null : m.pb <= 1.5 ? 'Buy' : 'Sell' },
    { screen: 'Graham', label: 'Current ratio', value: m.currentRatio == null ? '—' : nfmt(m.currentRatio, 2), signal: m.currentRatio == null ? null : m.currentRatio >= 2 ? 'Buy' : 'Neutral' },
    { screen: 'Graham', label: 'Debt / equity', value: m.debtToEquity == null ? '—' : nfmt(m.debtToEquity, 2), signal: m.debtToEquity == null ? null : m.debtToEquity <= 1 ? 'Buy' : 'Sell' },
    {
      screen: 'Graham',
      label: 'Graham number',
      value: graham == null ? '—' : nfmt(graham, 0),
      signal: graham == null || f.price <= 0 ? null : graham >= f.price * 1.15 ? 'Buy' : graham >= f.price ? 'Neutral' : 'Sell',
    },
    {
      screen: 'Graham',
      label: 'Fair-value margin of safety',
      value: `${f.verdict.marginOfSafety > 0 ? '+' : ''}${f.verdict.marginOfSafety}%`,
      signal: f.verdict.marginOfSafety >= 15 ? 'Buy' : f.verdict.marginOfSafety >= 0 ? 'Neutral' : 'Sell',
    },
  ];
}

interface ScanHit { s: string; d: unknown[] }

export function parseScanRows(hits: ScanHit[]): TechRow[] {
  const at = (d: unknown[], name: (typeof TECH_COLUMNS)[number]): unknown => d[TECH_COLUMNS.indexOf(name)];
  const out: TechRow[] = [];
  const seen = new Set<string>();

  for (const hit of hits) {
    const d = hit.d ?? [];
    const symbol = (str(hit.s).split(':').pop() ?? '').toUpperCase();
    if (!symbol || seen.has(symbol)) continue;
    const price = num(at(d, 'close'));
    const all = num(at(d, 'Recommend.All'));
    if (price == null || all == null) continue;
    seen.add(symbol);

    const rsi = num(at(d, 'RSI'));
    const stochK = num(at(d, 'Stoch.K'));
    const stochD = num(at(d, 'Stoch.D'));
    const cci = num(at(d, 'CCI20'));
    const adx = num(at(d, 'ADX'));
    const pdi = num(at(d, 'ADX+DI'));
    const ndi = num(at(d, 'ADX-DI'));
    const ao = num(at(d, 'AO'));
    const mom = num(at(d, 'Mom'));
    const macd = num(at(d, 'MACD.macd'));
    const macdSig = num(at(d, 'MACD.signal'));

    const points: TechPoint[] = [
      { group: 'oscillator', label: 'RSI (14)', value: rsi == null ? '—' : nfmt(rsi, 1), signal: rsiSignal(rsi, num(at(d, 'RSI[1]'))) },
      { group: 'oscillator', label: 'Stochastic (14, 3, 3)', value: stochK == null ? '—' : `%K ${nfmt(stochK, 1)} · %D ${nfmt(stochD, 1)}`, signal: stochSignal(stochK, stochD, num(at(d, 'Stoch.K[1]')), num(at(d, 'Stoch.D[1]'))) },
      { group: 'oscillator', label: 'CCI (20)', value: cci == null ? '—' : nfmt(cci, 1), signal: cciSignal(cci, num(at(d, 'CCI20[1]'))) },
      { group: 'oscillator', label: 'ADX (14)', value: adx == null ? '—' : `${nfmt(adx, 1)} · +DI ${nfmt(pdi, 1)} · −DI ${nfmt(ndi, 1)}`, signal: adxSignal(adx, pdi, ndi, num(at(d, 'ADX+DI[1]')), num(at(d, 'ADX-DI[1]'))) },
      { group: 'oscillator', label: 'Awesome Oscillator', value: ao == null ? '—' : nfmt(ao, 2), signal: aoSignal(ao, num(at(d, 'AO[1]')), num(at(d, 'AO[2]'))) },
      { group: 'oscillator', label: 'Momentum (10)', value: mom == null ? '—' : nfmt(mom, 2), signal: momSignal(mom, num(at(d, 'Mom[1]'))) },
      { group: 'oscillator', label: 'MACD (12, 26, 9)', value: macd == null ? '—' : `${nfmt(macd, 2)} vs signal ${nfmt(macdSig, 2)}`, signal: macdSignal(macd, macdSig) },
      { group: 'oscillator', label: 'Stochastic RSI (3, 3, 14, 14)', value: nfmt(num(at(d, 'Stoch.RSI.K')), 1), signal: fromRec(num(at(d, 'Rec.Stoch.RSI'))) },
      { group: 'oscillator', label: 'Williams %R (14)', value: nfmt(num(at(d, 'W.R')), 1), signal: fromRec(num(at(d, 'Rec.WR'))) },
      { group: 'oscillator', label: 'Bull Bear Power', value: nfmt(num(at(d, 'BBPower')), 2), signal: fromRec(num(at(d, 'Rec.BBPower'))) },
      { group: 'oscillator', label: 'Ultimate Oscillator (7, 14, 28)', value: nfmt(num(at(d, 'UO')), 1), signal: fromRec(num(at(d, 'Rec.UO'))) },
    ];

    const mas: [string, (typeof TECH_COLUMNS)[number]][] = [
      ['EMA (10)', 'EMA10'],
      ['SMA (10)', 'SMA10'],
      ['EMA (20)', 'EMA20'],
      ['SMA (20)', 'SMA20'],
      ['EMA (30)', 'EMA30'],
      ['SMA (30)', 'SMA30'],
      ['EMA (50)', 'EMA50'],
      ['SMA (50)', 'SMA50'],
      ['EMA (100)', 'EMA100'],
      ['SMA (100)', 'SMA100'],
      ['EMA (200)', 'EMA200'],
      ['SMA (200)', 'SMA200'],
    ];
    for (const [label, key] of mas) {
      const level = num(at(d, key));
      points.push({
        group: 'ma',
        label,
        value: level == null ? '—' : nfmt(level, 2),
        signal: fromMa(level, price),
      });
    }
    points.push(
      { group: 'ma', label: 'Ichimoku (9, 26, 52)', value: nfmt(num(at(d, 'Ichimoku.BLine')), 2), signal: fromRec(num(at(d, 'Rec.Ichimoku'))) },
      { group: 'ma', label: 'VWMA (20)', value: nfmt(num(at(d, 'VWMA')), 2), signal: fromRec(num(at(d, 'Rec.VWMA'))) },
      { group: 'ma', label: 'Hull MA (9)', value: nfmt(num(at(d, 'HullMA9')), 2), signal: fromRec(num(at(d, 'Rec.HullMA9'))) },
    );

    let buy = 0;
    let neutral = 0;
    let sell = 0;
    for (const p of points) {
      if (p.signal === 'Buy') buy += 1;
      else if (p.signal === 'Sell') sell += 1;
      else if (p.signal === 'Neutral') neutral += 1;
    }

    out.push({
      symbol,
      tv: str(hit.s).toUpperCase(),
      name: str(at(d, 'description')) || str(at(d, 'name')) || symbol,
      sector: str(at(d, 'sector')),
      exchange: str(at(d, 'exchange')) || 'NSE',
      price,
      changePct: num(at(d, 'change')),
      marketCap: num(at(d, 'market_cap_basic')),
      osc: num(at(d, 'Recommend.Other')),
      ma: num(at(d, 'Recommend.MA')),
      all,
      techScore: techToScore(all),
      rating: tvRating(all),
      buy,
      neutral,
      sell,
      points,
    });
  }
  out.sort((a, b) => (b.techScore ?? -1) - (a.techScore ?? -1));
  return out;
}
