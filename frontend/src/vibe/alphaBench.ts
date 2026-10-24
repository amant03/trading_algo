// Short-horizon factor bench on the sparklines already stored with the
// fundamental book. A factor that lacks an input on a name is skipped for
// that name. Alive, reversed, and dead follow the sign of the mean
// cross-sectional rank correlation with the next five closes.

export type Spark = [number, number][];

export interface FactorScore {
  id: string;
  label: string;
  zoo: string;
  meanIc: number | null;
  dates: number;
  status: 'alive' | 'reversed' | 'dead' | 'unknown';
  note: string;
}

function ranks(values: number[]): number[] {
  const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const out = new Array<number>(values.length);
  order.forEach((item, rank) => {
    out[item.index] = rank;
  });
  return out;
}

function pearson(left: number[], right: number[]): number | null {
  if (left.length !== right.length || left.length < 8) return null;
  const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
  const mx = mean(left);
  const my = mean(right);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < left.length; i++) {
    const vx = left[i] - mx;
    const vy = right[i] - my;
    num += vx * vy;
    dx += vx * vx;
    dy += vy * vy;
  }
  if (dx < 1e-12 || dy < 1e-12) return null;
  const corr = num / Math.sqrt(dx * dy);
  return Number.isFinite(corr) ? corr : null;
}

export function spearman(left: number[], right: number[]): number | null {
  return pearson(ranks(left), ranks(right));
}

function std(values: number[]): number | null {
  if (values.length < 5) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const v = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(v);
}

function statusOf(meanIc: number | null, dates: number): FactorScore['status'] {
  if (meanIc == null || dates < 8) return 'unknown';
  if (meanIc > 0.02) return 'alive';
  if (meanIc < -0.02) return 'reversed';
  return 'dead';
}

export function benchSparks(sparks: Record<string, Spark>): FactorScore[] {
  const series = Object.entries(sparks)
    .map(([symbol, points]) => ({ symbol, close: points.map((point) => point[1]).filter((price) => price > 0) }))
    .filter((row) => row.close.length >= 30);
  const length = series.length ? Math.min(...series.map((row) => row.close.length)) : 0;
  const aligned = series.map((row) => ({ symbol: row.symbol, close: row.close.slice(row.close.length - length) }));

  const score = (id: string, label: string, zoo: string, factorAt: (close: number[], t: number) => number | null, note: string): FactorScore => {
    if (aligned.length < 12 || length < 30) {
      return { id, label, zoo, meanIc: null, dates: 0, status: 'unknown', note: 'Not enough aligned names.' };
    }
    const ics: number[] = [];
    for (let t = 20; t < length - 5; t++) {
      const xs: number[] = [];
      const ys: number[] = [];
      for (const row of aligned) {
        const factor = factorAt(row.close, t);
        const now = row.close[t];
        const ahead = row.close[t + 5];
        if (factor == null || !(now > 0) || !(ahead > 0)) continue;
        xs.push(factor);
        ys.push(ahead / now - 1);
      }
      const ic = spearman(xs, ys);
      if (ic != null) ics.push(ic);
    }
    const meanIc = ics.length ? ics.reduce((a, b) => a + b, 0) / ics.length : null;
    return { id, label, zoo, meanIc, dates: ics.length, status: statusOf(meanIc, ics.length), note };
  };

  return [
    score('mom20', '20-bar momentum', 'academic', (close, t) => (close[t - 20] > 0 ? close[t] / close[t - 20] - 1 : null), 'Last close over the close 20 bars earlier.'),
    score('rev5', '5-bar reversal', 'academic', (close, t) => (close[t - 5] > 0 ? -(close[t] / close[t - 5] - 1) : null), 'Negative of the last five-bar return.'),
    score('lowvol', 'Low volatility', 'academic', (close, t) => {
      const rets: number[] = [];
      for (let i = t - 19; i <= t; i++) {
        if (!(close[i - 1] > 0)) return null;
        rets.push(close[i] / close[i - 1] - 1);
      }
      const vol = std(rets);
      return vol == null ? null : -vol;
    }, 'Negative 20-bar realised volatility.'),
  ];
}
