// Book review for the Vibe-Trading desk.
// No symbol is chosen by the user. Closed sells from the paper journal are
// split in time: the first 70% may propose a rule, and the rule is kept only
// when the last 30% of sells make more money than the unfiltered later sells.
// Value names come from the fundamental book. Venue and ADR gaps come from
// two prices for the same company.

export interface JournalTrade {
  day: string;
  strategy: string;
  symbol: string;
  side: string;
  pnl: number;
  retPct?: number | null;
  exitClass?: string;
  reason?: string;
  newsDriven?: boolean;
}

export interface FundStock {
  symbol: string;
  name?: string | null;
  sector?: string | null;
  metrics?: { pe?: number | null; roe?: number | null };
  screens?: {
    graham?: { score?: number; grade?: string };
    buffett?: { score?: number; grade?: string };
  };
  verdict?: { marginOfSafety?: number; grade?: string; rating?: string; fairValueMid?: number };
}

export interface Cause {
  id: string;
  title: string;
  detail: string;
  pnl: number;
  trades: number;
}

export interface ValueDeal {
  symbol: string;
  name: string;
  sector: string;
  marginOfSafety: number;
  grade: string;
  rating: string;
  pe: number | null;
  roe: number | null;
  graham: string;
  traded: boolean;
  why: string;
}

export interface RuleRow {
  id: string;
  label: string;
  trainPnl: number;
  testPnl: number;
  trainTrades: number;
  testTrades: number;
  trainBeat: boolean;
  holdoutBeat: boolean;
  adopted: boolean;
}

export interface SectorPnl {
  sector: string;
  pnl: number;
  trades: number;
}

export interface DeskReview {
  closed: JournalTrade[];
  trainCount: number;
  testCount: number;
  from: string;
  to: string;
  causes: Cause[];
  deals: ValueDeal[];
  rules: RuleRow[];
  adopted: RuleRow | null;
  reason: string;
  strategies: { id: string; pnl: number; trades: number; winRate: number }[];
  sectors: SectorPnl[];
  disposition: boolean;
  stopSlipCount: number;
  stopCount: number;
  bootstrap: { low: number; high: number };
  repeatSymbols: { symbol: string; trades: number; pnl: number }[];
}

export interface ArbQuote {
  ticker: string;
  price: number;
}

export interface ArbRow {
  id: string;
  kind: 'venue' | 'adr';
  pair: string;
  gapPct: number;
  note: string;
  actionable: boolean;
}

export const VENUE_PAIRS: [string, string][] = [
  ['RELIANCE.NS', 'RELIANCE.BO'],
  ['TCS.NS', 'TCS.BO'],
  ['INFY.NS', 'INFY.BO'],
  ['HDFCBANK.NS', 'HDFCBANK.BO'],
  ['ICICIBANK.NS', 'ICICIBANK.BO'],
];

/** ADR share counts published by the issuers: Infosys 1, Wipro 1, HDFC Bank 3, ICICI 2. */
export const ADR_PAIRS: { adr: string; local: string; ratio: number; name: string }[] = [
  { adr: 'INFY', local: 'INFY.NS', ratio: 1, name: 'Infosys' },
  { adr: 'WIT', local: 'WIPRO.NS', ratio: 1, name: 'Wipro' },
  { adr: 'HDB', local: 'HDFCBANK.NS', ratio: 3, name: 'HDFC Bank' },
  { adr: 'IBN', local: 'ICICIBANK.NS', ratio: 2, name: 'ICICI Bank' },
];

export const FX_TICKER = 'INR=X';
const ADR_GAP = 0.015;
const VENUE_GAP = 0.004;

const inr = (n: number) => `${n < 0 ? '-' : ''}₹${Math.abs(Math.round(n)).toLocaleString('en-IN')}`;
const pct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;

export function closedSells(rows: JournalTrade[]): JournalTrade[] {
  return rows
    .filter((row) => row.side === 'SELL' && !!row.exitClass && row.exitClass !== 'open' && Number.isFinite(row.pnl))
    .slice()
    .sort((a, b) => a.day.localeCompare(b.day) || a.symbol.localeCompare(b.symbol));
}

function sumPnl(rows: JournalTrade[]): number {
  return rows.reduce((acc, row) => acc + row.pnl, 0);
}

function byKey(rows: JournalTrade[], key: (row: JournalTrade) => string): Map<string, JournalTrade[]> {
  const map = new Map<string, JournalTrade[]>();
  for (const row of rows) {
    const k = key(row);
    const list = map.get(k);
    if (list) list.push(row);
    else map.set(k, [row]);
  }
  return map;
}

function worstKey(rows: JournalTrade[], key: (row: JournalTrade) => string, minCount: number): string | null {
  let worst: string | null = null;
  let worstPnl = Infinity;
  for (const [name, list] of byKey(rows, key)) {
    if (list.length < minCount) continue;
    const pnl = sumPnl(list);
    if (pnl < worstPnl) {
      worstPnl = pnl;
      worst = name;
    }
  }
  return worst;
}

function bestKey(rows: JournalTrade[], key: (row: JournalTrade) => string): string | null {
  let best: string | null = null;
  let bestPnl = -Infinity;
  for (const [name, list] of byKey(rows, key)) {
    const pnl = sumPnl(list);
    if (pnl > bestPnl) {
      bestPnl = pnl;
      best = name;
    }
  }
  return best;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function bootstrapMean(values: number[], draws = 400): { low: number; high: number } {
  if (!values.length) return { low: 0, high: 0 };
  const point = values.reduce((a, b) => a + b, 0) / values.length;
  if (values.length < 8) return { low: point, high: point };
  const rnd = mulberry32((values.length * 10007 + Math.round(values[0])) >>> 0);
  const means: number[] = [];
  for (let d = 0; d < draws; d++) {
    let total = 0;
    for (let i = 0; i < values.length; i++) total += values[Math.floor(rnd() * values.length)];
    means.push(total / values.length);
  }
  means.sort((a, b) => a - b);
  return { low: means[Math.floor(draws * 0.05)], high: means[Math.floor(draws * 0.95)] };
}

export function buildReview(trades: JournalTrade[], stocks: Record<string, FundStock> | FundStock[]): DeskReview {
  const book = Array.isArray(stocks)
    ? Object.fromEntries(stocks.map((stock) => [stock.symbol, stock]))
    : stocks;
  const closed = closedSells(trades);
  const split = Math.floor(closed.length * 0.7);
  const train = closed.slice(0, split);
  const test = closed.slice(split);
  const trainBase = sumPnl(train);
  const testBase = sumPnl(test);
  const traded = new Set(closed.map((row) => row.symbol));

  const worstStrategy = worstKey(train, (row) => row.strategy, 3);
  const bestStrategy = bestKey(train, (row) => row.strategy);
  const symbolPnl = [...byKey(train, (row) => row.symbol).entries()]
    .map(([symbol, list]) => ({ symbol, pnl: sumPnl(list) }))
    .sort((a, b) => a.pnl - b.pnl);
  const worstSymbols = new Set(symbolPnl.filter((row) => row.pnl < 0).slice(0, 3).map((row) => row.symbol));

  const frozen: { id: string; label: string; keep: (row: JournalTrade) => boolean }[] = [
    { id: 'book', label: 'Keep the book as traded', keep: () => true },
  ];
  if (worstStrategy) {
    frozen.push({
      id: 'drop-strategy',
      label: `Drop ${worstStrategy} after it lost the most in the earlier sells`,
      keep: (row) => row.strategy !== worstStrategy,
    });
  }
  if (bestStrategy && bestStrategy !== worstStrategy) {
    frozen.push({
      id: 'keep-strategy',
      label: `Keep only ${bestStrategy}, the earlier sells' only paying sleeve`,
      keep: (row) => row.strategy === bestStrategy,
    });
  }
  if (worstSymbols.size) {
    frozen.push({
      id: 'drop-symbols',
      label: `Stand aside from ${[...worstSymbols].join(', ')}, the earlier losers`,
      keep: (row) => !worstSymbols.has(row.symbol),
    });
  }

  const rules: RuleRow[] = frozen.map((rule) => {
    const trainRows = train.filter(rule.keep);
    const testRows = test.filter(rule.keep);
    const trainPnl = sumPnl(trainRows);
    const testPnl = sumPnl(testRows);
    return {
      id: rule.id,
      label: rule.label,
      trainPnl,
      testPnl,
      trainTrades: trainRows.length,
      testTrades: testRows.length,
      trainBeat: rule.id === 'book' ? true : trainPnl > trainBase,
      holdoutBeat: rule.id === 'book' ? false : testPnl > testBase,
      adopted: false,
    };
  });

  const eligible = rules.filter((rule) => rule.id !== 'book' && rule.trainBeat && rule.holdoutBeat && rule.testTrades >= 3);
  eligible.sort((a, b) => b.trainPnl - a.trainPnl);
  const adopted = eligible[0] ?? null;
  if (adopted) {
    const row = rules.find((rule) => rule.id === adopted.id);
    if (row) row.adopted = true;
  }

  const reason = !closed.length
    ? 'The journal has no closed sells, so there is nothing to judge.'
    : test.length < 3
      ? 'The later slice has fewer than 3 sells, so no rule is adopted.'
      : adopted
        ? `${adopted.label}. Earlier sells improved, and the later sells still made more than the unfiltered book (${inr(adopted.testPnl)} vs ${inr(testBase)}).`
        : `No rule that helped the earlier sells also helped the later ones. The book stays as traded. Later sells made ${inr(testBase)}.`;

  const fullStrategies = [...byKey(closed, (row) => row.strategy).entries()]
    .map(([id, list]) => {
      const wins = list.filter((row) => row.pnl > 0).length;
      return { id, pnl: sumPnl(list), trades: list.length, winRate: list.length ? wins / list.length : 0 };
    })
    .sort((a, b) => a.pnl - b.pnl);

  const causes: Cause[] = [];
  if (fullStrategies[0]) {
    const worst = fullStrategies[0];
    const best = fullStrategies[fullStrategies.length - 1];
    causes.push({
      id: 'sleeve',
      title: `${worst.id} is the leak`,
      detail: `${worst.trades} closed ${worst.trades === 1 ? 'sell' : 'sells'} in ${worst.id} closed at ${inr(worst.pnl)}. ${best && best.id !== worst.id ? (best.pnl >= 0 ? `${best.id} made ${inr(best.pnl)} on ${best.trades} ${best.trades === 1 ? 'sell' : 'sells'}.` : `${best.id} lost the least, ${inr(best.pnl)} on ${best.trades} ${best.trades === 1 ? 'sell' : 'sells'}.`) : ''} ${fullStrategies.some((row) => row.pnl > 0) ? 'The book paid for several entry rules and only some of them returned cash.' : 'No sleeve returned cash on its closed sells.'}`,
      pnl: worst.pnl,
      trades: worst.trades,
    });
  }
  const exits = [...byKey(closed, (row) => row.exitClass || 'unknown').entries()]
    .map(([id, list]) => ({ id, pnl: sumPnl(list), trades: list.length }))
    .sort((a, b) => a.pnl - b.pnl);
  if (exits[0]) {
    causes.push({
      id: 'exit',
      title: `${exits[0].id} exits carried the loss`,
      detail: `${exits[0].trades} ${exits[0].trades === 1 ? 'sell' : 'sells'} marked ${exits[0].id} closed at ${inr(exits[0].pnl)}. That is the exit path, separate from which signal opened the trade.`,
      pnl: exits[0].pnl,
      trades: exits[0].trades,
    });
  }
  const symbols = [...byKey(closed, (row) => row.symbol).entries()]
    .map(([symbol, list]) => ({ symbol, pnl: sumPnl(list), trades: list.length }))
    .sort((a, b) => a.pnl - b.pnl);
  if (symbols[0]) {
    const top = symbols.slice(0, 3);
    causes.push({
      id: 'names',
      title: 'A few names hold the damage',
      detail: top.map((row) => `${row.symbol} ${inr(row.pnl)} across ${row.trades} ${row.trades === 1 ? 'sell' : 'sells'}`).join('. ') + '.',
      pnl: top.reduce((acc, row) => acc + row.pnl, 0),
      trades: top.reduce((acc, row) => acc + row.trades, 0),
    });
  }

  const wins = closed.filter((row) => row.pnl > 0);
  const losses = closed.filter((row) => row.pnl < 0);
  const lossMaxHold = losses.length ? losses.filter((row) => row.exitClass === 'max-hold').length / losses.length : 0;
  const winTaken = wins.length ? wins.filter((row) => row.exitClass === 'trail-stop' || row.exitClass === 'signal-exit').length / wins.length : 0;
  const disposition = losses.length >= 8 && wins.length >= 8 && lossMaxHold >= 0.35 && winTaken >= 0.35;
  if (disposition) {
    causes.push({
      id: 'disposition',
      title: 'Winners are cut and losers are kept',
      detail: `${pct(winTaken * 100)} of winning sells leave on a trail or a signal. ${pct(lossMaxHold * 100)} of losing sells wait for the max-hold exit. That is the disposition effect in this journal.`,
      pnl: sumPnl(losses.filter((row) => row.exitClass === 'max-hold')),
      trades: losses.filter((row) => row.exitClass === 'max-hold').length,
    });
  }

  const stops = closed.filter((row) => row.exitClass === 'stop-loss');
  const past = stops.filter((row) => (row.retPct ?? 0) < -8.5);

  const sectors = [...byKey(closed, (row) => book[row.symbol]?.sector || 'Unclassified').entries()]
    .map(([sector, list]) => ({ sector, pnl: sumPnl(list), trades: list.length }))
    .sort((a, b) => a.pnl - b.pnl);

  const deals = Object.values(book)
    .map((stock): ValueDeal | null => {
      const mos = stock.verdict?.marginOfSafety;
      const roe = stock.metrics?.roe ?? null;
      const pe = stock.metrics?.pe ?? null;
      const graham = stock.screens?.graham?.score ?? 0;
      const buffett = stock.screens?.buffett?.score ?? 0;
      const rating = stock.verdict?.rating ?? '';
      if (mos == null || mos < 20 || mos > 80) return null;
      if (roe == null || roe < 12) return null;
      if (pe != null && (pe <= 0 || pe > 22)) return null;
      if (rating === 'Sell' || rating === 'Strong Sell') return null;
      if (graham < 55 && buffett < 55) return null;
      const tradedName = traded.has(stock.symbol);
      return {
        symbol: stock.symbol,
        name: stock.name || stock.symbol,
        sector: stock.sector || '',
        marginOfSafety: mos,
        grade: stock.verdict?.grade || '',
        rating,
        pe,
        roe,
        graham: stock.screens?.graham?.grade || '',
        traded: tradedName,
        why: `Last price sits ${mos.toFixed(0)}% under the modelled fair value. Graham ${stock.screens?.graham?.grade || '—'}, Buffett score ${buffett.toFixed(0)}. ${tradedName ? 'The journal already traded it.' : 'The journal never closed a sell in it.'}`,
      };
    })
    .filter((row): row is ValueDeal => row != null)
    .sort((a, b) => b.marginOfSafety - a.marginOfSafety)
    .slice(0, 8);

  return {
    closed,
    trainCount: train.length,
    testCount: test.length,
    from: closed[0]?.day ?? '',
    to: closed[closed.length - 1]?.day ?? '',
    causes,
    deals,
    rules,
    adopted,
    reason,
    strategies: fullStrategies,
    sectors,
    disposition,
    stopSlipCount: past.length,
    stopCount: stops.length,
    bootstrap: bootstrapMean(closed.map((row) => row.pnl)),
    repeatSymbols: symbols.filter((row) => row.trades >= 8).slice(0, 5),
  };
}

export function quoteArbitrage(prices: Record<string, number>): ArbRow[] {
  const rows: ArbRow[] = [];
  for (const [ns, bo] of VENUE_PAIRS) {
    const left = prices[ns];
    const right = prices[bo];
    if (!(left > 0) || !(right > 0)) continue;
    const gap = right / left - 1;
    rows.push({
      id: ns,
      kind: 'venue',
      pair: `${ns} vs ${bo}`,
      gapPct: gap * 100,
      note: gap > 0 ? 'BSE is richer than NSE.' : 'NSE is richer than BSE.',
      actionable: Math.abs(gap) >= VENUE_GAP,
    });
  }
  const fx = prices[FX_TICKER];
  if (fx > 0) {
    for (const pair of ADR_PAIRS) {
      const adr = prices[pair.adr];
      const local = prices[pair.local];
      if (!(adr > 0) || !(local > 0)) continue;
      const implied = (adr * fx) / pair.ratio;
      const gap = implied / local - 1;
      rows.push({
        id: pair.adr,
        kind: 'adr',
        pair: `${pair.name}: ${pair.adr} vs ${pair.local}`,
        gapPct: gap * 100,
        note: `1 ADR = ${pair.ratio} local ${pair.ratio === 1 ? 'share' : 'shares'}, USDINR ${fx.toFixed(2)}. Implied local ₹${implied.toFixed(2)} against NSE ₹${local.toFixed(2)}. ${gap > 0 ? 'The NSE line is cheaper than the ADR.' : 'The ADR is cheaper than the NSE line.'}`,
        actionable: Math.abs(gap) >= ADR_GAP,
      });
    }
  }
  return rows.sort((a, b) => Math.abs(b.gapPct) - Math.abs(a.gapPct));
}

export interface AgentCopy {
  quant: string;
  risk: string;
  shadow: string;
}

export function agentCopy(review: DeskReview, arbs: ArbRow[]): AgentCopy {
  const leak = review.causes[0];
  const quant = !review.closed.length
    ? 'Quant has no closed sells to attribute.'
    : `${leak ? leak.detail : ''} The search froze its rules on the first ${review.trainCount} sells and scored them on the last ${review.testCount}, from ${review.from} to ${review.to}. ${review.reason}`;

  const risk = !review.closed.length
    ? 'Risk has no closed sells.'
    : `Mean sell is inside a 90% resampled band of ${inr(review.bootstrap.low)} to ${inr(review.bootstrap.high)}. ${review.stopCount} stop-loss sells, ${review.stopSlipCount} of them worse than -8.5% after the stop was supposed to cap the loss. ${review.disposition ? 'Winners leave early and losers run to max-hold.' : 'The journal does not show both early winner exits and max-hold losers together.'} ${review.adopted ? `The adopted rule still has ${review.adopted.testTrades} later sells.` : 'Nothing was adopted, so the live sleeves stay in place.'} This desk does not send orders.`;

  const missed = review.deals.filter((deal) => !deal.traded);
  const hit = review.deals.filter((deal) => deal.traded);
  const widest = arbs.find((row) => row.actionable) ?? arbs[0];
  const shadow = [
    missed[0]
      ? `Cheapest quality the book missed: ${missed[0].symbol} (${missed[0].name}), ${missed[0].marginOfSafety.toFixed(0)}% under fair value, PE ${missed[0].pe ?? '—'}, ROE ${missed[0].roe ?? '—'}%.`
      : 'No name clears the value gate (20–80% under fair value, known ROE of at least 12, PE under 22, Graham or Buffett score at least 55, and not a Sell). A wider discount is a broken fair value, not a bargain.',
    hit[0] ? `The book did trade ${hit.map((deal) => deal.symbol).slice(0, 3).join(', ')}, so those discounts are not undiscovered.` : '',
    widest
      ? `Widest same-company gap: ${widest.pair}, ${pct(widest.gapPct)}. ${widest.note} ${widest.actionable ? 'The gap is wide enough to look at after costs.' : 'The gap is inside dealing costs, so it is not an arb.'}`
      : 'Same-company prices are still loading, or a leg failed.',
  ]
    .filter(Boolean)
    .join(' ');

  return { quant, risk, shadow };
}

export const SWARM: { id: string; label: string; grounded: boolean }[] = [
  { id: 'investment_committee', label: 'Investment committee', grounded: true },
  { id: 'portfolio_review_board', label: 'Portfolio review', grounded: true },
  { id: 'risk_committee', label: 'Risk committee', grounded: true },
  { id: 'value_investing_committee', label: 'Value committee', grounded: true },
  { id: 'fundamental_research_team', label: 'Fundamental research', grounded: true },
  { id: 'statistical_arbitrage_desk', label: 'Statistical arbitrage', grounded: true },
  { id: 'pairs_research_lab', label: 'Pairs lab', grounded: true },
  { id: 'quant_strategy_desk', label: 'Quant desk', grounded: true },
  { id: 'factor_research_committee', label: 'Factor committee', grounded: true },
  { id: 'technical_analysis_panel', label: 'Technical panel', grounded: true },
  { id: 'sector_rotation_team', label: 'Sector rotation', grounded: true },
  { id: 'macro_rates_fx_desk', label: 'Macro, rates, FX', grounded: true },
  { id: 'global_equities_desk', label: 'Global equities', grounded: true },
  { id: 'equity_research_team', label: 'Equity research', grounded: true },
  { id: 'sentiment_intelligence_team', label: 'Sentiment', grounded: false },
  { id: 'event_driven_task_force', label: 'Event driven', grounded: false },
  { id: 'crypto_trading_desk', label: 'Crypto desk', grounded: false },
  { id: 'crypto_research_lab', label: 'Crypto research', grounded: false },
  { id: 'commodity_research_team', label: 'Commodities', grounded: false },
  { id: 'derivatives_strategy_desk', label: 'Derivatives', grounded: false },
  { id: 'convertible_bond_team', label: 'Convertibles', grounded: false },
  { id: 'credit_research_team', label: 'Credit', grounded: false },
  { id: 'etf_allocation_desk', label: 'ETF allocation', grounded: false },
  { id: 'fund_selection_panel', label: 'Fund selection', grounded: false },
  { id: 'ml_quant_lab', label: 'ML lab', grounded: false },
  { id: 'social_alpha_team', label: 'Social alpha', grounded: false },
  { id: 'geopolitical_war_room', label: 'Geopolitics', grounded: false },
  { id: 'earnings_research_desk', label: 'Earnings', grounded: false },
  { id: 'global_allocation_committee', label: 'Global allocation', grounded: false },
  { id: 'macro_strategy_forum', label: 'Macro forum', grounded: false },
];

export function swarmBrief(id: string, review: DeskReview, arbs: ArbRow[]): string {
  const agents = agentCopy(review, arbs);
  const sleeves = review.strategies
    .map((row) => `${row.id} ${inr(row.pnl)} (${row.trades} sells, ${(row.winRate * 100).toFixed(0)}% wins)`)
    .join('; ');
  const sector = review.sectors[0]
    ? `${review.sectors[0].sector} lost ${inr(review.sectors[0].pnl)} on ${review.sectors[0].trades} sells.`
    : 'Sectors are not joined yet.';
  switch (id) {
    case 'investment_committee':
      return `${agents.quant} ${agents.shadow}`;
    case 'portfolio_review_board':
    case 'quant_strategy_desk':
      return `Sleeves: ${sleeves || 'none'}. ${review.reason}`;
    case 'risk_committee':
      return agents.risk;
    case 'value_investing_committee':
    case 'fundamental_research_team':
    case 'equity_research_team':
      return review.deals.length
        ? review.deals.map((deal) => `${deal.symbol} ${deal.marginOfSafety.toFixed(0)}% under fair value, ${deal.why}`).join(' ')
        : 'The fundamental book has no name that clears the value gate today.';
    case 'statistical_arbitrage_desk':
    case 'pairs_research_lab':
    case 'macro_rates_fx_desk':
      return arbs.length
        ? arbs.map((row) => `${row.pair}: ${pct(row.gapPct)}. ${row.note}`).join(' ')
        : 'Arb legs are not in yet.';
    case 'factor_research_committee':
      return 'Price factors are scored on the sparkline panel in Alpha. The value gate above is the fundamental factor, and it is a screen, not a timed information coefficient.';
    case 'technical_analysis_panel':
      return review.causes.find((cause) => cause.id === 'exit')?.detail ?? 'Exit classes are not available.';
    case 'sector_rotation_team':
      return `${sector} ${review.sectors.slice(0, 4).map((row) => `${row.sector} ${inr(row.pnl)}`).join(', ')}.`;
    case 'global_equities_desk':
      return 'The tape is the cross-market context. The journal itself is NSE delivery. An ADR gap is the only place a foreign line is tied to a local holding.';
    case 'sentiment_intelligence_team':
    case 'event_driven_task_force':
      return 'These sells are not marked with a news flag, so a sentiment or event view would be invented. The exit reason on the journal is the evidence instead.';
    default:
      return 'This preset needs a book the journal does not hold: options, credit, funds, social posts, or a model score. It stays silent rather than fill the gap.';
  }
}
