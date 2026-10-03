// Deterministic headline sentiment (no LLM, no key): whole-word keyword
// scoring over the title. Mirrors scripts/ci/paper-daily.ts newsSentiment
// so the UI badges and the trading bot always agree on a headline.

export type SentLabel = 'bullish' | 'bearish' | 'neutral';

const BULL_WORDS = [
  'surge', 'surged', 'surges', 'surging', 'rally', 'rallies', 'rallied', 'jump', 'jumps', 'jumped',
  'soar', 'soars', 'soared', 'record', 'profits', 'profit', 'beats', 'beat', 'upgrade', 'upgrades',
  'upgraded', 'outperform', 'buyback', 'dividend', 'bonus', 'split', 'approval', 'approves', 'approved',
  'wins', 'bags', 'breakout', 'growth', 'grows', 'doubles', 'triples', 'multibagger', 'hits high',
  'all-time high', '52-week high', 'order win', 'deal win', 'turnaround', 'bullish',
];

const BEAR_WORDS = [
  'fall', 'falls', 'fell', 'falling', 'drop', 'drops', 'dropped', 'dropping', 'plunge', 'plunged',
  'crash', 'crashed', 'loss', 'losses', 'misses', 'missed', 'downgrade', 'downgraded', 'downgrades',
  'selloff', 'sell-off', 'fraud', 'scam', 'probe', 'raid', 'raided', 'default', 'bankrupt',
  'penalty', 'fined', 'fine', 'fire', 'strike', 'recall', 'weak', 'slump', 'slumps', 'slumped',
  'sinks', 'sink', 'tumble', 'tumbles', 'tumbled', 'concern', 'warning', 'warns', 'cuts', 'cut',
  'fires', 'layoff', 'layoffs', 'scandal', 'bearish', 'all-time low', '52-week low', 'crisis',
];

export function classifySentiment(title: string): SentLabel {
  const t = ` ${(title ?? '').toLowerCase()} `;
  let score = 0;
  for (const w of BULL_WORDS) {
    if (t.includes(w.length > 4 ? ` ${w} ` : w)) score += 1;
  }
  for (const w of BEAR_WORDS) {
    if (t.includes(w.length > 4 ? ` ${w} ` : w)) score -= 1;
  }
  if (score > 0) return 'bullish';
  if (score < 0) return 'bearish';
  return 'neutral';
}
