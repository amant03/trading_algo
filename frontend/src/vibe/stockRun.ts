import {
  FEE,
  STRATEGY_LABEL,
  improve,
  paramsLabel,
  type Bar,
  type Improvement,
  type StrategyId,
} from './engine';
import { closedSells, type FundStock, type JournalTrade } from './deskReview';

const FAMILIES: StrategyId[] = ['ma_cross', 'rsi_reversal', 'macd_cross', 'donchian'];

export interface NameHit {
  symbol: string;
  name?: string | null;
}

export function tickerCandidates(raw: string, stocks: NameHit[]): { candidates: string[]; symbol: string } | { error: string } {
  const text = raw.trim();
  if (!text) return { error: 'Enter a name in each box you want to run.' };
  const upper = text.toUpperCase();
  const symbolLike = /^[A-Z0-9][A-Z0-9.^=-]{0,24}$/.test(upper);
  const q = text.toLowerCase();
  const exactName = stocks.filter((stock) => (stock.name || '').toLowerCase() === q);
  const prefix = q.length >= 4 ? stocks.filter((stock) => (stock.name || '').toLowerCase().startsWith(q)) : [];
  const named = exactName.length ? exactName : prefix;

  if (!symbolLike) {
    if (named.length === 1) return { candidates: [`${named[0].symbol.toUpperCase()}.NS`], symbol: named[0].symbol.toUpperCase() };
    if (named.length > 1) return { error: `Several names match “${text}”. Type the symbol.` };
    return { error: `No name in the fundamental book matches “${text}”. Type the symbol.` };
  }

  if (/[.^=-]/.test(upper)) {
    const symbol = upper.replace(/\.(NS|BO)$/, '');
    return { candidates: [upper], symbol };
  }
  const inBook = stocks.some((stock) => stock.symbol.toUpperCase() === upper);
  if (inBook) return { candidates: [`${upper}.NS`], symbol: upper };
  if (named.length > 1) return { error: `Several names match “${text}”. Type the symbol.` };
  if (named.length === 1) return { candidates: [`${named[0].symbol.toUpperCase()}.NS`], symbol: named[0].symbol.toUpperCase() };
  return { candidates: [`${upper}.NS`, upper], symbol: upper };
}

function trainScore(run: Improvement): number {
  const metrics = run.trainCandidate.metrics;
  if (metrics.trades < 3) return -1e9;
  return metrics.sharpe - 0.5 * Math.abs(metrics.maxDrawdown);
}

/** The family whose training window won, and whose holdout still cleared the gate. */
export function chooseRun(runs: Improvement[]): Improvement | null {
  const accepted = runs.filter((run) => run.status === 'ok' && run.accepted);
  accepted.sort((a, b) => trainScore(b) - trainScore(a));
  return accepted[0] ?? null;
}

export function researchBars(bars: Bar[]): { runs: Improvement[]; chosen: Improvement | null } {
  const runs = FAMILIES.map((strategy) => improve(bars, strategy));
  return { runs, chosen: chooseRun(runs) };
}

export interface JournalSlice {
  pnl: number;
  trades: number;
  sleeves: { id: string; pnl: number; trades: number }[];
}

export function journalSlice(symbol: string, trades: JournalTrade[]): JournalSlice {
  const sells = closedSells(trades).filter((row) => row.symbol.toUpperCase() === symbol.toUpperCase());
  const sleeves = new Map<string, { id: string; pnl: number; trades: number }>();
  for (const row of sells) {
    const current = sleeves.get(row.strategy) ?? { id: row.strategy, pnl: 0, trades: 0 };
    current.pnl += row.pnl;
    current.trades += 1;
    sleeves.set(row.strategy, current);
  }
  return {
    pnl: sells.reduce((acc, row) => acc + row.pnl, 0),
    trades: sells.length,
    sleeves: [...sleeves.values()].sort((a, b) => a.pnl - b.pnl),
  };
}

export function fundSlice(symbol: string, stocks: Record<string, FundStock> | FundStock[]): FundStock | null {
  const book = Array.isArray(stocks) ? Object.fromEntries(stocks.map((stock) => [stock.symbol, stock])) : stocks;
  return book[symbol.toUpperCase()] ?? null;
}

const inr = (n: number) => `${n < 0 ? '-' : ''}₹${Math.abs(Math.round(n)).toLocaleString('en-IN')}`;
const pct = (fraction: number) => `${fraction >= 0 ? '+' : ''}${(fraction * 100).toFixed(2)}%`;

export interface AgentLines {
  quant: string;
  risk: string;
  shadow: string;
}

export function stockAgents(ticker: string, runs: Improvement[], chosen: Improvement | null, journal: JournalSlice): AgentLines {
  const listed = runs
    .map((run) => {
      const hold = run.testCandidate.metrics;
      return `${STRATEGY_LABEL[run.strategy]} ${paramsLabel(run.strategy, run.adopted)} holdout ${pct(hold.totalReturn)}, Sharpe ${hold.sharpe.toFixed(2)}, drawdown ${pct(hold.maxDrawdown)}, ${hold.trades} trades${run.accepted ? ', gate cleared' : ''}`;
    })
    .join('. ');
  const quant = chosen
    ? `${ticker}: training adopted ${STRATEGY_LABEL[chosen.strategy]} ${paramsLabel(chosen.strategy, chosen.adopted)} on the first 70% of bars. ${chosen.reason} Holdout return ${pct(chosen.testCandidate.metrics.totalReturn)} against buy-and-hold ${pct(chosen.testBenchmark.metrics.totalReturn)}.`
    : `${ticker}: no family cleared the holdout gate, so nothing is adopted. ${listed}.`;

  const judged = chosen ?? runs[0];
  const risk = judged
    ? `The gate is fixed: at least 3 holdout trades, drawdown shallower than 45%, and a positive Sharpe or a positive holdout return. Fills are the next bar’s open. Cost is ${FEE * 10000} bps a side. ${judged.overfit ? 'The training Sharpe sits more than 1 above the holdout, so the fit is fragile.' : 'Training and holdout are not that far apart.'} ${chosen ? `${chosen.testCandidate.metrics.trades} holdout trades, max drawdown ${pct(chosen.testCandidate.metrics.maxDrawdown)}.` : 'No parameter set was stored.'}`
    : 'Risk has no backtest yet.';

  const symbol = ticker.replace(/\.(NS|BO)$/, '');
  const sleeve = chosen ? journal.sleeves.find((row) => row.id === chosen.strategy) : undefined;
  const shadow = [
    journal.trades
      ? `The paper book already closed ${journal.trades} ${journal.trades === 1 ? 'sell' : 'sells'} in ${symbol}, realized ${inr(journal.pnl)}.`
      : `The paper book has no closed sell in ${symbol}.`,
    sleeve
      ? `Same rule family in that journal, ${sleeve.id}, made ${inr(sleeve.pnl)} on ${sleeve.trades} sells. The new holdout is ${pct((chosen as Improvement).testCandidate.metrics.totalReturn)}.`
      : chosen
        ? `The journal has no ${chosen.strategy} sells in this name. The holdout of the adopted rule is ${pct(chosen.testCandidate.metrics.totalReturn)}.`
        : 'There is no adopted holdout to set beside the journal.',
  ].join(' ');

  return { quant, risk, shadow };
}

export function factorSnapshot(bars: Bar[]): { mom20: number | null; rev5: number | null; lowVol: number | null } {
  const close = bars.map((bar) => bar.c);
  const last = close.length - 1;
  if (last < 20 || !(close[last - 20] > 0) || !(close[last] > 0)) return { mom20: null, rev5: null, lowVol: null };
  const mom20 = close[last] / close[last - 20] - 1;
  const rev5 = close[last - 5] > 0 ? -(close[last] / close[last - 5] - 1) : null;
  const rets: number[] = [];
  for (let i = last - 19; i <= last; i++) {
    if (!(close[i - 1] > 0)) return { mom20, rev5, lowVol: null };
    rets.push(close[i] / close[i - 1] - 1);
  }
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((acc, value) => acc + (value - mean) ** 2, 0) / (rets.length - 1);
  return { mom20, rev5, lowVol: -Math.sqrt(variance) };
}

export function screenFund(fund: FundStock | null): { pass: boolean; why: string } {
  if (!fund) return { pass: false, why: 'Not in the fundamental book.' };
  const mos = fund.verdict?.marginOfSafety;
  const roe = fund.metrics?.roe ?? null;
  const pe = fund.metrics?.pe ?? null;
  const graham = fund.screens?.graham?.score ?? 0;
  const buffett = fund.screens?.buffett?.score ?? 0;
  const rating = fund.verdict?.rating ?? '';
  if (mos == null || mos < 20 || mos > 80) return { pass: false, why: 'The fair-value gap is outside 20–80%.' };
  if (roe == null || roe < 12) return { pass: false, why: 'ROE is missing or under 12%.' };
  if (pe != null && (pe <= 0 || pe > 22)) return { pass: false, why: 'PE is outside 0–22.' };
  if (rating === 'Sell' || rating === 'Strong Sell') return { pass: false, why: 'The stored rating is a sell.' };
  if (graham < 55 && buffett < 55) return { pass: false, why: 'Neither the Graham nor the Buffett score clears 55.' };
  return { pass: true, why: `${mos.toFixed(0)}% under the stored fair value, ROE ${roe.toFixed(1)}%.` };
}
