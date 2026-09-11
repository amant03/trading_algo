export type Timeframe = '1m' | '5m' | '15m' | '1h' | '1d';
export type Side = 'BUY' | 'SELL';
export type OrderType = 'MARKET' | 'LIMIT';
export type OrderStatus = 'PENDING' | 'PARTIAL' | 'FILLED' | 'REJECTED' | 'CANCELLED';
export type SignalDirection = 'BUY' | 'SELL' | 'NEUTRAL';
export type Sentiment = 'BULLISH' | 'BEARISH' | 'NEUTRAL';
export type Impact = 'HIGH' | 'MEDIUM' | 'LOW';

export interface Candle {
  instrumentId: number;
  symbol: string;
  timeframe: Timeframe;
  ts: number; // epoch ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Tick {
  instrumentId: number;
  symbol: string;
  ts: number;
  price: number;
  volume: number;
  side: Side;
}

export interface Instrument {
  id: number;
  symbol: string;
  name: string;
  exchange: string;
  segment: string;
  sector: string | null;
  industry: string | null;
  basePrice: number;
  lotSize: number;
  tickSize: number;
  marketCap: number | null;
  volatility: number;
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

export interface Fundamentals {
  instrumentId: number;
  sector: string | null;
  industry: string | null;
  description: string | null;
  marketCap: number;
  pe: number;
  pb: number;
  ps: number;
  peg: number;
  roe: number;
  roce: number;
  roa: number;
  debtToEquity: number;
  currentRatio: number;
  quickRatio: number;
  grossMargin: number;
  operatingMargin: number;
  netMargin: number;
  revenue: number;
  revenueGrowth: number;
  netIncome: number;
  netIncomeGrowth: number;
  employees: number;
  dividendYield: number;
  eps: number;
  bookValue: number;
  beta: number;
  fiftyTwoWeekHigh: number;
  fiftyTwoWeekLow: number;
  avgVolume: number;
  promoterHolding: number;
  fiiHolding: number;
  investabilityScore: number;
  investabilityGrade: string;
}

export interface CompanyRelation {
  id: number;
  instrumentId: number;
  relationType: 'SUPPLIER' | 'VENDOR' | 'BUYER' | 'PEER' | 'SUBSIDIARY';
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
  direction: SignalDirection;
  price: number;
  strength: number;
  reason: string;
  indicatorSnapshot: Record<string, number | string | null>;
  ts: number;
}

export interface NewsEvent {
  id: number;
  instrumentId: number | null;
  symbol: string | null;
  headline: string;
  summary: string | null;
  source: string;
  sentiment: Sentiment;
  impact: Impact;
  category: 'NEWS' | 'EARNINGS' | 'DIVIDEND' | 'SPLIT' | 'BUYBACK' | 'ANNOUNCEMENT' | 'MACRO';
  tags: string[];
  eventTime: number;
  publishedAt: number;
}

export interface Order {
  id: number;
  accountId: number;
  userId: number | null;
  instrumentId: number;
  symbol: string;
  side: Side;
  orderType: OrderType;
  quantity: number;
  limitPrice: number | null;
  status: OrderStatus;
  filledQty: number;
  avgPrice: number | null;
  strategy: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface Trade {
  id: number;
  orderId: number | null;
  accountId: number;
  userId: number | null;
  instrumentId: number;
  symbol: string;
  side: Side;
  quantity: number;
  price: number;
  realizedPnl: number;
  strategy: string | null;
  ts: number;
}

export interface Position {
  id: number;
  accountId: number;
  instrumentId: number;
  symbol: string;
  quantity: number;
  avgPrice: number;
  realizedPnl: number;
  lastPrice: number;
  marketValue: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  dayPnl: number;
}

export interface PortfolioSummary {
  accountId: number;
  cash: number;
  initialCapital: number;
  equity: number;
  invested: number;
  availableCash: number;
  dayPnl: number;
  unrealizedPnl: number;
  realizedPnl: number;
  totalPnl: number;
  totalPnlPct: number;
  positions: Position[];
}

export interface AlgorithmConfig {
  strategy: string;
  enabled: boolean;
  params: Record<string, number | boolean | string>;
}

export interface EquityPoint {
  ts: number;
  equity: number;
}

export type AuthProvider = 'email' | 'google';

export interface User {
  id: number;
  email: string;
  displayName: string;
  authProvider: AuthProvider;
  hasOnboarded: boolean;
  createdAt: number;
  lastLoginAt: number | null;
}

export interface IndicatorResult {
  sma20: number[];
  sma50: number[];
  sma200: number[];
  ema12: number[];
  ema26: number[];
  rsi14: number[];
  macd: { macd: number; signal: number; histogram: number }[];
  bollinger: { upper: number; middle: number; lower: number }[];
  atr14: number[];
  stoch14: { k: number; d: number }[];
  supertrend: { line: number; direction: 'up' | 'down' }[];
}

export interface KafkaMessage<T> {
  type: string;
  payload: T;
  ts: number;
}
