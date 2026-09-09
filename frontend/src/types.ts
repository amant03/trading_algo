export interface Instrument {
  id: number;
  symbol: string;
  name: string;
  sector: string;
  isin: string;
  exchange: string;
  marketCap: number;
  basePrice: number;
}

export interface UniverseStock {
  symbol: string;
  name: string;
  exchange: 'NSE' | 'BSE';
  series: string;
  isin: string;
  cap: 'large' | 'mid' | 'small';
  mktCap: number | null;
}

export interface Snapshot {
  instrumentId: number;
  symbol: string;
  price: number;
  prevClose: number;
  change: number;
  changePct: number;
  dayOpen: number;
  dayHigh: number;
  dayLow: number;
  dayVolume: number;
  ts: number;
}

export interface MarketOverview {
  index: { symbol: string; price: number; changePct: number; timestamp: number };
  market: { advancers: number; decliners: number; unchanged: number; total: number };
  sectorPerformance: { sector: string; changePct: number; count: number }[];
  gainers: Snapshot[];
  losers: Snapshot[];
  topVolume: Snapshot[];
  updatedAt?: number;
}

export interface Candle {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IndicatorSet {
  symbol: string;
  timeframe: string;
  ts: number[];
  close: number[];
  sma20: (number | null)[];
  sma50: (number | null)[];
  sma200: (number | null)[];
  ema12: (number | null)[];
  ema26: (number | null)[];
  rsi: (number | null)[];
  macd: (number | null)[];
  macdSignal: (number | null)[];
  macdHist: (number | null)[];
  bbUpper: (number | null)[];
  bbMiddle: (number | null)[];
  bbLower: (number | null)[];
  atr: (number | null)[];
  stochK: (number | null)[];
  stochD: (number | null)[];
  stLine: (number | null)[];
  stDir: (number | null)[];
}

export interface Fundamentals {
  instrument_id: number;
  sector: string | null;
  industry: string | null;
  description: string | null;
  market_cap: number;
  pe: number;
  pb: number;
  ps: number;
  peg: number;
  roe: number;
  roce: number;
  roa: number;
  debt_to_equity: number;
  current_ratio: number;
  quick_ratio: number;
  gross_margin: number;
  operating_margin: number;
  net_margin: number;
  revenue: number;
  revenue_growth: number;
  net_income: number;
  net_income_growth: number;
  employees: number;
  dividend_yield: number;
  eps: number;
  book_value: number;
  beta: number;
  fifty_two_week_high: number;
  fifty_two_week_low: number;
  avg_volume: number;
  promoter_holding: number;
  fii_holding: number;
  investability_score: number;
  investability_grade: string;
}

export interface Relation {
  id: number;
  instrumentId: number;
  relationType: string;
  entityName: string;
  entitySymbol: string | null;
  weight: number;
  note: string | null;
}

export interface Signal {
  id: number;
  instrumentId: number;
  symbol: string;
  strategy: string;
  direction: 'BUY' | 'SELL';
  strength: number;
  price: number;
  reason: string;
  indicatorSnapshot: Record<string, unknown> | null;
  ts: number;
}

export interface NewsItem {
  id: number;
  instrumentId: number | null;
  symbol?: string | null;
  headline: string;
  summary: string | null;
  source: string;
  category: string;
  sentiment: string;
  impact: string;
  tags: string[];
  publishedAt: number;
  url?: string | null;
}

export interface AlgorithmConfig {
  strategy: string;
  enabled: boolean;
  params: Record<string, number>;
}

export interface Order {
  id: number;
  accountId: number;
  instrumentId: number;
  symbol: string;
  side: 'BUY' | 'SELL';
  orderType: 'MARKET' | 'LIMIT';
  quantity: number;
  limitPrice: number | null;
  status: string;
  filledQty: number;
  avgPrice: number | null;
  strategy: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface Position {
  instrumentId: number;
  symbol: string;
  name: string | null;
  sector: string | null;
  quantity: number;
  avgPrice: number;
  lastPrice: number;
  marketValue: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  realizedPnl: number;
  dayPnl: number;
}

export interface Portfolio {
  account: { id: number; cash: number; initialCapital: number; equity: number };
  summary: {
    invested: number;
    unrealizedPnl: number;
    realizedPnl: number;
    dayPnl: number;
    totalPnl: number;
    totalPnlPct: number;
    availableCash: number;
  };
  positions: Position[];
  equityCurve: { ts: number; equity: number }[];
}

export interface Trade {
  id: number;
  orderId: number | null;
  instrumentId: number;
  symbol: string;
  side: string;
  quantity: number;
  price: number;
  realizedPnl: number | null;
  strategy: string | null;
  ts: number;
}

export interface WsMessage<T = unknown> {
  type: string;
  payload: T;
}

// ---- Analyst model (scripts/ci/fundamentals.ts -> analysis.json) ----

export interface ScreenResult {
  score: number;
  grade: string;
  thesis: string;
  flags: string[];
}

export interface StockAnalysisMetrics {
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
}

export interface StockOpinion {
  horizon: 'lt';
  stance: 'BUY' | 'HOLD' | 'SELL';
  conviction: number;
  thesis: string;
  risks: string[];
}

export interface PeerInfo {
  symbol: string;
  name: string | null;
  industry: string | null;
  sector: string | null;
}

export interface ReportLink {
  label: string;
  url: string;
  kind: 'financials' | 'search';
}

export interface ReportGroup {
  label: string;
  period: string | null;
  links: ReportLink[];
}

export interface StockReports {
  quarterly: ReportGroup;
  annual: ReportGroup;
}

// ---- Screener.in fundamentals (attached by the nightly batch + /api/funda) ----

export type ConsolidationView = 'consolidated' | 'standalone';
export type RatioUnit = 'pct' | 'days' | 'x' | 'cr' | 'rs' | 'number';
export type SectorKind = 'bank' | 'nbfc' | 'insurance' | 'realty' | 'generic';

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

export interface ScreenerFundamentals {
  symbol: string;
  name: string | null;
  broadSector: string | null;
  sector: string | null;
  industry: string | null;
  sectorKind?: SectorKind;
  defaultView: ConsolidationView;
  views: Partial<Record<ConsolidationView, ScreenerView>>;
  bank: ScreenerBankRatios | null;
}

export interface StockAnalysis {
  symbol: string;
  name: string | null;
  sector: string | null;
  industry: string | null;
  description: string | null;
  price: number;
  marketCap: number | null;
  metrics: StockAnalysisMetrics;
  financials: ScreenerFundamentals | null;
  screens: { buffett: ScreenResult; lynch: ScreenResult; graham: ScreenResult };
  management: MgmtAnalysis | null;
  peers: PeerInfo[];
  reports: StockReports | null;
  opinion: StockOpinion | null;
  verdict: {
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
  };
}

export type SparklinePoint = [number, number]; // [ts, close]
export type Sparkline = SparklinePoint[];

// ---- Google-News-driven per-stock news (scripts/ci/news.ts -> news.json) ----

export interface NewsArticle {
  title: string;
  source: string;
  url: string;
  publishedAt: string;
  symbol: string;
}

export interface HistoryRow {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

// ---- Management analysis (scripts/ci/management.ts -> analysis.json) ----

export interface ManagementFlag {
  key: string;
  label: string;
  severity: 'good' | 'warn' | 'bad';
}

export interface LegalCase {
  kind: 'criminal' | 'civil' | 'regulatory' | 'other';
  title: string;
  source: string;
  url: string;
  date: string | null;
}

export interface MgmtAnalysis {
  score: number;
  grade: string;
  thesis: string;
  founders: { name: string; role: string }[];
  checks: ManagementFlag[];
  cases: LegalCase[];
  updatedAt: string;
}