import { benchSparks, spearman } from './alphaBench';
import { agentCopy, bootstrapMean, buildReview, quoteArbitrage, type JournalTrade } from './deskReview';

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

const trades: JournalTrade[] = [
  { day: '2026-01-01', strategy: 'bad', symbol: 'AAA', side: 'SELL', pnl: -100, exitClass: 'stop-loss', retPct: -10 },
  { day: '2026-01-02', strategy: 'bad', symbol: 'AAA', side: 'SELL', pnl: -100, exitClass: 'stop-loss', retPct: -10 },
  { day: '2026-01-03', strategy: 'bad', symbol: 'AAA', side: 'SELL', pnl: -100, exitClass: 'stop-loss', retPct: -10 },
  { day: '2026-01-04', strategy: 'bad', symbol: 'AAA', side: 'SELL', pnl: -80, exitClass: 'max-hold', retPct: -6 },
  { day: '2026-01-05', strategy: 'good', symbol: 'BBB', side: 'SELL', pnl: 40, exitClass: 'signal-exit', retPct: 4 },
  { day: '2026-01-06', strategy: 'good', symbol: 'BBB', side: 'SELL', pnl: 40, exitClass: 'signal-exit', retPct: 4 },
  { day: '2026-01-07', strategy: 'good', symbol: 'BBB', side: 'SELL', pnl: 30, exitClass: 'signal-exit', retPct: 3 },
  { day: '2026-01-08', strategy: 'bad', symbol: 'AAA', side: 'SELL', pnl: -50, exitClass: 'stop-loss', retPct: -9 },
  { day: '2026-01-09', strategy: 'good', symbol: 'BBB', side: 'SELL', pnl: 20, exitClass: 'signal-exit', retPct: 2 },
  { day: '2026-01-10', strategy: 'good', symbol: 'BBB', side: 'SELL', pnl: 20, exitClass: 'signal-exit', retPct: 2 },
  { day: '2026-01-11', strategy: 'good', symbol: 'BBB', side: 'SELL', pnl: 15, exitClass: 'signal-exit', retPct: 2 },
  { day: '2026-01-12', strategy: 'bad', symbol: 'AAA', side: 'SELL', pnl: -20, exitClass: 'stop-loss', retPct: -4 },
];

const review = buildReview(trades, {
  CHEAP: {
    symbol: 'CHEAP',
    name: 'Cheap Co',
    sector: 'FMCG',
    metrics: { pe: 14, roe: 18 },
    screens: { graham: { score: 70, grade: 'B' }, buffett: { score: 40, grade: 'C' } },
    verdict: { marginOfSafety: 28, grade: 'B', rating: 'Buy', fairValueMid: 100 },
  },
  RICH: {
    symbol: 'RICH',
    name: 'Rich Co',
    sector: 'FMCG',
    metrics: { pe: 40, roe: 8 },
    screens: { graham: { score: 20, grade: 'D' } },
    verdict: { marginOfSafety: 4, grade: 'D', rating: 'Sell' },
  },
  BLOWN: {
    symbol: 'BLOWN',
    name: 'Broken Fair Value',
    sector: 'Banks',
    metrics: { pe: 8, roe: 16 },
    screens: { graham: { score: 80, grade: 'A' }, buffett: { score: 80, grade: 'A' } },
    verdict: { marginOfSafety: 900, grade: 'A', rating: 'Buy', fairValueMid: 10000 },
  },
});

assert(review.adopted != null && (review.adopted.id === 'drop-strategy' || review.adopted.id === 'keep-strategy' || review.adopted.id === 'drop-symbols'), 'a rule that helps both halves is adopted');
assert(review.deals.length === 1 && review.deals[0].symbol === 'CHEAP', 'only the quality discount clears the value gate');
assert(review.deals[0].traded === false, 'CHEAP was never sold in the journal');

const rejected = buildReview(
  [
    ...trades.slice(0, 7),
    { day: '2026-02-01', strategy: 'good', symbol: 'BBB', side: 'SELL', pnl: -40, exitClass: 'signal-exit', retPct: -3 },
    { day: '2026-02-02', strategy: 'good', symbol: 'BBB', side: 'SELL', pnl: -40, exitClass: 'signal-exit', retPct: -3 },
    { day: '2026-02-03', strategy: 'good', symbol: 'BBB', side: 'SELL', pnl: -40, exitClass: 'signal-exit', retPct: -3 },
  ],
  {},
);
assert(rejected.adopted == null, 'a training cut that fails the later sells is not adopted');

const gaps = quoteArbitrage({
  'RELIANCE.NS': 100,
  'RELIANCE.BO': 101,
  INFY: 20,
  'INFY.NS': 1600,
  'INR=X': 85,
});
const venue = gaps.find((row) => row.id === 'RELIANCE.NS');
const adr = gaps.find((row) => row.id === 'INFY');
assert(venue != null && Math.abs(venue.gapPct - 1) < 1e-6, 'BSE one rupee richer is a 1% venue gap');
assert(adr != null && adr.gapPct > 5 && adr.actionable, 'ADR implied price above NSE is flagged');

const band = bootstrapMean([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
assert(band.low < band.high, 'bootstrap band has width');

assert(spearman([1, 2, 3, 4, 5, 6, 7, 8], [1, 2, 3, 4, 5, 6, 7, 8]) === 1, 'identical ranks correlate');
const bench = benchSparks({ ONLY: [[0, 1], [1, 2]] });
assert(bench[0].status === 'unknown', 'a two-point spark cannot score a factor');

const copy = agentCopy(review, gaps);
assert(copy.quant.includes('earlier') || copy.quant.includes(review.reason.slice(0, 12)), 'quant cites the search');
assert(copy.shadow.includes('CHEAP'), 'shadow names the missed value');

console.log('desk review ok');
