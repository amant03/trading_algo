/** Directional India-market reads from today's commodity moves. */

export type MacroBias = 'headwind' | 'tailwind' | 'quiet';

export interface MacroMoves {
  brent: number | null;
  gold: number | null;
  silver: number | null;
  copper: number | null;
  usdinr: number | null;
}

export interface DriverRead {
  id: string;
  title: string;
  bias: MacroBias;
  biasLabel: string;
  moveLabel: string;
  rule: string;
  today: string;
}

const QUIET = 0.2;

function biasLabel(bias: MacroBias): string {
  if (bias === 'headwind') return 'Headwind';
  if (bias === 'tailwind') return 'Tailwind';
  return 'Little changed';
}

function pctLabel(n: number | null): string {
  if (n == null || !isFinite(n)) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

function signed(n: number | null, up: MacroBias, down: MacroBias): MacroBias {
  if (n == null || !isFinite(n) || Math.abs(n) < QUIET) return 'quiet';
  return n > 0 ? up : down;
}

function todayLine(name: string, pct: number | null, bias: MacroBias, upIs: string, downIs: string): string {
  if (pct == null || !isFinite(pct)) return `Today's ${name} quote is not in yet.`;
  if (bias === 'quiet') return `${name} is ${pctLabel(pct)} — not enough of a move to push the Indian market.`;
  const effect = pct > 0 ? upIs : downIs;
  return `${name} is ${pctLabel(pct)} today. ${effect}`;
}

export function readMacro(moves: MacroMoves): DriverRead[] {
  const brent = signed(moves.brent, 'headwind', 'tailwind');
  const gold = signed(moves.gold, 'headwind', 'tailwind');
  const silver = signed(moves.silver, 'headwind', 'tailwind');
  const copper = signed(moves.copper, 'tailwind', 'headwind');
  const usdinr = signed(moves.usdinr, 'headwind', 'tailwind');

  return [
    {
      id: 'brent',
      title: 'Crude oil → Indian equities',
      bias: brent,
      biasLabel: biasLabel(brent),
      moveLabel: pctLabel(moves.brent),
      rule: 'If crude oil becomes more expensive, that is negative for the Indian stock market. India imports most of its oil, so a higher barrel widens the import bill and inflation. Oil producers can still rise; airlines, paints, and tyres usually do not.',
      today: todayLine(
        'Brent',
        moves.brent,
        brent,
        'That is a headwind for the Nifty.',
        'Cheaper crude is a tailwind for the Nifty.',
      ),
    },
    {
      id: 'gold',
      title: 'Bullion → risk appetite',
      bias: gold,
      biasLabel: biasLabel(gold),
      moveLabel: pctLabel(moves.gold),
      rule: 'A rising gold price is usually a mild negative for Indian equities. It often marks risk-off, and jewellers are squeezed when they cannot pass the cost on.',
      today: todayLine(
        'Gold',
        moves.gold,
        gold,
        'The bullion bid leans against equity appetite.',
        'Softer gold eases that risk-off bid.',
      ),
    },
    {
      id: 'silver',
      title: 'Silver → bullion and industry',
      bias: silver,
      biasLabel: biasLabel(silver),
      moveLabel: pctLabel(moves.silver),
      rule: 'Silver follows gold and factory demand. A jump alongside gold leans risk-off; a jump alongside copper leans toward industrial demand. The index link is weaker than crude.',
      today: todayLine(
        'Silver',
        moves.silver,
        silver,
        'Read it with gold: a higher price leans risk-off.',
        'A lower silver price is a small relief for that bid.',
      ),
    },
    {
      id: 'copper',
      title: 'Base metals → cyclicals',
      bias: copper,
      biasLabel: biasLabel(copper),
      moveLabel: pctLabel(moves.copper),
      rule: 'Higher copper is a positive growth read. It tends to help metal stocks (Hindalco, Tata Steel, Hindustan Zinc) and is a milder tailwind for the broader market than crude is a headwind.',
      today: todayLine(
        'Copper',
        moves.copper,
        copper,
        'That supports metal stocks and cyclicals.',
        'Weaker copper is a drag on metal stocks.',
      ),
    },
    {
      id: 'usdinr',
      title: 'Rupee → flows',
      bias: usdinr,
      biasLabel: biasLabel(usdinr),
      moveLabel: pctLabel(moves.usdinr),
      rule: 'More rupees per dollar means a weaker rupee. That is usually a headwind for the index and for importers, and a help for IT exporters. It often shows up with foreign selling.',
      today: todayLine(
        'USD/INR',
        moves.usdinr,
        usdinr,
        'A weaker rupee is a headwind for the broad market.',
        'A firmer rupee takes some pressure off importers and foreign flows.',
      ),
    },
  ];
}

function weight(id: string, bias: MacroBias): number {
  if (bias === 'quiet') return 0;
  const sign = bias === 'tailwind' ? 1 : -1;
  if (id === 'brent') return sign * 2;
  if (id === 'silver') return 0;
  return sign;
}

export function macroSummary(drivers: DriverRead[], niftyPct: number | null): string {
  const hasQuote = drivers.some((d) => d.moveLabel !== '—');
  const score = drivers.reduce((sum, d) => sum + weight(d.id, d.bias), 0);
  const brent = drivers.find((d) => d.id === 'brent');
  let lead: string;
  if (!hasQuote) {
    lead = 'Live quotes are not in yet. The lines below are the usual direct reads for the Indian market.';
  } else if (score <= -2) {
    lead = 'Direct read: a headwind for Indian equities.';
  } else if (score >= 2) {
    lead = 'Direct read: a tailwind for Indian equities.';
  } else {
    lead = 'Direct read: mixed. No single commodity is dominating the Indian tape.';
  }
  const crude =
    brent?.bias === 'headwind'
      ? ' Crude is the heavy one: a more expensive barrel is negative for the Indian stock market.'
      : brent?.bias === 'tailwind'
        ? ' Cheaper crude is the main support, and that usually helps the Indian stock market.'
        : '';
  const nifty =
    niftyPct == null || !isFinite(niftyPct)
      ? ''
      : ` Nifty is ${niftyPct >= 0 ? '+' : ''}${niftyPct.toFixed(2)}% today.`;
  return `${lead}${crude}${nifty}`;
}
