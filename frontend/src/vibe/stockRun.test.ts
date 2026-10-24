import { chooseRun, tickerCandidates } from './stockRun';
import type { Improvement } from './engine';

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

const stocks = [
  { symbol: 'TCS', name: 'Tata Consultancy Services Limited' },
  { symbol: 'INFY', name: 'Infosys Limited' },
  { symbol: 'TATASTEEL', name: 'Tata Steel Limited' },
];

const tcs = tickerCandidates('tcs', stocks);
assert(!('error' in tcs) && tcs.candidates[0] === 'TCS.NS', 'a book symbol stays on the NSE line');
const named = tickerCandidates('Infosys Limited', stocks);
assert(!('error' in named) && named.symbol === 'INFY', 'an exact company name resolves to one symbol');
const ambiguous = tickerCandidates('Tata', stocks);
assert('error' in ambiguous, 'a shared name is not auto-picked');
const apple = tickerCandidates('AAPL', stocks);
assert(!('error' in apple) && apple.candidates[0] === 'AAPL.NS' && apple.candidates[1] === 'AAPL', 'an unknown symbol tries NSE, then the bare ticker');
const adr = tickerCandidates('INFY', stocks);
assert(!('error' in adr) && adr.candidates.length === 1 && adr.candidates[0] === 'INFY.NS', 'a book symbol is not swapped for the US ADR');

const rejected = { status: 'ok', accepted: false, trainCandidate: { metrics: { trades: 10, sharpe: 2, maxDrawdown: -0.1 } } } as Improvement;
const adopted = { status: 'ok', accepted: true, trainCandidate: { metrics: { trades: 8, sharpe: 0.4, maxDrawdown: -0.1 } } } as Improvement;
const better = { status: 'ok', accepted: true, trainCandidate: { metrics: { trades: 8, sharpe: 0.9, maxDrawdown: -0.1 } } } as Improvement;
assert(chooseRun([rejected, adopted, better]) === better, 'the holdout gate filters first, then training score ranks');
assert(chooseRun([rejected]) == null, 'a training win that fails the holdout is not adopted');

console.log('stock run ok');
