import { backtest, calcMetrics, edgeDensity, improve, parsePrompt, type Bar } from './engine';

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

function near(actual: number, expected: number, tol: number, message: string) {
  assert(Math.abs(actual - expected) <= tol, `${message}: got ${actual}, expected ${expected}`);
}

const drawdown = calcMetrics([80, 90], 100, [], [0, 86_400]);
near(drawdown.maxDrawdown, -0.2, 1e-9, 'drawdown uses starting cash as the high-water mark');

const noLoss = calcMetrics(
  [110],
  100,
  [{ entryBar: 0, exitBar: 0, entryPrice: 100, exitPrice: 110, pnl: 10, holdingBars: 0 }],
  [0],
);
assert(noLoss.profitFactor === null, 'a book that never lost has no profit factor');

const bars: Bar[] = [
  { t: 0, o: 50, h: 50, l: 50, c: 50, v: 1 },
  { t: 86_400, o: 50, h: 50, l: 50, c: 50, v: 1 },
  { t: 172_800, o: 50, h: 200, l: 50, c: 200, v: 1 },
  { t: 259_200, o: 80, h: 80, l: 80, c: 80, v: 1 },
];
const filled = backtest(bars, 'donchian', { fast: 20, slow: 50, signal: 9, period: 2, oversold: 30, overbought: 70 });
assert(filled.metrics.finalValue > 90_000, 'entry uses the next open, not the signal bar close');
assert(filled.metrics.finalValue < 100_000, 'the entry still pays the fee');

const btc = parsePrompt('Backtest an RSI mean-reversion on bitcoin');
assert(btc.ticker === 'BTC-USD', 'bitcoin resolves to BTC-USD');
assert(btc.strategy === 'rsi_reversal', 'rsi prompt selects mean reversion');

const both = parsePrompt('apple first, then bitcoin breakout');
assert(both.ticker === 'AAPL', 'the earlier name wins');
assert(both.strategy === 'donchian', 'breakout selects Donchian');

const dates = Array.from({ length: 40 }, (_, i) => `d${i}`);
const flat = { dates, rets: dates.map(() => 0) };
const unknown = edgeDensity([flat, flat]);
assert(unknown.density === null, 'constant series leave edge density unknown');

const wave = { dates, rets: dates.map((_, i) => (i % 2 === 0 ? 0.02 : -0.01)) };
const fused = edgeDensity([wave, wave]);
assert(fused.density === 1, 'identical series are one regime');

const short = improve(
  Array.from({ length: 20 }, (_, i) => ({ t: i * 86_400, o: 100, h: 101, l: 99, c: 100 + i * 0.1, v: 1 })),
  'ma_cross',
);
assert(short.status === 'too_short', 'short history skips the search');

const trend: Bar[] = Array.from({ length: 140 }, (_, i) => {
  const c = 100 + i * 0.4;
  return { t: 1_700_000_000 + i * 86_400, o: i === 0 ? 100 : 100 + (i - 1) * 0.4, h: c + 0.2, l: c - 0.2, c, v: 1_000 };
});
const searched = improve(trend, 'ma_cross');
assert(searched.generations.length === 9, 'seed plus eight neighbours');
assert(searched.testBenchmark.metrics.totalReturn !== 0 || searched.testBenchmark.equity.length > 0, 'holdout has a buy-and-hold book');

console.log('vibe engine ok');
