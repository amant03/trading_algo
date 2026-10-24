// Regression: end-of-day scratches were real rupee losses, and Bot Brain
// kept funding the method anyway. Empty sessions wiped the window, a bench
// was cleared before its parole date, and the stored return rounded to 0%.
import { judgeMethod, roundTripRetPct, windowStats, type BrainPrev } from './paper-daily.ts';

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

// 16 Oct 2026, Donchian SBIN: bought 122 @ 963.53, squared 122 @ 962.60.
// Price-only return is about -0.10% and was stored as -0.1; the sister
// trade the day before stored 0. After-cost return has to stay a loss.
const sbin = roundTripRetPct(122, 963.53, 962.6);
const sbinStored = Math.round(sbin * 100) / 100;
assert(sbinStored <= -0.14 && sbinStored > -0.2, `SBIN scratch stored as ${sbinStored}, brain would miss the loss`);

// A flat tape: the fill already includes the buy slippage. One-decimal
// storage of the price-only return was 0, so the bucket never moved.
const flatStored = Math.round(roundTripRetPct(1, 100.05, 100) * 100) / 100;
assert(flatStored <= -0.09, `flat round trip stored as ${flatStored}`);

const news = { actions: 0, net: 0, blocked: 0 };
const empty = (date: string) => ({ date, per: {}, news });
const lossDay = (date: string) => ({
  date,
  per: { ma_cross: { n: 1, win: 0, net: -100, sumRet: -1, sumSq: 1 } },
  news,
});

const learn = {
  windowDays: 10,
  history: [
    lossDay('2026-10-01'),
    lossDay('2026-10-02'),
    lossDay('2026-10-05'),
    lossDay('2026-10-06'),
    lossDay('2026-10-07'),
    lossDay('2026-10-08'),
    ...Array.from({ length: 10 }, (_, i) => empty(`2026-10-${String(11 + i).padStart(2, '0')}`)),
  ],
} as unknown as Parameters<typeof windowStats>[0];

const remembered = windowStats(learn, 'ma_cross');
assert(remembered.n === 6, `empty days erased the losses, window n=${remembered.n}`);
assert(remembered.mean <= -0.9, `mean ${remembered.mean} should still show the bleed`);

// Live shape, 23 Oct: MA Cross streak -6, one trip left in a diluted window,
// status active, full bucket.
const ma = judgeMethod(
  'MA Cross',
  { n: 1, win: 0, net: -1417, mean: -1, sd: 0 },
  { weight: 1, status: 'active', reason: 'warming up (1 trips)', streak: -6, pausedUntil: null },
  '2026-10-23',
);
assert(ma.paused && ma.weight === 0, `MA Cross on a 6-loss streak kept a full bucket: ${ma.reason}`);

// Live shape: Bollinger was benched until 27 Oct, then a 5-trip window
// (mean -0.14%) no longer met the old n>=6 gate and the bench was dropped.
const benched: BrainPrev = {
  weight: 0,
  status: 'paused',
  reason: 'benched',
  streak: -5,
  pausedUntil: '2026-10-27',
};
const bb = judgeMethod(
  'Bollinger Breakout',
  { n: 5, win: 2, net: -800, mean: -0.14, sd: 0.4 },
  benched,
  '2026-10-23',
);
assert(bb.paused && bb.weight === 0, `Bollinger bench was dropped while expectancy was still red: ${bb.reason}`);
assert(bb.pausedUntil === '2026-10-27', `parole date moved early, got ${bb.pausedUntil}`);

const healed = judgeMethod(
  'Bollinger Breakout',
  { n: 4, win: 3, net: 400, mean: 0.2, sd: 0.2 },
  benched,
  '2026-10-23',
);
assert(!healed.paused && healed.weight === 0.5 && healed.streak === 0, `a healed method did not come back at half size: ${healed.reason}`);

const expired = judgeMethod(
  'Bollinger Breakout',
  { n: 4, win: 1, net: -500, mean: -0.2, sd: 0.3 },
  { ...benched, pausedUntil: '2026-10-20' },
  '2026-10-23',
);
assert(expired.paused, `clock parole let a losing method back in: ${expired.reason}`);
assert(expired.pausedUntil === '2026-10-28', `bench was not extended, until ${expired.pausedUntil}`);

console.log('paper-daily brain tests passed');
console.log(`SBIN 122 @ 963.53 → 962.60 scores ${sbinStored}% after cost`);
