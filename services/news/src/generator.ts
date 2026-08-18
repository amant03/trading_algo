import { NewsEvent, SeededRng, Sentiment, Impact } from '@trading/shared';

export type Category = NewsEvent['category'];

interface Template {
  category: Category;
  impacts: Impact[];
  text: (v: NewsVars) => string;
}

interface NewsVars {
  symbol: string;
  name: string;
  sector: string;
  pct: string;
  amount: string;
  quarter: string;
}

const Q = ['Q1', 'Q2', 'Q3', 'Q4'];

const TEMPLATES: Template[] = [
  {
    category: 'EARNINGS',
    impacts: ['HIGH', 'HIGH', 'MEDIUM'],
    text: (v) => `${v.name} beats estimates: net profit jumps ${v.pct}% in ${v.quarter}; management raises guidance`,
  },
  {
    category: 'EARNINGS',
    impacts: ['HIGH', 'HIGH'],
    text: (v) => `${v.name} misses street expectations, revenue growth slows to ${v.pct}% in ${v.quarter}`,
  },
  {
    category: 'EARNINGS',
    impacts: ['MEDIUM'],
    text: (v) => `${v.name} posts in-line ${v.quarter} results; margins expand by ${v.pct} bps`,
  },
  {
    category: 'DIVIDEND',
    impacts: ['MEDIUM', 'LOW'],
    text: (v) => `${v.name} board declares interim dividend of Rs ${v.amount} per share`,
  },
  {
    category: 'DIVIDEND',
    impacts: ['LOW'],
    text: (v) => `${v.name} announces record date for final dividend for FY`,
  },
  {
    category: 'BUYBACK',
    impacts: ['HIGH', 'MEDIUM'],
    text: (v) => `${v.name} launches Rs ${v.amount} crore buyback at a premium; stock rallies`,
  },
  {
    category: 'SPLIT',
    impacts: ['MEDIUM', 'LOW'],
    text: (v) => `${v.name} approves stock split in 1:${v.amount} ratio; board nod awaited`,
  },
  {
    category: 'ANNOUNCEMENT',
    impacts: ['MEDIUM', 'MEDIUM', 'HIGH'],
    text: (v) => `${v.name} signs strategic partnership to expand ${v.sector.toLowerCase()} footprint`,
  },
  {
    category: 'ANNOUNCEMENT',
    impacts: ['MEDIUM', 'LOW'],
    text: (v) => `${v.name} bags new order worth Rs ${v.amount} crore`,
  },
  {
    category: 'ANNOUNCEMENT',
    impacts: ['MEDIUM'],
    text: (v) => `${v.name} announces capex plan of Rs ${v.amount} crore over next 2 years`,
  },
  {
    category: 'ANNOUNCEMENT',
    impacts: ['LOW'],
    text: (v) => `${v.name} appoints new independent directors; audit committee reconstituted`,
  },
  {
    category: 'NEWS',
    impacts: ['LOW', 'MEDIUM'],
    text: (v) => `Brokerages turn bullish on ${v.name}, raise target price by ${v.pct}%`,
  },
  {
    category: 'NEWS',
    impacts: ['LOW', 'LOW'],
    text: (v) => `${v.name} stock moves ${v.pct}% on heavy volumes; analysts watch breakout levels`,
  },
  {
    category: 'NEWS',
    impacts: ['LOW'],
    text: (v) => `FIIs increase stake in ${v.name} by ${v.pct} bps in latest quarter`,
  },
  {
    category: 'NEWS',
    impacts: ['MEDIUM', 'LOW'],
    text: (v) => `${v.name} flagged for rising competition in ${v.sector.toLowerCase()} segment`,
  },
  {
    category: 'MACRO',
    impacts: ['HIGH', 'MEDIUM'],
    text: () => `RBI holds repo rate steady; liquidity stance remains accommodative`,
  },
  {
    category: 'MACRO',
    impacts: ['HIGH'],
    text: () => `Crude oil slides 3% on global demand worries; energy stocks under pressure`,
  },
  {
    category: 'MACRO',
    impacts: ['MEDIUM'],
    text: () => `Rupee firms against the dollar as FII inflows return to Indian equities`,
  },
  {
    category: 'MACRO',
    impacts: ['MEDIUM'],
    text: () => `India Q4 GDP growth prints above consensus; market indices near record highs`,
  },
  {
    category: 'MACRO',
    impacts: ['HIGH', 'MEDIUM'],
    text: () => `Global markets wobble on rate-cut uncertainty; volatility gauges tick up`,
  },
];

const SOURCES = ['NSE Wire', 'Moneycontrol', 'Reuters India', 'ET Markets', 'Bloomberg Quint', 'CNBC-TV18', 'Business Standard', 'Mint'];

const CATEGORY_BASE_SENTIMENT: Record<Category, Sentiment> = {
  EARNINGS: 'BULLISH',
  DIVIDEND: 'BULLISH',
  BUYBACK: 'BULLISH',
  SPLIT: 'NEUTRAL',
  ANNOUNCEMENT: 'BULLISH',
  NEWS: 'NEUTRAL',
  MACRO: 'NEUTRAL',
};

export function generateNewsEvent(
  rng: SeededRng,
  inst: { id: number; symbol: string; name: string; sector: string | null } | null,
): NewsEvent {
  const tpl = rng.pick(TEMPLATES);
  const category = tpl.category;
  const impact = rng.pick(tpl.impacts);

  const v: NewsVars = {
    symbol: inst?.symbol ?? 'MARKET',
    name: inst?.name ?? 'Indian Equity Market',
    sector: inst?.sector ?? 'market',
    pct: rng.range(3, 25).toFixed(1),
    amount: rng.int(50, 5000).toString(),
    quarter: rng.pick(Q),
  };
  const headline = tpl.text(v);
  const summary = `${headline}. Impact assessed as ${impact.toLowerCase()} for ${inst ? inst.symbol : 'the broader market'}.`;

  let sentiment: Sentiment = CATEGORY_BASE_SENTIMENT[category];
  if (rng.bool(0.3)) sentiment = rng.pick(['BULLISH', 'BEARISH', 'NEUTRAL']);

  const tags = [category, impact, inst ? inst.sector ?? 'MARKET' : 'MACRO'];
  const now = Date.now();

  return {
    id: 0,
    instrumentId: inst?.id ?? null,
    symbol: inst?.symbol ?? null,
    headline,
    summary,
    source: rng.pick(SOURCES),
    sentiment,
    impact,
    category,
    tags,
    eventTime: now,
    publishedAt: now,
  };
}
