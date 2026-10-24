import { portfolioBooks, monteCarlo } from './portfolio';

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

const calm = [0.01, -0.005, 0.008, -0.002, 0.004, 0.003, -0.001, 0.006, 0.002, -0.004];
const wild = calm.map((value) => value * 3);
const books = portfolioBooks([calm, wild]);
const sum = (row: number[]) => row.reduce((a, b) => a + b, 0);
assert(Math.abs(sum(books.equal) - 1) < 1e-9, 'equal weights sum to 1');
assert(Math.abs(sum(books.invVol) - 1) < 1e-9, 'volatility weights sum to 1');
assert(books.invVol[0] > books.invVol[1], 'the calmer series gets more weight');
assert(Math.abs(sum(books.minVar) - 1) < 1e-6, 'minimum variance sums to 1');

const equity = [100, 101, 100, 102, 103, 101, 104, 106, 105, 108];
const band = monteCarlo(equity, 200);
assert(band != null && band.low <= band.median && band.median <= band.high, 'monte carlo band is ordered');
assert(monteCarlo([100, 101]) == null, 'a short path is not bootstrapped');

console.log('portfolio ok');
