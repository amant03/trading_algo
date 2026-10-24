// A long is allowed only when the last 30 minutes still have room to pay.
// Measured on the October book: closes pinned to the half-hour high
// (HAL, WIPRO, SBILIFE, Bajaj Auto, 15 Oct SBIN) all lost, and a half-hour
// that had already run past +0.55% was the IndusInd stop. The best winner
// (M&M) was slightly red on that window and still had room — a gate that
// demands an already-green tape drops it and keeps the losers.
import { shortTermAllowsLong } from './paper-daily.ts';

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

function flat(n: number, c: number, h = c, l = c) {
  return Array.from({ length: n }, () => ({ h, l, c }));
}

const pinned = [
  ...flat(1, 100),
  { h: 100.2, l: 99.5, c: 99.8 },
  { h: 100.2, l: 99.5, c: 99.9 },
  { h: 100.2, l: 99.5, c: 100 },
  { h: 100.2, l: 99.5, c: 100.05 },
  { h: 100.2, l: 99.5, c: 100.1 },
  { h: 100.2, l: 99.5, c: 100.2 },
];
const pinnedDecision = shortTermAllowsLong(pinned);
assert(!pinnedDecision.ok, `a close at the 30-min high was allowed: ${pinnedDecision.why}`);

const spent = [
  { h: 100, l: 100, c: 100 },
  { h: 100.2, l: 100, c: 100.1 },
  { h: 100.3, l: 100.05, c: 100.2 },
  { h: 100.4, l: 100.1, c: 100.3 },
  { h: 100.5, l: 100.2, c: 100.4 },
  { h: 100.7, l: 100.3, c: 100.5 },
  { h: 100.8, l: 100.4, c: 100.6 },
];
const spentDecision = shortTermAllowsLong(spent);
assert(!spentDecision.ok, `a half-hour already up 0.60% was allowed: ${spentDecision.why}`);

// TCS 16 Oct shape: +0.22% over 30 min, close off the high. That trade made ₹2,359.
const room = [
  { h: 100, l: 99.7, c: 100 },
  { h: 100.2, l: 99.9, c: 100.05 },
  { h: 100.25, l: 99.95, c: 100.1 },
  { h: 100.3, l: 100, c: 100.12 },
  { h: 100.4, l: 100.05, c: 100.15 },
  { h: 100.45, l: 100.1, c: 100.18 },
  { h: 100.5, l: 99.9, c: 100.22 },
];
const roomDecision = shortTermAllowsLong(room);
assert(roomDecision.ok, `a modest tape with room was blocked: ${roomDecision.why}`);

// M&M 13 Oct shape: the half-hour was slightly red and the close was not the high.
// That was the largest winner in the book. Requiring an already-green tape drops it.
const early = [
  { h: 100.2, l: 99.8, c: 100 },
  { h: 100.15, l: 99.7, c: 99.95 },
  { h: 100.1, l: 99.6, c: 99.9 },
  { h: 100.05, l: 99.55, c: 99.88 },
  { h: 100.3, l: 99.5, c: 99.92 },
  { h: 100.25, l: 99.6, c: 99.9 },
  { h: 100.3, l: 99.5, c: 99.89 },
];
const earlyDecision = shortTermAllowsLong(early);
assert(earlyDecision.ok, `a not-yet-extended tape was blocked: ${earlyDecision.why}`);

const shortWindow = shortTermAllowsLong(flat(6, 100));
assert(!shortWindow.ok, 'a window shorter than 30 minutes was allowed');

console.log('paper-daily entry tests passed');
